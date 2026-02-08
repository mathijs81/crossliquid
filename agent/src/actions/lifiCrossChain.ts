import { chains, getOurAddressesForChain } from "../config.js";
import { ZERO_ADDRESS } from "../contracts/contract-addresses.js";
import {
  type CrossChainRequest,
  executeCrossChainSwap,
  getCrossChainQuote,
} from "../services/swapping.js";
import { logger } from "../logger.js";
import type { WalletClient } from "viem";
import { waitForTransactionReceipt } from "viem/actions";

export async function moveManagerEthCrossChain(
  fromChain: number,
  toChain: number,
  walletClient: WalletClient,
  amount: bigint,
  dryRun: boolean = true,
): Promise<string> {
  const request: CrossChainRequest = {
    fromChain,
    toChain,
    fromAddress: getOurAddressesForChain(fromChain).manager,
    toAddress: getOurAddressesForChain(toChain).manager,
    amount,
    fromToken: ZERO_ADDRESS,
    toToken: ZERO_ADDRESS,
  };
  const quote = await getCrossChainQuote(request);
  const publicClient = chains.get(fromChain)?.publicClient;
  if (!publicClient) {
    throw new Error(`Public client not found for chain ${fromChain}`);
  }

  logger.info({ quote }, "Cross chain quote");

  if (quote.minReceive < 0.99 * Number(amount)) {
    throw new Error(
      "Insufficient min receive: expected at least 99% of the amount",
    );
  }

  if (
    quote.transactionRequest?.value &&
    BigInt(quote.transactionRequest.value) > amount
  ) {
    throw new Error("Shouldn't be sending more than we're swapping");
  }

  if (!dryRun) {
    const hash = await executeCrossChainSwap(walletClient, quote, true);
    logger.info({ hash }, "Cross chain swap executed");

    const receipt = await waitForTransactionReceipt(publicClient, {
      hash: hash as `0x${string}`,
    });
    console.log("Receipt:", receipt);
    return receipt.transactionHash;
  } else {
    return "dry run";
  }
}
