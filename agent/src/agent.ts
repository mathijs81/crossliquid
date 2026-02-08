import { timeout } from "es-toolkit";
import { chains, databasePath } from "./config.js";
import { logger } from "./logger.js";
import { closeDatabase, db, initializeDatabase } from "./services/database.js";
import { collectEthUsdcData, type EthUsdcData } from "./services/ethusdc.js";
import { calculateLOS } from "./services/los.js";
import { getVaultState } from "./services/vault.js";
import { ActionRunner, type TaskStore } from "./services/actionRunner.js";
import { initializeTaskDatabase } from "./services/taskStore.js";
import { createAgentActions } from "./actions/agentActions.js";

export interface AgentStats {
  status: "running" | "stopped";
  ethUsdcData: Record<string, EthUsdcData>;
  lastError: string | null;
}

class Agent {
  private statsIntervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private stats: AgentStats = {
    status: "stopped",
    ethUsdcData: {},
    lastError: null,
  };
  private actionRunner: ActionRunner | null = null;
  private taskStore: TaskStore | null = null;

  constructor() {}

  async runStatsLoop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      logger.info("Starting loop");

      // Collect eth-usdc data for global stats
      for (const [chainId] of chains.entries()) {
        logger.info(`starting chain ${chainId}`);
        try {
          const data = await collectEthUsdcData(chainId);
          this.stats.ethUsdcData[String(chainId)] = data;

          db.insertExchangeRate({
            timestamp: data.swapSimulation.timestamp,
            chainId,
            usdcOutput: data.swapSimulation.usdcOutput,
          });

          db.insertPoolPrice({
            timestamp: data.swapSimulation.timestamp,
            chainId,
            poolAddress: data.poolPrice.poolId,
            sqrtPriceX96: data.poolPrice.sqrtPriceX96.toString(),
            tick: data.poolPrice.tick,
            liquidity: data.poolPrice.liquidity.toString(),
            fee: data.poolPrice.fee,
            feeGrowthGlobal0: data.poolPrice.feeGrowthGlobal0.toString(),
            feeGrowthGlobal1: data.poolPrice.feeGrowthGlobal1.toString(),
          });
        } catch (error) {
          logger.error(
            {
              chainId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to collect ETH-USDC data",
          );
        }
      }

      this.stats.lastError = null;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.stats.lastError = errorMessage;
      logger.error({ error: errorMessage }, "Error in agent loop");
    }
  }

  private async updateVaultData(vaultAddress: `0x${string}`): Promise<void> {
    for (const [chainId] of chains.entries()) {
      const state = await getVaultState(chainId, vaultAddress);
      if (!state) {
        logger.warn({ chainId, vaultAddress }, "Failed to fetch vault state");
      }
    }
  }

  private async runActionLoop(actionIntervalMs: number): Promise<void> {
    try {
      logger.info("running action loop");
      await Promise.race([timeout(30_000), this.actionRunner?.runActionLoop()])
      logger.info("action loop completed");
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "Error in action loop");
    }
    if (this.isRunning) {
      // Schedule next run
      setTimeout(() => {
        this.runActionLoop(actionIntervalMs);
      }, actionIntervalMs);
    }
  }

  start(statIntervalMs = 30_000, actionIntervalMs = 5 * 60 * 1000): void {
    initializeDatabase(databasePath);
    if (this.isRunning || this.statsIntervalId !== null) {
      logger.info("Agent already running");
      return;
    }

    this.isRunning = true;
    this.stats.status = "running";

    this.runStatsLoop();

    this.statsIntervalId = setInterval(() => {
      this.runStatsLoop();
    }, statIntervalMs);

    // Set up action loop
    this.taskStore = initializeTaskDatabase();
    this.actionRunner = new ActionRunner(this.taskStore, createAgentActions());
    this.runActionLoop(actionIntervalMs);

    logger.info({ statIntervalMs, actionIntervalMs }, "Agent started");
  }

  stop(): void {
    if (!this.isRunning && this.statsIntervalId === null) {
      return;
    }

    this.isRunning = false;
    this.stats.status = "stopped";

    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }

    closeDatabase();
    logger.info("Agent stopped");
  }

  getStats(): AgentStats {
    return { ...this.stats };
  }
}

export const agent = new Agent();
