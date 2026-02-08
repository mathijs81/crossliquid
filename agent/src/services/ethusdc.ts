import { formatUnits, parseEther } from "viem";
import { iV4QuoterAbi as quoterAbi } from "../abi/IV4Quoter.js";
import { stateViewAbi } from "../abi/StateView.js";
import { chains, QUERY_POOL_KEYS, type PoolKey } from "../config.js";
import { logger } from "../logger.js";
import { createPoolId } from "../utils/poolIds.js";
import { defaultReadRetryer } from "../utils/retryer.js";
import { UNIV4_CONTRACTS } from "../contracts/contract-addresses.js";

export interface EthUsdcPoolPrice {
  poolId: `0x${string}`;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  fee: number;
  feeGrowthGlobal0: bigint;
  feeGrowthGlobal1: bigint;
}

export interface EthUsdcData {
  swapSimulation: {
    ethInput: string;
    usdcOutput: string;
    poolKey: PoolKey;
    timestamp: string;
  };
  poolPrice: EthUsdcPoolPrice;
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

  const contracts = UNIV4_CONTRACTS[chainId as keyof typeof UNIV4_CONTRACTS];
  if (!contracts) {
    throw new Error(`UniV4 contracts not configured for chain ${chainId}`);
  }

  const effectivePoolKey = poolKey || QUERY_POOL_KEYS[chainId];
  if (!effectivePoolKey) {
    throw new Error(`No default pool key for chain ${chainId}`);
  }

  try {
    const result = await defaultReadRetryer.withRetry("simulateEthToUsdcSwap", () =>
      config.publicClient.simulateContract({
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
      }),
    );

    return result.result[0];
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

export async function getEthUsdcPoolPrice(chainId: number, poolKey?: PoolKey): Promise<EthUsdcPoolPrice | null> {
  const config = chains.get(chainId);
  if (!config) {
    throw new Error(`Chain ${chainId} not initialized`);
  }

  const contracts = UNIV4_CONTRACTS[chainId];
  if (!contracts) {
    throw new Error(`UniV4 contracts not configured for chain ${chainId}`);
  }

  const effectivePoolKey = poolKey || QUERY_POOL_KEYS[chainId];
  if (!effectivePoolKey) {
    throw new Error(`No default pool key for chain ${chainId}`);
  }

  try {
    const poolId = createPoolId(effectivePoolKey);

    const results = await defaultReadRetryer.withRetry("getEthUsdcPoolPrice_multicall", () =>
      config.publicClient.multicall({
        contracts: [
          {
            address: contracts.stateView,
            abi: stateViewAbi,
            functionName: "getSlot0",
            args: [poolId],
          },
          {
            address: contracts.stateView,
            abi: stateViewAbi,
            functionName: "getLiquidity",
            args: [poolId],
          },
          {
            address: contracts.stateView,
            abi: stateViewAbi,
            functionName: "getFeeGrowthGlobals",
            args: [poolId],
          },
        ],
      }),
    );

    const [slot0Result, liquidityResult, feeGrowthResult] = results;
    if (
      slot0Result.status !== "success" ||
      liquidityResult.status !== "success" ||
      feeGrowthResult.status !== "success"
    ) {
      const failed = results
        .map((r, i) => (r.status === "failure" ? ["slot0", "liquidity", "feeGrowthGlobals"][i] : null))
        .filter(Boolean);
      logger.error({ chainId, failed }, "Multicall partial failure");
      return null;
    }

    return {
      poolId,
      sqrtPriceX96: slot0Result.result[0],
      tick: slot0Result.result[1],
      liquidity: liquidityResult.result,
      fee: slot0Result.result[3],
      feeGrowthGlobal0: feeGrowthResult.result[0],
      feeGrowthGlobal1: feeGrowthResult.result[1],
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

export async function collectEthUsdcData(chainId: number): Promise<EthUsdcData> {
  const poolKey = QUERY_POOL_KEYS[chainId];
  if (!poolKey) {
    throw new Error(`No default pool key for chain ${chainId}`);
  }

  async function getEthPriceThroughSwap() {
    // We don't swap a full eth because limited liquidity might impact the price too much
    const output = await defaultReadRetryer.withRetry("simulateEthToUsdcSwap", () =>
      simulateEthToUsdcSwap(chainId, poolKey, parseEther("0.05")),
    );
    return 20n * output;
  }

  const [usdcOutput, poolPrice] = await Promise.all([getEthPriceThroughSwap(), getEthUsdcPoolPrice(chainId, poolKey)]);

  logger.info({ chainId, usdcOutput, poolPrice }, "Collected ETH-USDC data");

  return {
    swapSimulation: {
      ethInput: "0.1",
      usdcOutput: formatUnits(usdcOutput, 6),
      poolKey,
      timestamp: new Date().toISOString(),
    },
    poolPrice: poolPrice!,
  };
}
