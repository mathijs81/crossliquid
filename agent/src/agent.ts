import { type Chain, createPublicClient, http, type PublicClient } from "viem";
import { base, mainnet, optimism } from "viem/chains";
import { logger } from "./logger.js";
import {
  calculateLOS,
  getPoolState,
  getTargetDistribution,
  getVaultState,
} from "./services/index.js";

export interface AgentStats {
  status: "running" | "stopped";
  lastUpdate: string | null;
  chainStats: Record<string, ChainStats>;
  lastError: string | null;
}

export interface ChainStats {
  chainId: number;
  chainName: string;
  connected: boolean;
  lastChecked: string | null;
  lastLatencyMs: number | null;
}

interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

class Agent {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private stats: AgentStats = {
    status: "stopped",
    lastUpdate: null,
    chainStats: {},
    lastError: null,
  };

  private clients: Map<number, PublicClient> = new Map();

  constructor() {
    this.initializeClients();
    this.initializeChainStats();
  }

  private initializeClients(): void {
    const chainList: { chain: Chain; rpcUrl?: string }[] = [
      { chain: base, rpcUrl: process.env.RPC_BASE },
      { chain: optimism, rpcUrl: process.env.RPC_OPTIMISM },
      { chain: mainnet, rpcUrl: process.env.RPC_MAINNET },
    ];

    for (const { chain, rpcUrl } of chainList) {
      const client = createPublicClient({
        chain,
        transport: rpcUrl ? http(rpcUrl) : http(),
      });
      this.clients.set(chain.id, client);
    }
  }

  private initializeChainStats(): void {
    const chainList = [base, optimism, mainnet];
    for (const chain of chainList) {
      this.stats.chainStats[String(chain.id)] = {
        chainId: chain.id,
        chainName: chain.name,
        connected: false,
        lastChecked: null,
        lastLatencyMs: null,
      };
    }
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    chainId: number,
  ): Promise<T | null> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
      try {
        const start = performance.now();
        const result = await operation();
        const latency = performance.now() - start;

        this.updateChainLatency(chainId, latency);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const delay = Math.min(
          RETRY_CONFIG.baseDelayMs * 2 ** (attempt - 1),
          RETRY_CONFIG.maxDelayMs,
        );

        if (attempt < RETRY_CONFIG.maxAttempts) {
          logger.warn(
            { chainId, attempt, delay, error: lastError.message },
            "Chain operation failed, retrying",
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.error(
      {
        chainId,
        attempts: RETRY_CONFIG.maxAttempts,
        error: lastError?.message,
      },
      "Chain operation failed after all retries",
    );
    return null;
  }

  private updateChainLatency(chainId: number, latencyMs: number): void {
    const chainKey = String(chainId);
    if (this.stats.chainStats[chainKey]) {
      this.stats.chainStats[chainKey].lastLatencyMs = latencyMs;
    }
  }

  async checkChainConnection(chainId: number): Promise<boolean> {
    const client = this.clients.get(chainId);
    if (!client) {
      return false;
    }

    const result = await this.withRetry(() => client.getBlockNumber(), chainId);

    return result !== null;
  }

  async updateChainStats(): Promise<void> {
    const now = new Date().toISOString();

    for (const [chainIdStr, chainStat] of Object.entries(
      this.stats.chainStats,
    )) {
      const chainId = Number.parseInt(chainIdStr, 10);
      const connected = await this.checkChainConnection(chainId);

      this.stats.chainStats[chainIdStr] = {
        ...chainStat,
        connected,
        lastChecked: now,
      };
    }

    this.stats.lastUpdate = now;
  }

  async runLoop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.updateChainStats();

      const losScores = await calculateLOS();
      const _targetDistribution = getTargetDistribution(losScores);

      const vaultAddress = process.env.VAULT_ADDRESS as
        | `0x${string}`
        | undefined;
      if (vaultAddress) {
        await this.updateVaultData(vaultAddress);
      }

      const poolAddress = process.env.POOL_ADDRESS as `0x${string}` | undefined;
      if (poolAddress) {
        await this.updatePoolData(poolAddress);
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
    for (const [chainId] of this.clients) {
      const state = await getVaultState(chainId, vaultAddress);
      if (!state) {
        logger.warn({ chainId, vaultAddress }, "Failed to fetch vault state");
      }
    }
  }

  private async updatePoolData(poolAddress: `0x${string}`): Promise<void> {
    for (const [chainId] of this.clients) {
      const state = await getPoolState(chainId, poolAddress);
      if (!state) {
        logger.warn({ chainId, poolAddress }, "Failed to fetch pool state");
      }
    }
  }

  start(intervalMs = 30_000): void {
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

    logger.info("Agent stopped");
  }

  getStats(): AgentStats {
    return { ...this.stats };
  }
}

export const agent = new Agent();
