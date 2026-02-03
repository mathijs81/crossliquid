import { chains } from "../config.js";
import { logger } from "../logger.js";

const POOL_ABI = [
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "liquidity",
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "fee",
    outputs: [{ name: "", type: "uint24" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface PoolState {
  chainId: number;
  poolAddress: `0x${string}`;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  fee: number;
  lastUpdated: string;
}

export const getPoolState = async (
  chainId: number,
  poolAddress: `0x${string}`,
): Promise<PoolState | null> => {
  const config = chains.get(chainId);
  if (!config) {
    return null;
  }

  try {
    const client = config.publicClient;
    const [slot0, liquidity, fee] = await Promise.all([
      client.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: "slot0",
      }),
      client.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: "liquidity",
      }),
      client.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: "fee",
      }),
    ]);

    return {
      chainId,
      poolAddress,
      sqrtPriceX96: slot0[0],
      tick: slot0[1],
      liquidity,
      fee,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(
      {
        chainId,
        poolAddress,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to fetch pool state",
    );
    return null;
  }
};

export const calculatePoolYield = async (
  pools: Map<number, PoolState>,
): Promise<Map<number, { dailyYield: number; feeChange: number }>> => {
  const yields = new Map<number, { dailyYield: number; feeChange: number }>();

  for (const [chainId] of pools) {
    yields.set(chainId, {
      dailyYield: 0,
      feeChange: 0,
    });
  }

  return yields;
};
