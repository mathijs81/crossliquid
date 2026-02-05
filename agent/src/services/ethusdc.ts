import { encodeAbiParameters, formatUnits, keccak256, parseEther } from "viem";
import { iPoolManagerAbi as poolManagerAbi } from "../abi/IPoolManager";
import { iV4QuoterAbi as quoterAbi } from "../abi/IV4Quoter";
import { stateViewAbi } from "../abi/StateView";
import {
  chains,
  DEFAULT_POOL_KEYS,
  ETHUSDC_POOLS,
  type PoolKey,
  UNIV4_CONTRACTS,
} from "../config";
import { logger } from "../logger";
import { defaultReadRetryer } from "../utils/retryer";
import { createPoolId } from "../utils/poolIds";

export interface EthUsdcPoolPrice {
  poolId: `0x${string}`;
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
    const result = await defaultReadRetryer.withRetry(
      "simulateEthToUsdcSwap",
      () =>
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
    const poolId = createPoolId(effectivePoolKey);

    const [slot0, liquidity] = await Promise.all([
      defaultReadRetryer.withRetry("getEthUsdcPoolPrice_slot0", () =>
        config.publicClient.readContract({
          address: contracts.stateView,
          abi: stateViewAbi,
          functionName: "getSlot0",
          args: [poolId],
        }),
      ),
      defaultReadRetryer.withRetry("getEthUsdcPoolPrice_liq", () =>
        config.publicClient.readContract({
          address: contracts.stateView,
          abi: stateViewAbi,
          functionName: "getLiquidity",
          args: [poolId],
        }),
      ),
    ]);

    return {
      poolId,
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

  async function getEthPriceThroughSwap() {
    // We don't swap a full eth because limited liquidity might impact the price too much
    const output = await defaultReadRetryer.withRetry(
      "simulateEthToUsdcSwap",
      () => simulateEthToUsdcSwap(chainId, poolKey, parseEther("0.05")),
    );
    return 20n * output;
  }

  const [usdcOutput, poolPrice] = await Promise.all([
    getEthPriceThroughSwap(),
    getEthUsdcPoolPrice(chainId, poolKey),
  ]);

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
