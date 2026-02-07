import { type Account, formatEther, type WalletClient } from "viem";
import { chains, getOurAddressesForChain } from "../config.js";
import { logger } from "../logger.js";

import { positionManagerAbi } from "../abi/PositionManager.js";

/**
 * Syncs funds between vault and the manager.
 * Returns the balance of the manager after sync
 */
export async function syncVault(
  walletClient: WalletClient,
  dryRun: boolean = false,
): Promise<bigint> {
  const chain = walletClient.chain!;
  logger.info(`Syncing vault on chain ${chain.name}`);
  const ourAddresses = getOurAddressesForChain(chain.id);

  const publicClient = chains.get(chain.id)?.publicClient;
  if (!publicClient) {
    throw new Error(`No public client for chain ${chain.id}`);
  }

  const { vaultBalance, managerBalance } = await printBalances();

  if (vaultBalance > 0) {
    // TODO: leave certain % of TVL to allow redeems
    const transferAmount = vaultBalance;
    logger.info(
      `Claiming ${formatEther(transferAmount)} from vault => manager`,
    );

    if (dryRun) {
      logger.info(
        `Dry run: would claim ${formatEther(transferAmount)} from vault => manager`,
      );
      return managerBalance;
    }

    const hash = await walletClient.writeContract({
      chain,
      account: walletClient.account as Account,
      address: ourAddresses.manager,
      abi: positionManagerAbi,
      functionName: "withdrawFromVault",
      args: [transferAmount],
    });
    logger.info(`Hash: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    logger.info("Transaction confirmed");
  }

  return (await printBalances()).managerBalance;

  async function printBalances() {
    const balance = await publicClient.getBalance({
      address: ourAddresses.vault,
    });
    const managerBalance = await publicClient.getBalance({
      address: ourAddresses.manager,
    });

    logger.info(`Vault balance: ${formatEther(balance)}`);
    logger.info(`Manager balance: ${formatEther(managerBalance)}`);
    return { vaultBalance: balance, managerBalance };
  }
}
