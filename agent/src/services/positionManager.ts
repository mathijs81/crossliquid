import {
  type PublicClient,
  type WalletClient,
  type Address,
  type Hash,
  parseEther,
  formatEther,
  formatUnits,
  parseUnits,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { logger } from "../logger";
import { chains } from "../config";
import { type PoolKey, createEthUsdcPoolKey, FeeTier } from "./swap";
import { executeContractWrite } from "../utils/contract";
import { positionManagerAbi } from "../abi/PositionManager";

export type { PoolKey };

export interface PositionInfo {
  poolManager: Address;
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  timestamp: bigint;
}

export interface AddLiquidityParams {
  poolManagerAddress: Address;
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
}

export interface RemoveLiquidityParams {
  poolManagerAddress: Address;
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
}

export class PositionManagerService {
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  private positionManagerAddress: Address;

  constructor(
    chainId: number,
    positionManagerAddress: Address,
    privateKey?: `0x${string}`,
  ) {
    const chainConfig = chains.get(chainId);
    if (!chainConfig) {
      throw new Error(`No chain config for chain ${chainId}`);
    }

    this.publicClient = chainConfig.publicClient;
    this.positionManagerAddress = positionManagerAddress;

    if (privateKey) {
      const account = privateKeyToAccount(privateKey);
      this.walletClient = createWalletClient({
        account,
        chain: chainId === 31337 ? foundry : this.publicClient.chain!,
        transport: http(chainConfig.rpcUrl),
      });
    }
  }

  async getAllPositions(): Promise<{
    ids: `0x${string}`[];
    positions: PositionInfo[];
    currentTicks: number[];
    inRange: boolean[];
  }> {
    const result = await this.publicClient.readContract({
      address: this.positionManagerAddress,
      abi: positionManagerAbi,
      functionName: "getAllPositionsWithPoolState",
    });

    return {
      ids: [...result[0]],
      positions: result[1].map((p) => ({
        poolManager: p.poolManager,
        poolKey: p.poolKey,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        liquidity: p.liquidity,
        amount0: p.amount0,
        amount1: p.amount1,
        timestamp: p.timestamp,
      })),
      currentTicks: result[2].map((t) => Number(t)),
      inRange: [...result[3]],
    };
  }

  async addLiquidity(params: AddLiquidityParams): Promise<{
    hash: Hash;
    liquidityAdded: bigint;
    amount0: bigint;
    amount1: bigint;
  }> {
    if (!this.walletClient) {
      throw new Error("Wallet client not initialized");
    }

    const { result, hash } = await executeContractWrite(
      this.publicClient,
      this.walletClient,
      {
        address: this.positionManagerAddress,
        abi: positionManagerAbi,
        functionName: "depositToUniswap",
        args: [
          params.poolManagerAddress,
          params.poolKey,
          params.tickLower,
          params.tickUpper,
          params.amount0Desired,
          params.amount1Desired,
          params.amount0Min,
          params.amount1Min,
        ],
        account: this.walletClient.account,
      },
    );

    const [liquidityAdded, amount0, amount1] = result;

    logger.info(
      {
        hash,
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        liquidityAdded: liquidityAdded.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
      },
      "Liquidity added successfully",
    );

    return {
      hash,
      liquidityAdded,
      amount0,
      amount1,
    };
  }

  async removeLiquidity(params: RemoveLiquidityParams): Promise<{
    hash: Hash;
    amount0: bigint;
    amount1: bigint;
  }> {
    if (!this.walletClient) {
      throw new Error("Wallet client not initialized");
    }

    const { result, hash } = await executeContractWrite(
      this.publicClient,
      this.walletClient,
      {
        address: this.positionManagerAddress,
        abi: positionManagerAbi,
        functionName: "withdrawFromUniswap",
        args: [
          params.poolManagerAddress,
          params.poolKey,
          params.tickLower,
          params.tickUpper,
          params.liquidity,
          params.amount0Min,
          params.amount1Min,
        ],
        account: this.walletClient.account,
      },
    );

    const [amount0, amount1] = result;

    logger.info(
      {
        hash,
        liquidity: params.liquidity.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
      },
      "Liquidity removed successfully",
    );

    return {
      hash,
      amount0,
      amount1,
    };
  }
}

export function calculateTickRange(
  currentTick: number,
  tickSpacing: number,
  rangeWidth: number = 2000,
): { tickLower: number; tickUpper: number } {
  const normalizedTick = Math.floor(currentTick / tickSpacing) * tickSpacing;
  const halfRange = Math.floor(rangeWidth / tickSpacing / 2) * tickSpacing;

  return {
    tickLower: normalizedTick - halfRange,
    tickUpper: normalizedTick + halfRange,
  };
}

export function formatPosition(position: PositionInfo): string {
  return `
Position:
  Pool Manager: ${position.poolManager}
  Currency0: ${position.poolKey.currency0}
  Currency1: ${position.poolKey.currency1}
  Fee: ${position.poolKey.fee / 10000}%
  Tick Range: [${position.tickLower}, ${position.tickUpper}]
  Liquidity: ${position.liquidity}
  Amount0: ${position.amount0}
  Amount1: ${position.amount1}
  Timestamp: ${new Date(Number(position.timestamp) * 1000).toISOString()}
  `.trim();
}
