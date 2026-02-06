import { chains, databasePath } from "./config.js";
import { logger } from "./logger.js";
import { closeDatabase, db, initializeDatabase } from "./services/database.js";
import { collectEthUsdcData, type EthUsdcData } from "./services/ethusdc.js";
import { calculateLOS, getTargetDistribution } from "./services/los.js";
import { getVaultState } from "./services/vault.js";

export interface AgentStats {
  status: "running" | "stopped";
  ethUsdcData: Record<string, EthUsdcData>;
  lastError: string | null;
}

class Agent {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private stats: AgentStats = {
    status: "stopped",
    ethUsdcData: {},
    lastError: null,
  };

  constructor() {}

  async runLoop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      logger.info("Starting loop");

      const losScores = await calculateLOS();
      const _targetDistribution = getTargetDistribution(losScores);

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

      // const vaultAddress = process.env.VAULT_ADDRESS as
      //   | `0x${string}`
      //   | undefined;
      // if (vaultAddress) {
      //   await this.updateVaultData(vaultAddress);
      // }

      // const poolAddress = process.env.POOL_ADDRESS as `0x${string}` | undefined;
      // if (poolAddress) {
      //   await this.updatePoolData(poolAddress);
      // }

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

  start(intervalMs = 30_000): void {
    initializeDatabase(databasePath);
    if (this.isRunning || this.intervalId !== null) {
      logger.info("Agent already running");
      return;
    }

    this.isRunning = true;
    this.stats.status = "running";

    this.runLoop();

    this.intervalId = setInterval(() => {
      this.runLoop();
    }, intervalMs);

    logger.info({ intervalMs }, "Agent started");
  }

  stop(): void {
    if (!this.isRunning && this.intervalId === null) {
      return;
    }

    this.isRunning = false;
    this.stats.status = "stopped";

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    closeDatabase();
    logger.info("Agent stopped");
  }

  getStats(): AgentStats {
    return { ...this.stats };
  }
}

export const agent = new Agent();
