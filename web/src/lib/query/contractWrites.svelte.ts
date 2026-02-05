import type { ContractName } from "$lib/contracts/deployedContracts";
import { createErrorMutation } from "$lib/utils/query";
import type { WagmiChain } from "$lib/utils/types";
import { config } from "$lib/wagmi/config";
import { createDeployedContractInfo } from "$lib/web3/createDeployedContractInfo.svelte";
import { txWatcher } from "$lib/web3/txWatcher.svelte";
import { error } from "@sveltejs/kit";
import {
  createMutation,
  useQueryClient,
  type CreateMutationResult,
} from "@tanstack/svelte-query";
import type { Abi, Address, TransactionReceipt } from "viem";
import { getGlobalClient } from "./globalClient";

export interface UseContractWriteOptions {
  contract: `0x${string}` | ContractName;
  abi?: Abi;
  functionName?: string;
  chainId: WagmiChain;
  invalidateKeys?: string[][];
  waitForConfirmation?: boolean;
  confirmations?: number;
  onSent?: (hash: `0x${string}`) => void;
  onConfirmed?: (receipt: TransactionReceipt) => void;
  onError?: (error: Error) => void;
}

export type ContractWriteVariables = {
  functionName?: string;
  args?: readonly unknown[];
  value?: bigint;
  gas?: bigint;
};

export function useContractWrite(
  options: UseContractWriteOptions,
): CreateMutationResult<Address, Error, ContractWriteVariables, void> {
  const queryClient = getGlobalClient()?.() ?? useQueryClient();

  let contractAddress: `0x${string}`;
  let contractAbi: Abi;
  let contractName: string | undefined;

  if (
    typeof options.contract === "string" &&
    options.contract.startsWith("0x")
  ) {
    if (!options.abi) {
      return createErrorMutation(
        "ABI is required when using contract address directly",
      );
    }
    contractAddress = options.contract as `0x${string}`;
    contractAbi = options.abi;
    contractName = undefined;
  } else {
    const contract = createDeployedContractInfo(
      options.contract,
      options.chainId,
    );
    if (!contract) {
      return createErrorMutation(`Contract ${options.contract} not found`);
    }
    contractAddress = contract.address;
    contractAbi = options.abi || contract.abi;
    contractName = options.contract as string;
  }

  return createMutation(
    () => ({
      mutationFn: async (variables: ContractWriteVariables) => {
        const { writeContract } = await import("@wagmi/core");
        const functionName = options.functionName || variables.functionName;
        if (!functionName) {
          throw error(400, "Function name is required");
        }
        return writeContract(config, {
          address: contractAddress,
          abi: contractAbi,
          functionName,
          args: variables.args,
          value: variables.value,
          gas: variables.gas,
        });
      },
      onMutate: async () => {
        if (options.invalidateKeys) {
          for (const key of options.invalidateKeys) {
            await queryClient.cancelQueries({ queryKey: key });
          }
        }
      },
      onSuccess: async (
        hash: `0x${string}`,
        variables: ContractWriteVariables,
      ) => {
        options.onSent?.(hash);

        if (contractName || options.functionName) {
          txWatcher.watch(hash, options.chainId, {
            contractName,
            functionName: variables.functionName,
          });
        }

        if (options.waitForConfirmation !== false) {
          try {
            const { waitForTransactionReceipt } = await import("@wagmi/core");
            const receipt = await waitForTransactionReceipt(config, {
              hash,
              confirmations: options.confirmations ?? 1,
            });

            options.onConfirmed?.(receipt);

            if (options.invalidateKeys) {
              for (const key of options.invalidateKeys) {
                queryClient.invalidateQueries({ queryKey: key });
              }
            }
          } catch (error) {
            options.onError?.(error as Error);
          }
        } else if (options.invalidateKeys) {
          for (const key of options.invalidateKeys) {
            queryClient.invalidateQueries({ queryKey: key });
          }
        }
      },
      onError: (error: Error) => {
        options.onError?.(error);
      },
    }),
    getGlobalClient(),
  );
}
