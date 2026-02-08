import { ChainId } from "@lifi/sdk";
import { type Chain, createPublicClient, http, type PublicClient } from "viem";
import { base, baseSepolia, foundry, mainnet, optimism, unichain, unichainSepolia } from "viem/chains";
import type { ChainConfig } from "../config.js";
import type { Environment } from "../env.js";
import { logger } from "../logger.js";

export const createClient = (chain: Chain, rpcUrl?: string): PublicClient => {
  return createPublicClient({
    chain,
    transport: rpcUrl ? http(rpcUrl) : http(),
  });
};

export const getRpcUrl = (chain: Chain): string => {
  const name = chain.name;
  const upperName = name.toUpperCase().replaceAll(" ", "_");
  //console.log(upperName);
  return process.env[`RPC_${upperName}`] || "";
};

function foundryWithMulticall3(): Chain {
  return {
    ...foundry,
    contracts: {
      ...foundry.contracts,
      multicall3: {
        address: "0xcA11bde05977b3631167028862bE2a173976CA11",
        blockCreated: 0,
      },
    },
  };
}

const allChains = new Map<number, Chain>([
  [foundry.id, foundryWithMulticall3()],
  [base.id, base],
  [optimism.id, optimism],
  [mainnet.id, mainnet],
  [unichain.id, unichain],
  [baseSepolia.id, baseSepolia],
  [unichainSepolia.id, unichainSepolia],
]);

const lifiChains = new Map<number, ChainId>([
  [foundry.id, ChainId.EVM /* this is wrong, but it won't be used anyway */],
  [base.id, ChainId.BAS],
  [optimism.id, ChainId.OPT],
  [mainnet.id, ChainId.ETH],
  [unichain.id, ChainId.UNI],
]);

function getChains(environment: Environment): number[] {
  switch (environment) {
    case "development":
      return [foundry.id];
    case "production":
      return [base.id, optimism.id, mainnet.id, unichain.id];
  }
}

export const initializeChains = (environment: Environment): Map<number, ChainConfig> => {
  const useChains = getChains(environment);

  const chains = new Map<number, ChainConfig>();

  for (const chainId of useChains) {
    const viemChain = allChains.get(chainId);
    if (!viemChain) {
      throw new Error(`Chain ${chainId} not found`);
    }
    const rpcUrl = getRpcUrl(viemChain);
    chains.set(chainId, {
      chainId,
      chainName: viemChain.name,
      rpcUrl,
      publicClient: createClient(viemChain, rpcUrl),
      viemChain,
      lifiId: lifiChains.get(chainId) || ChainId.EVM,
    });
  }
  logger.info({ environment, chains: Array.from(chains.keys()) }, "Chains initialized");
  return chains;
};
