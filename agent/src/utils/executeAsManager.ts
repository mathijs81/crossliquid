import type { Address, Hash, Hex, PublicClient, WalletClient } from "viem";
import { positionManagerAbi } from "../abi/PositionManager";
import { logger } from "../logger";

/**
 * Execute an arbitrary contract call through PositionManager.
 *
 * This uses PositionManager.bridgeToChain() as a generic call-any-contract function.
 * Useful for:
 * - Executing swaps with PositionManager's funds
 * - Managing permissions and approvals
 * - Any operation that needs to be done by PositionManager instead of the agent wallet
 *
 * @param publicClient - PublicClient for the chain
 * @param walletClient - WalletClient with operator/owner permissions
 * @param positionManagerAddress - Address of the PositionManager contract
 * @param targetContract - Address of the contract to call
 * @param calldata - Encoded function calldata
 * @param value - ETH value to send with the call (optional)
 * @returns Transaction hash
 */
export async function executeAsManager(
  publicClient: PublicClient,
  walletClient: WalletClient,
  positionManagerAddress: Address,
  targetContract: Address,
  calldata: Hex,
  value: bigint = 0n,
): Promise<Hash> {
  const account = walletClient.account;
  if (!account) {
    throw new Error("Wallet client is missing an account");
  }

  logger.info(
    {
      positionManager: positionManagerAddress,
      target: targetContract,
      value: value.toString(),
    },
    "Executing call through PositionManager",
  );

  // Use bridgeToChain as a generic "call any contract" function
  // destinationChainId=0 signals this is a local call, not a bridge
  const hash = await walletClient.writeContract({
    account,
    chain: walletClient.chain,
    address: positionManagerAddress,
    abi: positionManagerAbi,
    functionName: "bridgeToChain",
    args: [
      targetContract, // bridge (actually the target contract)
      BigInt(0), // destinationChainId (0 = local call)
      value, // amount (bigint)
      calldata, // bridgeCallData (the actual call to execute)
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash });

  logger.info({ hash }, "PositionManager call completed");

  return hash;
}

/**
 * Plan a swap execution for PositionManager without executing it.
 * Returns the target contract and calldata that should be passed to executeAsManager.
 */
export interface ManagerExecutionPlan {
  target: Address;
  calldata: Hex;
  value: bigint;
  description: string;
}

/**
 * Helper to create a ManagerExecutionPlan from swap plan data.
 */
export function createManagerSwapPlan(
  routerAddress: Address,
  swapCalldata: Hex,
  ethValue: bigint,
): ManagerExecutionPlan {
  return {
    target: routerAddress,
    calldata: swapCalldata,
    value: ethValue,
    description: `Swap via ${routerAddress} with ${ethValue} ETH`,
  };
}
