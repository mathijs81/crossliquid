import { type Chain, createPublicClient, http, type PublicClient } from "viem";
import { base, mainnet, optimism } from "viem/chains";
import { logger } from "./logger.js";

export interface ChainConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  publicClient: PublicClient;
}

const createClient = (chain: Chain, rpcUrl?: string) => {
  return createPublicClient({
    chain,
    transport: rpcUrl ? http(rpcUrl) : http(),
  });
};

const getRpcUrl = (chainId: number): string => {
  const envVars: Record<number, string> = {
    [base.id]: process.env.RPC_BASE || "",
    [optimism.id]: process.env.RPC_OPTIMISM || "",
    [mainnet.id]: process.env.RPC_MAINNET || "",
  };
  return envVars[chainId] || "";
};

export const chains: Map<number, ChainConfig> = new Map();

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

const validatePrivateKey = (
  key: string | undefined,
): `0x${string}` | undefined => {
  if (!key) {
    return undefined;
  }

  if (!key.startsWith("0x") || key.length !== 66) {
    logger.error(
      { keyLength: key.length, hasPrefix: key.startsWith("0x") },
      "Invalid private key format - must be 0x followed by 64 hex characters",
    );
    throw new Error("VAULT_PRIVATE_KEY is invalid");
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    logger.error("Private key contains invalid characters");
    throw new Error("VAULT_PRIVATE_KEY contains invalid hex characters");
  }

  return key as `0x${string}`;
};

const validateAddress = (
  address: string | undefined,
): `0x${string}` | undefined => {
  if (!address) {
    return undefined;
  }

  if (!address.startsWith("0x") || address.length !== 42) {
    logger.error(
      { addressLength: address.length },
      "Invalid address format - must be 0x followed by 40 hex characters",
    );
    throw new Error("Invalid address format");
  }

  return address as `0x${string}`;
};

export const agentConfig = {
  intervalMs: Number.parseInt(process.env.AGENT_INTERVAL_MS || "30000", 10),
  logLevel: process.env.AGENT_LOG_LEVEL || "info",
  lifiApiKey: process.env.LIFI_API_KEY || "",
  lifiRouterAddress: validateAddress(process.env.LIFI_ROUTER_ADDRESS),
  vaultPrivateKey: validatePrivateKey(process.env.VAULT_PRIVATE_KEY),
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL,
};
