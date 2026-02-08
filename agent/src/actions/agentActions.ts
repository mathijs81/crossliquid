/**
 * Definitions for the task runner for the actions that the agent should perform.
 */

import { formatEther } from "viem";
import {
  chains,
  createAgentWalletClient,
  getOurAddressesForChain,
} from "../config.js";
import { ZERO_ADDRESS } from "../contracts/contract-addresses.js";
import {
  createNewTask,
  type NotStartedTask,
  type TaskInfo,
  type TaskInfoUnknown,
  type ActionDefinition,
} from "../services/actionRunner.js";
import { pollTxReceipt } from "./txLifecycle.js";
import { getVaultBalance, sendSyncTransaction } from "./vaultSync.js";

export function createAgentActions(): ActionDefinition<unknown>[] {
  // Most actions work on all of the chains that we're deployed so far:

  // biome-ignore lint/suspicious/noExplicitAny: we collect different types of tasks here
  const actions: ActionDefinition<any>[] = [];

  for (const chainId of chains.keys()) {
    if (
      getOurAddressesForChain(chainId)?.vault &&
      getOurAddressesForChain(chainId)?.vault !== ZERO_ADDRESS
    ) {
      actions.push(new VaultSyncAction(chainId));
    }
    if (getOurAddressesForChain(chainId)?.manager) {
      //   actions.push(createRemoveOutofRangeLiquidityAction(chainId));
      //   actions.push(swapInbalancedTokensAction(chainId));
      //   actions.push(createAddLiquidityAction(chainId));
    }
    if (getOurAddressesForChain(chainId)?.hook) {
      // TODO: adjust hook fee
    }
  }

  // TODO: rebalance across-chain action
  // TODO: make sure vault has certain minimum amount of funds
  return actions;
}

interface VaultSyncTaskData {
  vaultBalance: bigint;
  hash: `0x${string}` | null;
}
class VaultSyncAction implements ActionDefinition<VaultSyncTaskData> {
  name: string;
  lockResources() {
    return [`chain:${this.chainId}:manager`];
  }

  constructor(private chainId: number) {
    this.name = `vault-sync-${chainId}`;
  }
  async shouldStart(existingTasks: TaskInfoUnknown[]): Promise<boolean> {
    const vaultBalance = await getVaultBalance(this.chainId);
    const intendedVaultBalance = 0; // TODO: make sure that vault has some remaining balance to redeem
    // When intendedBalance becomes > 0, we also need to 'sync' based on too low balance
    // Probably need to have a minimum difference amount
    return vaultBalance > intendedVaultBalance;
  }
  async start(
    existingTasks: TaskInfoUnknown[],
    force: boolean,
  ): Promise<NotStartedTask | TaskInfo<VaultSyncTaskData>> {
    if (force || (await this.shouldStart(existingTasks))) {
      return createNewTask(this.name, this.lockResources(), {
        vaultBalance: await getVaultBalance(this.chainId),
        hash: null,
      });
    }
    return { message: "Vault sync action not started" };
  }
  async update(
    taskInfo: TaskInfo<VaultSyncTaskData>,
  ): Promise<TaskInfo<VaultSyncTaskData>> {
    switch (taskInfo.status) {
      case "pre-start": {
        const hash = await sendSyncTransaction(
          createAgentWalletClient(this.chainId),
          taskInfo.taskData.vaultBalance,
        );
        return {
          ...taskInfo,
          taskData: { ...taskInfo.taskData, hash },
          status: "running",
          statusMessage: `Transaction ${hash} sent`,
        };
      }
      case "running": {
        const publicClient = chains.get(this.chainId)?.publicClient;
        if (!publicClient) {
          throw new Error(`No public client for chain ${this.chainId}`);
        }
        return pollTxReceipt(
          publicClient,
          taskInfo,
          () =>
            `Synced ${formatEther(taskInfo.taskData.vaultBalance)} from vault to manager`,
        );
      }
      default:
        throw new Error("Invalid task status");
    }
  }
  async stop(_taskInfo: TaskInfo<{ vaultBalance: bigint }>): Promise<void> {
    return;
  }
}
