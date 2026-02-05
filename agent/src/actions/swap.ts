import { formatUnits, parseUnits, type Address, type PublicClient } from "viem";
import { eRC20Abi } from "../abi/ERC20";
import { logger } from "../logger";
import {
  type SwapQuoteRequest,
  type SwapTradeType,
  SwappingService,
} from "../services/swapping";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export async function swapTokens(
  service: SwappingService,
  publicClient: PublicClient,
  options: {
    chainId: number;
    tokenIn: Address;
    tokenOut: Address;
    amount: string;
    tradeType: SwapTradeType;
    slippageBps: number;
    recipient: Address;
    deadlineSeconds: number;
    quoteOnly: boolean;
  },
) {
  const [tokenInDecimals, tokenOutDecimals] = await Promise.all([
    getTokenDecimals(publicClient, options.tokenIn),
    getTokenDecimals(publicClient, options.tokenOut),
  ]);

  const amountDecimals =
    options.tradeType === "EXACT_INPUT" ? tokenInDecimals : tokenOutDecimals;
  const parsedAmount = parseUnits(options.amount, amountDecimals);

  const quoteRequest: SwapQuoteRequest = {
    chainId: options.chainId,
    tokenIn: options.tokenIn,
    tokenOut: options.tokenOut,
    amount: parsedAmount,
    tradeType: options.tradeType,
    slippageBps: options.slippageBps,
    recipient: options.recipient,
    deadlineSeconds: options.deadlineSeconds,
  };

  logger.info(
    {
      chainId: options.chainId,
      tokenIn: options.tokenIn,
      tokenOut: options.tokenOut,
      amount: parsedAmount.toString(),
      tradeType: options.tradeType,
    },
    "Requesting swap quote",
  );

  const quote = await service.quoteSwap(quoteRequest);
  const formattedAmountIn = formatUnits(quote.amountIn, tokenInDecimals);
  const formattedAmountOut = formatUnits(quote.amountOut, tokenOutDecimals);

  console.log("\n✓ Quote ready");
  console.log(`Source: ${quote.quoteSource}`);
  console.log(`Amount In: ${formattedAmountIn}`);
  console.log(`Amount Out: ${formattedAmountOut}`);
  if (quote.gasEstimate !== undefined) {
    console.log(`Gas Estimate: ${quote.gasEstimate.toString()}`);
  }

  if (options.quoteOnly) {
    return;
  }

  const plan = service.buildExecutionPlan(quote, quoteRequest);
  const hash = await service.executeSwap(plan);

  console.log("\n✓ Swap executed");
  console.log(`Transaction Hash: ${hash}`);
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
