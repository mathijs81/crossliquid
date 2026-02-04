import { formatUnits, parseEther } from "viem";
import {
  chains,
  DEFAULT_POOL_KEYS,
  ETHUSDC_POOLS,
  ETHUSDC_ZERO_FOR_ONE,
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

export interface EthUsdcData {
  swapSimulation: {
    ethInput: string;
    usdcOutput: string;
    poolKey: PoolKey;
    timestamp: string;
  };
  topPools: EthUsdcPoolData[];
}

const QUOTER_ABI = [
  {
    "inputs": [
      {
        "components": [
          {
            "components": [
              {
                "internalType": "Currency",
                "name": "currency0",
                "type": "address"
              },
              {
                "internalType": "Currency",
                "name": "currency1",
                "type": "address"
              },
              { "internalType": "uint24", "name": "fee", "type": "uint24" },
              {
                "internalType": "int24",
                "name": "tickSpacing",
                "type": "int24"
              },
              {
                "internalType": "contract IHooks",
                "name": "hooks",
                "type": "address"
              }
            ],
            "internalType": "struct PoolKey",
            "name": "poolKey",
            "type": "tuple"
          },
          { "internalType": "bool", "name": "zeroForOne", "type": "bool" },
          {
            "internalType": "uint128",
            "name": "exactAmount",
            "type": "uint128"
          },
          { "internalType": "bytes", "name": "hookData", "type": "bytes" }
        ],
        "internalType": "struct IV4Quoter.QuoteExactSingleParams",
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "quoteExactInputSingle",
    "outputs": [
      { "internalType": "uint256", "name": "amountOut", "type": "uint256" },
      { "internalType": "uint256", "name": "gasEstimate", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

const POOL_MANAGER_ABI = [
  {
    inputs: [{ name: "id", type: "bytes32" }],
    name: "getSlot0",
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "id", type: "bytes32" }],
    name: "getLiquidity",
    outputs: [{ name: "liquidity", type: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

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

  /*
          PoolKey poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
  */
  try {
    const result = await config.publicClient.readContract({
      address: contracts.quoter,
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: effectivePoolKey, zeroForOne: ETHUSDC_ZERO_FOR_ONE[chainId], exactAmount: ethAmount, hookData: "0x" }],
    });

    return result[0];//(await result).result[0];
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
          abi: POOL_MANAGER_ABI,
          functionName: "getSlot0",
          args: [poolId as `0x${string}`],
        }),
        config.publicClient.readContract({
          address: contracts.poolManager,
          abi: POOL_MANAGER_ABI,
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

export async function collectEthUsdcData(
  chainId: number,
): Promise<EthUsdcData> {
  const poolKey = DEFAULT_POOL_KEYS[chainId];
  if (!poolKey) {
    throw new Error(`No default pool key for chain ${chainId}`);
  }

  const [usdcOutput, topPools] = await Promise.all([
    simulateEthToUsdcSwap(chainId, poolKey),
    getTopEthUsdcPools(chainId),
  ]);

  logger.info({ chainId, usdcOutput, topPools }, "Collected ETH-USDC data");

  return {
    swapSimulation: {
      ethInput: "0.1",
      usdcOutput: formatUnits(usdcOutput, 6),
      poolKey,
      timestamp: new Date().toISOString(),
    },
    topPools,
  };
}
