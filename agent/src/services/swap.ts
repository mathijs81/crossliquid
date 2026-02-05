import {
  type Address,
  formatEther,
  formatUnits,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { eRC20Abi as erc20Abi } from "../abi/ERC20";
import { iPoolManagerAbi as poolManagerAbi } from "../abi/IPoolManager";
import { logger } from "../logger";
import { executeContractWrite } from "../utils/contract";
import { createEthUsdcPoolKey, FeeTier, type PoolKey } from "../utils/poolIds";

export interface SwapParams {
  poolManagerAddress: Address;
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountSpecified: bigint;
  sqrtPriceLimitX96?: bigint;
}

const MIN_SQRT_PRICE = 4295128739n;
const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

export class SwapService {
  constructor(
    private publicClient: PublicClient,
    private walletClient: WalletClient,
  ) {}

  async swapEthForUsdc(
    poolManagerAddress: Address,
    usdcAddress: Address,
    ethAmount: bigint,
    feeTier: FeeTier = FeeTier.LOW,
  ): Promise<{ hash: Hash; usdcReceived: bigint }> {
    logger.info({ ethAmount: formatEther(ethAmount) }, "Swapping ETH for USDC");

    const poolKey = createEthUsdcPoolKey(usdcAddress, feeTier);

    const { result, hash } = await executeContractWrite(
      this.publicClient,
      this.walletClient,
      {
        address: poolManagerAddress,
        abi: poolManagerAbi,
        functionName: "swap",
        args: [
          poolKey,
          {
            zeroForOne: true,
            amountSpecified: ethAmount,
            sqrtPriceLimitX96: MIN_SQRT_PRICE,
          },
          "0x",
        ],
        account: this.walletClient.account!,
        value: ethAmount,
      },
    );

    const delta = result;
    const usdcReceived = delta < 0n ? -delta : delta;

    logger.info(
      { hash, usdcReceived: formatUnits(usdcReceived, 6) },
      "ETH to USDC swap successful",
    );

    return {
      hash,
      usdcReceived,
    };
  }

  async swapUsdcForEth(
    poolManagerAddress: Address,
    usdcAddress: Address,
    usdcAmount: bigint,
    feeTier: FeeTier = FeeTier.LOW,
  ): Promise<{ hash: Hash; ethReceived: bigint }> {
    logger.info(
      { usdcAmount: formatUnits(usdcAmount, 6) },
      "Swapping USDC for ETH",
    );

    const { hash: approvalHash } = await executeContractWrite(
      this.publicClient,
      this.walletClient,
      {
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [poolManagerAddress, usdcAmount],
      },
    );

    logger.info({ hash: approvalHash }, "USDC approved for swap");

    const poolKey = createEthUsdcPoolKey(usdcAddress, feeTier);

    const { result, hash } = await executeContractWrite(
      this.publicClient,
      this.walletClient,
      {
        address: poolManagerAddress,
        abi: poolManagerAbi,
        functionName: "swap",
        args: [
          poolKey,
          {
            zeroForOne: false,
            amountSpecified: usdcAmount,
            sqrtPriceLimitX96: MAX_SQRT_PRICE,
          },
          "0x",
        ],
        account: this.walletClient.account!,
      },
    );

    const delta = result;
    const ethReceived = delta < 0n ? -delta : delta;

    logger.info(
      { hash, ethReceived: formatEther(ethReceived) },
      "USDC to ETH swap successful",
    );

    return {
      hash,
      ethReceived,
    };
  }

  async getBalance(
    tokenAddress: Address,
    accountAddress: Address,
  ): Promise<bigint> {
    if (tokenAddress === "0x0000000000000000000000000000000000000000") {
      return await this.publicClient.getBalance({ address: accountAddress });
    }

    return await this.publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [accountAddress],
    });
  }
}

export interface BalancedAmounts {
  amount0: bigint;
  amount1: bigint;
  needsSwap: boolean;
  swapZeroForOne?: boolean;
  swapAmount?: bigint;
}

export function calculateBalancedAmounts(
  currentPrice: bigint,
  tickLower: number,
  tickUpper: number,
  availableAmount0: bigint,
  availableAmount1: bigint,
): BalancedAmounts {
  // This is a simplified calculation
  // In a real implementation, you would use Uniswap's math libraries
  // to calculate the exact ratio needed based on the tick range

  const ratio = 0.5;
  const targetAmount0 =
    (availableAmount0 * BigInt(Math.floor(ratio * 100))) / 100n;
  const targetAmount1 = availableAmount1;

  return {
    amount0: targetAmount0,
    amount1: targetAmount1,
    needsSwap: false,
  };
}
