import type { PublicClient } from "viem";
import { chains } from "../config";

export interface LiquidityOpportunityScore {
  chainId: number;
  chainName: string;
  score: number;
  components: {
    historicYield: number;
    priceDeviation: number;
    latencyFactor: number;
    gasFactor: number;
  };
  lastUpdated: string;
}

export const calculateLOS = async (): Promise<
  Map<number, LiquidityOpportunityScore>
> => {
  const scores = new Map<number, LiquidityOpportunityScore>();

  for (const [chainId, config] of chains) {
    const score = await computeScoreForChain(chainId, config.publicClient);
    scores.set(chainId, score);
  }

  return scores;
};

const computeScoreForChain = async (
  chainId: number,
  _client: PublicClient,
): Promise<LiquidityOpportunityScore> => {
  // TODO: Implement actual LOS calculation
  // Components:
  // - historicYield: from pool fee data (requires indexing)
  // - priceDeviation: compare local price to oracle
  // - latencyFactor: estimated cross-chain transfer time
  // - gasFactor: current gas costs on chain

  const now = new Date().toISOString();

  return {
    chainId,
    chainName: chains.get(chainId)?.chainName || "Unknown",
    score: 0,
    components: {
      historicYield: 0,
      priceDeviation: 0,
      latencyFactor: 0,
      gasFactor: 0,
    },
    lastUpdated: now,
  };
};

export const getTargetDistribution = (
  _scores: Map<number, LiquidityOpportunityScore>,
): Map<number, number> => {
  // TODO: Convert LOS scores into target fund distribution percentages
  // Should factor in:
  // - Minimum viable liquidity per chain
  // - Gas costs of rebalancing
  // - Risk diversification

  const distribution = new Map<number, number>();
  for (const [chainId] of chains) {
    distribution.set(chainId, 0);
  }
  return distribution;
};
