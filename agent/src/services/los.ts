import type { PublicClient } from "viem";
import { chains } from "../config.js";
import { logger } from "../logger.js";
import { MetricsService, type ChainMetrics } from "./metrics.js";

export interface LiquidityOpportunityScore {
  chainId: number;
  chainName: string;
  score: number;
  components: {
    feeYieldRate: number;
    volatility: number;
    gasFactor: number;
  };
  targetAllocation: number;
  lastUpdated: string;
}

/**
 * Calculate LOS: liquidity opportunity score.
 *
 * This is calculated by:
 *
 * 0.7 * feeYieldRate + 0.2 * volatility + 0.1 * gasFactor
 *
 * We try to get each of those values to range from 0-10.
 */

// Gas cost multipliers
const GAS_SCORES: Record<number, number> = {
  1: 3, // Mainnet - expensiv-ish, 0.x gwei
  10: 10, // Optimism - very cheap, usually 0.00[x] gwei
  8453: 8, // Base - cheap, 0.0x gwei
  130: 10, // Unichain - very cheap, 0.00x

  31337: 5, // dev mode
};

export const calculateLOS = async (): Promise<
  Map<number, LiquidityOpportunityScore>
> => {
  const scores = new Map<number, LiquidityOpportunityScore>();

  const chainIds = Array.from(chains.keys());
  const metricsMap =
    await MetricsService.calculateMetricsForAllChains(chainIds);

  for (const [chainId, config] of chains) {
    const metrics = metricsMap.get(chainId);
    const score = computeScoreForChain(
      chainId,
      config.publicClient,
      metrics || null,
    );
    scores.set(chainId, score);
  }

  // Calculate target allocations based on scores
  // We use a softmax-like transformation so that a higher score quickly
  // dominates

  const scoreMap = new Map<number, number>();
  for (const [chainId, score] of scores) {
    scoreMap.set(chainId, score.score);
  }
  // Note: for now we set mainnet to 0 because of the gas fees
  scoreMap.set(1, -1000);
  const maxScore = Math.max(...scoreMap.values());

  // Apply softmax transformation
  for (const [chainId, score] of scoreMap) {
    scoreMap.set(chainId, Math.exp(score - maxScore));
  }
  const totalSoftmaxScore = Array.from(scoreMap.values()).reduce(
    (sum, s) => sum + s,
    0,
  );
  for (const [chainId, score] of scoreMap) {
    const allocation = (score / totalSoftmaxScore) * 100;
    // Don't allocate less than 5% to any chain
    if (allocation < 5) {
      scoreMap.set(chainId, 0);
    } else {
      scoreMap.set(chainId, allocation);
    }
  }

  // Rescale in case we didn't get to 100 because of the 5% threshold
  const totalAllocation = Array.from(scoreMap.values()).reduce(
    (sum, s) => sum + s,
    0,
  );
  for (const [chainId, score] of scoreMap) {
    scoreMap.set(chainId, (score / totalAllocation) * 100);
  }

  for (const [chainId, score] of scores) {
    score.targetAllocation = scoreMap.get(chainId) || 0;
    scores.set(chainId, score);
  }
  return scores;
};

const computeScoreForChain = (
  chainId: number,
  _client: PublicClient,
  metrics: ChainMetrics | null,
): LiquidityOpportunityScore => {
  const now = new Date().toISOString();
  const chainName = chains.get(chainId)?.chainName || "Unknown";

  if (!metrics) {
    logger.warn({ chainId, chainName }, "No metrics available for chain");
    return {
      chainId,
      chainName,
      score: 0,
      components: {
        feeYieldRate: 0,
        volatility: 0,
        gasFactor: 0,
      },
      targetAllocation: 0,
      lastUpdated: now,
    };
  }

  // Component 1: Fee yield rate (70% weight)
  // Use 4hr window as the primary signal (balances responsiveness with stability)
  const feeYieldRate =
    (metrics.apr4hr || metrics.apr30min || metrics.apr1day)?.feeApr || 0;

  // Component 2: Volatility (20% weight)
  // Higher volatility = more trading = more fees
  const volatility =
    (metrics.volatility4hr || metrics.volatility30min || metrics.volatility1day)
      ?.priceVolatility || 0;

  // Component 3: Gas cost factor (10% weight)
  // Penalize expensive chains
  const gasFactor = GAS_SCORES[chainId];

  // Calculate weighted score
  const score =
    // APRs are typically around 0-10%, so we can just take this value * 100 to get 0-10 score
    feeYieldRate * 100 * 0.7 + // Primary signal: fee earning potential
    // Volatility is typically 0-2%, so convert to percentages and *5
    volatility * 500 * 0.2 + // Scale volatility to similar magnitude
    gasFactor * 0.1; // Minor adjustment for gas costs

  // logger.debug(
  //   {
  //     chainId,
  //     chainName,
  //     score,
  //     feeYieldRate,
  //     volatility,
  //     gasFactor,
  //   },
  //   "LOS computed",
  // );

  return {
    chainId,
    chainName,
    score,
    components: {
      feeYieldRate,
      volatility,
      gasFactor,
    },
    targetAllocation: 0, // Will be set after all scores are calculated
    lastUpdated: now,
  };
};