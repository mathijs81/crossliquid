import type { ContractName } from "$lib/contracts/deployedContracts";
import { createErrorQuery } from "$lib/utils/query";
import type { WagmiChain } from "$lib/utils/types";
import { vaultChainId } from "$lib/wagmi/chains";
import { config } from "$lib/wagmi/config";
import { createDeployedContractInfo } from "$lib/web3/createDeployedContractInfo.svelte";
import { createQuery } from "@tanstack/svelte-query";
import { readContractQueryOptions } from "@wagmi/core/query";
import type { Abi, ContractFunctionArgs, ContractFunctionName } from "viem";
import { DEFAULT_WATCH_INTERVAL } from "./config";
import { getGlobalClient } from "./globalClient";

import { crossLiquidVaultAbi, crossLiquidVaultAddress } from "@generated";

export interface ReadQueryOptions {
  contract: `0x${string}` | ContractName;
  abi?: Abi;
  functionName: string;
  args?: readonly unknown[];
  chainId: WagmiChain;
  /**
   * Enable polling for this query
   * - false: no polling (default, relies on block watcher)
   * - true: poll at default interval (4s)
   * - number: poll at specific interval in milliseconds
   */
  watch?: boolean | number;
  enabled?: boolean;
  staleTime?: number;
}

export function readVaultQuery<
  functionName extends ContractFunctionName<
    typeof crossLiquidVaultAbi,
    "pure" | "view"
  >,
  const args extends ContractFunctionArgs<
    typeof crossLiquidVaultAbi,
    "pure" | "view",
    functionName
  >,
>(functionName: functionName, args?: args) {
  const address =
    crossLiquidVaultAddress[
      vaultChainId as keyof typeof crossLiquidVaultAddress
    ];
  if (!address) {
    return createErrorQuery(`No contract yet on chain ${vaultChainId}`);
  }
  return createQuery(
    () =>
      readContractQueryOptions(config, {
        address,
        abi: crossLiquidVaultAbi,
        functionName,
        args,
        chainId: vaultChainId,
        query: {
          enabled: true,
          refetchInterval: false,
          staleTime: 0,
        },
      }),
    getGlobalClient(),
  );
}

// export function readAbiQuery<const abi extends Abi, functionName extends ContractFunctionName<abi, "pure" | "view">,
//   const args extends ContractFunctionArgs<abi, "pure" | "view", functionName>>(
//   address: `0x${string}`, abi: abi, functionName: functionName, args: args) {
//   return createQuery(
//     () =>
//       readContractQueryOptions(config, {
//         address,
//         abi,
//         functionName,
//         args,
//         chainId: vaultChainId,
//         query: {
//           enabled: true,
//           refetchInterval: false,
//           staleTime: 0,
//         },
//       }),
//     getGlobalClient(),
//   );
// }

export function createReadQuery(options: ReadQueryOptions) {
  let contractAddress: `0x${string}`;
  let contractAbi: Abi;
  if (
    typeof options.contract === "string" &&
    options.contract.startsWith("0x")
  ) {
    if (!options.abi) {
      return createErrorQuery(
        "ABI is required when using contract address directly",
      );
    }
    contractAddress = options.contract as `0x${string}`;
    contractAbi = options.abi;
  } else {
    const contract = createDeployedContractInfo(
      options.contract,
      options.chainId,
    );
    if (!contract) {
      return createErrorQuery(`Contract ${options.contract} not found`);
    }
    contractAddress = contract.address;
    contractAbi = options.abi || contract.abi;
  }

  const refetchInterval =
    options.watch === true
      ? DEFAULT_WATCH_INTERVAL
      : typeof options.watch === "number"
        ? options.watch
        : false;

  return createQuery(
    () =>
      readContractQueryOptions(config, {
        address: contractAddress,
        abi: contractAbi,
        functionName: options.functionName,
        args: options.args,
        chainId: options.chainId,
        query: {
          enabled: options.enabled ?? true,
          refetchInterval,
          staleTime: options.staleTime,
        },
      }),
    getGlobalClient(),
  );
}
