import {
  formatUnits,
  parseUnits,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { eRC20Abi } from "../abi/ERC20.js";
import { logger } from "../logger.js";
import type {
  SwapQuoteRequest,
  SwappingService,
} from "../services/swapping.js";
import { executeAsManager } from "../utils/executeAsManager.js";
import { waitForTransactionReceipt } from "viem/actions";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export async function swapTokens(
  service: SwappingService,
  publicClient: PublicClient,
  walletClient: WalletClient,
  options: {
    chainId: number;
    tokenIn: Address;
    tokenOut: Address;
    amountIn: string;
    slippageBps: number;
    recipient: Address;
    deadlineSeconds: number;
    quoteOnly: boolean;
    forManager: boolean;
    positionManagerAddress: Address;
    useProductionRouting?: boolean;
  },
) {
  const [tokenInDecimals, tokenOutDecimals] = await Promise.all([
    getTokenDecimals(publicClient, options.tokenIn),
    getTokenDecimals(publicClient, options.tokenOut),
  ]);

  const parsedAmountIn = parseUnits(options.amountIn, tokenInDecimals);

  const quoteRequest: SwapQuoteRequest = {
    chainId: options.chainId,
    tokenIn: options.tokenIn,
    tokenOut: options.tokenOut,
    amountIn: parsedAmountIn,
    slippageBps: options.slippageBps,
    recipient: options.recipient,
    deadlineSeconds: options.deadlineSeconds,
    forManager: options.forManager,
    useProductionRouting: options.useProductionRouting,
  };

  logger.info(
    {
      chainId: options.chainId,
      tokenIn: options.tokenIn,
      tokenOut: options.tokenOut,
      amountIn: parsedAmountIn.toString(),
      forManager: options.forManager,
      useProductionRouting: options.useProductionRouting,
    },
    "Requesting swap quote",
  );

  const quote = await service.quoteSwap(quoteRequest);
  const formattedAmountIn = formatUnits(quote.amountIn, tokenInDecimals);
  const formattedAmountOut = formatUnits(quote.amountOut, tokenOutDecimals);

  console.log("\n✓ Quote ready");
  console.log(`Source: ${quote.quoteSource}`);
  console.log(
    `Execution Mode: ${options.forManager ? "via PositionManager" : "direct from wallet"}`,
  );
  console.log(`Amount In: ${formattedAmountIn}`);
  console.log(`Amount Out: ${formattedAmountOut}`);
  if (quote.gasEstimate !== undefined) {
    console.log(`Gas Estimate: ${quote.gasEstimate.toString()}`);
  }

  if (options.quoteOnly) {
    return;
  }

  const plan = service.buildExecutionPlan(quote, quoteRequest);

  console.log("\n📋 Execution Plan:");
  console.log(`Target: ${plan.to}`);
  console.log(`Value: ${plan.value}`);
  console.log(`Calldata length: ${plan.data.length} bytes`);
  console.log(
    `Approval needed: ${plan.approvalAmount > 0n ? plan.approvalAmount.toString() : "none"}`,
  );

  if (options.quoteOnly) {
    console.log("\n(Quote only - no execution)");
    return;
  }

  let hash: string;
  if (options.forManager) {
    console.log("\n⚙ Executing swap through PositionManager...");
    hash = await executeAsManager(
      publicClient,
      walletClient,
      options.positionManagerAddress,
      plan.to,
      plan.data,
      plan.value,
    );
  } else {
    console.log("\n⚙ Executing swap from wallet...");
    hash = await service.executeSwap(plan);
  }

  console.log("\n✓ Swap executed");
  console.log(`Transaction Hash: ${hash}`);

  const receipt = await waitForTransactionReceipt(publicClient, {
    hash: hash as `0x${string}`,
  });
  console.log("Receipt:", receipt);
}

async function getTokenDecimals(
  publicClient: PublicClient,
  token: Address,
): Promise<number> {
  if (token.toLowerCase() === ZERO_ADDRESS) {
    return 18;
  }

  const decimals = await publicClient.readContract({
    address: token,
    abi: eRC20Abi,
    functionName: "decimals",
    args: [],
  });

  return Number(decimals);
}
