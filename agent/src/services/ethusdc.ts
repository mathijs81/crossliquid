import { encodeAbiParameters, formatUnits, keccak256, parseEther } from "viem";
import { poolManagerAbi } from "../abi/PoolManager";
import { quoterAbi } from "../abi/Quoter";
import { stateViewAbi } from "../abi/StateView";
import {
  chains,
  DEFAULT_POOL_KEYS,
  ETHUSDC_POOLS,
  type PoolKey,
  UNIV4_CONTRACTS,
} from "../config";
import { logger } from "../logger";

export interface EthUsdcPoolData {
  poolId: string;
  liquidity: bigint;
  fee: number;
  sqrtPriceX96: bigint;
  tick: number;
}

export interface EthUsdcPoolPrice {
  poolAddress: `0x${string}`;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  fee: number;
}

export interface EthUsdcData {
  swapSimulation: {
    ethInput: string;
    usdcOutput: string;
    poolKey: PoolKey;
    timestamp: string;
  };
  poolPrice: EthUsdcPoolPrice;
  topPools: EthUsdcPoolData[];
}

export async function simulateEthToUsdcSwap(
  chainId: number,
  poolKey?: PoolKey,
  ethAmount: bigint = parseEther("0.1"),
): Promise<bigint> {
  const config = chains.get(chainId);
  if (!config) {
    throw new Error(`Chain ${chainId} not initialized`);
  }

  const contracts = UNIV4_CONTRACTS[chainId];
  if (!contracts) {
    throw new Error(`UniV4 contracts not configured for chain ${chainId}`);
  }

  const effectivePoolKey = poolKey || DEFAULT_POOL_KEYS[chainId];
  if (!effectivePoolKey) {
    throw new Error(`No default pool key for chain ${chainId}`);
  }

  try {
    const result = await config.publicClient.readContract({
      address: contracts.quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey: effectivePoolKey,
          zeroForOne: true,
          exactAmount: ethAmount,
          hookData: "0x",
        },
      ],
    });

    return result[0];
  } catch (error) {
    logger.error(
      {
        chainId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to simulate ETH to USDC swap",
    );
    throw error;
  }
}

export async function getTopEthUsdcPools(
  chainId: number,
): Promise<EthUsdcPoolData[]> {
  const config = chains.get(chainId);
  if (!config) {
    throw new Error(`Chain ${chainId} not initialized`);
  }

  const contracts = UNIV4_CONTRACTS[chainId];
  if (!contracts) {
    throw new Error(`UniV4 contracts not configured for chain ${chainId}`);
  }

  const poolIds = ETHUSDC_POOLS[chainId] || [];

  try {
    const poolDataPromises = poolIds.map(async (poolId) => {
      const [slot0, liquidity] = await Promise.all([
        config.publicClient.readContract({
          address: contracts.poolManager,
          abi: poolManagerAbi,
          functionName: "getSlot0",
          args: [poolId as `0x${string}`],
        }),
        config.publicClient.readContract({
          address: contracts.poolManager,
          abi: poolManagerAbi,
          functionName: "getLiquidity",
          args: [poolId as `0x${string}`],
        }),
      ]);

      return {
        poolId,
        liquidity,
        sqrtPriceX96: slot0[0],
        tick: slot0[1],
        fee: slot0[3],
      };
    });

    const pools = await Promise.all(poolDataPromises);

    return pools.sort((a, b) => Number(b.liquidity - a.liquidity)).slice(0, 3);
  } catch (error) {
    logger.error(
      {
        chainId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to fetch ETH-USDC pool data",
    );
    throw error;
  }
}

export async function getEthUsdcPoolPrice(
  chainId: number,
  poolKey?: PoolKey,
): Promise<EthUsdcPoolPrice | null> {
  const config = chains.get(chainId);
  if (!config) {
    throw new Error(`Chain ${chainId} not initialized`);
  }

  const contracts = UNIV4_CONTRACTS[chainId];
  if (!contracts) {
    throw new Error(`UniV4 contracts not configured for chain ${chainId}`);
  }

  const effectivePoolKey = poolKey || DEFAULT_POOL_KEYS[chainId];
  if (!effectivePoolKey) {
    throw new Error(`No default pool key for chain ${chainId}`);
  }

  try {
    const poolId = keccak256(
      encodeAbiParameters(
        [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
        [
          effectivePoolKey.currency0,
          effectivePoolKey.currency1,
          effectivePoolKey.fee,
          effectivePoolKey.tickSpacing,
          effectivePoolKey.hooks,
        ],
      ),
    );

    const [slot0, liquidity] = await Promise.all([
      config.publicClient.readContract({
        address: contracts.stateView,
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [poolId],
      }),
      config.publicClient.readContract({
        address: contracts.stateView,
        abi: stateViewAbi,
        functionName: "getLiquidity",
        args: [poolId],
      }),
    ]);

    return {
      poolAddress: contracts.poolManager,
      sqrtPriceX96: slot0[0],
      tick: slot0[1],
      liquidity,
      fee: slot0[3],
    };
  } catch (error) {
    logger.error(
      {
        chainId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to fetch ETH-USDC pool price from StateView",
    );
    return null;
  }
}

export async function collectEthUsdcData(
  chainId: number,
): Promise<EthUsdcData> {
  const poolKey = DEFAULT_POOL_KEYS[chainId];
  if (!poolKey) {
    throw new Error(`No default pool key for chain ${chainId}`);
  }

  const [usdcOutput, topPools, poolPrice] = await Promise.all([
    simulateEthToUsdcSwap(chainId, poolKey),
    getTopEthUsdcPools(chainId),
    getEthUsdcPoolPrice(chainId, poolKey),
  ]);

  logger.info(
    { chainId, usdcOutput, topPools, poolPrice },
    "Collected ETH-USDC data",
  );

  return {
    swapSimulation: {
      ethInput: "0.1",
      usdcOutput: formatUnits(usdcOutput, 6),
      poolKey,
      timestamp: new Date().toISOString(),
    },
    poolPrice: poolPrice!,
    topPools,
  };
}
