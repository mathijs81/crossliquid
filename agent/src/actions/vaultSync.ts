import { type Account, formatEther, type WalletClient } from "viem";
import { chains, getOurAddressesForChain } from "../config.js";
import { logger } from "../logger.js";

import { positionManagerAbi } from "../abi/PositionManager.js";

export async function getVaultBalance(chainId: number): Promise<bigint> {
  const publicClient = chains.get(chainId)?.publicClient;
  if (!publicClient) {
    throw new Error(`No public client for chain ${chainId}`);
  }
  const vaultBalance = await publicClient.getBalance({
    address: getOurAddressesForChain(chainId).vault,
  });
  return vaultBalance;
}

export async function sendSyncTransaction(
  walletClient: WalletClient,
  transferAmount: bigint,
): Promise<`0x${string}`> {
  const chain = walletClient.chain!;
  const ourAddresses = getOurAddressesForChain(chain.id);
  const publicClient = chains.get(chain.id)?.publicClient;
  if (!publicClient) {
    throw new Error(`No public client for chain ${chain.id}`);
  }

  const hash = await walletClient.writeContract({
    chain,
    account: walletClient.account as Account,
    address: ourAddresses.manager,
    abi: positionManagerAbi,
    functionName: "withdrawFromVault",
    args: [transferAmount],
  });
  return hash;
}

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
  const publicClient_ = publicClient;

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
    const hash = await sendSyncTransaction(walletClient, transferAmount);
    logger.info(`Hash: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    logger.info("Transaction confirmed");
  }

  return (await printBalances()).managerBalance;

  async function printBalances() {
    const balance = await publicClient_.getBalance({
      address: ourAddresses.vault,
    });
    const managerBalance = await publicClient_.getBalance({
      address: ourAddresses.manager,
    });

    logger.info(`Vault balance: ${formatEther(balance)}`);
    logger.info(`Manager balance: ${formatEther(managerBalance)}`);
    return { vaultBalance: balance, managerBalance };
  }
}
