import { chains } from "../config";
import { logger } from "../logger";
import { poolAbi } from "../abi/Pool";
import { poolManagerAbi } from "../abi/PoolManager";

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
        abi: poolAbi,
        functionName: "slot0",
      }),
      client.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "liquidity",
      }),
      client.readContract({
        address: poolAddress,
        abi: poolAbi,
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

export const getPoolCurrentTick = async (
  chainId: number,
  poolManagerAddress: `0x${string}`,
  poolId?: `0x${string}`,
): Promise<number | null> => {
  const config = chains.get(chainId);
  if (!config) {
    return null;
  }

  try {
    const client = config.publicClient;
    const poolIdToUse =
      poolId ||
      ("0x10b70c84751672cc05d94bbe01241052e28fb05cd92fa17677324b936a155e7a" as `0x${string}`);

    const slot0 = await client.readContract({
      address: poolManagerAddress,
      abi: poolManagerAbi,
      functionName: "getSlot0",
      args: [poolIdToUse],
    });

    return Number(slot0[1]);
  } catch (error) {
    logger.error(
      {
        chainId,
        poolManagerAddress,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to fetch current tick",
    );
    return null;
  }
};
