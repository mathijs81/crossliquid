import { type Chain, createPublicClient, http, type PublicClient } from "viem";
import { base, foundry, mainnet, optimism, unichain } from "viem/chains";
import type { ChainConfig, Environment } from "../config";
import { logger } from "../logger";

export const createClient = (chain: Chain, rpcUrl?: string): PublicClient => {
  return createPublicClient({
    chain,
    transport: rpcUrl ? http(rpcUrl) : http(),
  });
};

export const getRpcUrl = (chainId: number): string => {
  const envVars: Record<number, string> = {
    [base.id]: process.env.RPC_BASE || "",
    [optimism.id]: process.env.RPC_OPTIMISM || "",
    [mainnet.id]: process.env.RPC_MAINNET || "",
    [unichain.id]: process.env.RPC_UNICHAIN || "",
    [foundry.id]: process.env.RPC_FOUNDRY || "",
  };
  return envVars[chainId] || "";
};

export const initializeChains = (
  environment: Environment,
): Map<number, ChainConfig> => {
  const chains = new Map<number, ChainConfig>();

  if (environment === "development") {
    chains.set(foundry.id, {
      chainId: foundry.id,
      chainName: foundry.name,
      rpcUrl: getRpcUrl(foundry.id),
      publicClient: createClient(foundry, getRpcUrl(foundry.id)),
    });
    return chains;
  }

  chains.set(base.id, {
    chainId: base.id,
    chainName: base.name,
    rpcUrl: getRpcUrl(base.id),
    publicClient: createClient(base, getRpcUrl(base.id)),
  });

  chains.set(optimism.id, {
    chainId: optimism.id,
    chainName: optimism.name,
    rpcUrl: getRpcUrl(optimism.id),
    publicClient: createClient(optimism, getRpcUrl(optimism.id)),
  });

  chains.set(mainnet.id, {
    chainId: mainnet.id,
    chainName: mainnet.name,
    rpcUrl: getRpcUrl(mainnet.id),
    publicClient: createClient(mainnet, getRpcUrl(mainnet.id)),
  });

  chains.set(unichain.id, {
    chainId: unichain.id,
    chainName: unichain.name,
    rpcUrl: getRpcUrl(unichain.id),
    publicClient: createClient(unichain, getRpcUrl(unichain.id)),
  });

  logger.info(
    { environment, chains: Array.from(chains.keys()) },
    "Chains initialized",
  );

  return chains;
};
