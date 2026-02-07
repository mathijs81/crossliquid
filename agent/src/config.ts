import type { ChainId } from "@lifi/sdk";
import { type Chain, createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { UNIV4_CONTRACTS, ZERO_ADDRESS } from "./contracts/contract-addresses.js";
import { deployedContracts } from "./contracts/deployed.js";
import { readOurDeployment } from "./dev/dev-config.js";
import { logger } from "./logger.js";
import { initializeChains } from "./utils/chain.js";
import { validateAddress, validatePrivateKey } from "./utils/validation.js";
import { ENVIRONMENT } from "./env.js";

export interface ChainConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  publicClient: PublicClient;
  viemChain: Chain;
  lifiId: ChainId;
}


export interface PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

export const databasePath =
  ENVIRONMENT === "production" ? "./data/agent.db" : "./data/agent-dev.db";

export const ETHUSDC_POOLS: Record<number, string[]> = {
  8453: [],
  10: [],
  130: [],
};

interface DeployedContracts {
  vault: `0x${string}`;
  manager: `0x${string}`;
  hook: `0x${string}`;
}
const DYNAMIC_FEE_FLAG = 0x800000;

export function getOurAddressesForChain(chainId: number): DeployedContracts {
  if (ENVIRONMENT === "development") {
    return readOurDeployment();
  } else {
    return deployedContracts[
      chainId as keyof typeof deployedContracts
    ] as unknown as DeployedContracts;
  }
}

/**
 * Pool keys where we want our funds to be deposited. Note: until we have decent
 * liquidity in these pools, we probably want to query the regular (no hook) pools
 * for current prices.
 */
export const DEFAULT_POOL_KEYS: Record<number, PoolKey> = Object.fromEntries(
  Object.keys(UNIV4_CONTRACTS).map((chainId) => {
    const id = Number(chainId);
    const hookAddress = getOurAddressesForChain(id)?.hook ?? ZERO_ADDRESS;
    if (hookAddress === ZERO_ADDRESS) {
      logger.warn(`No hook address found for chain ${id}, using no hook!`);
    }
    const isDynamic = hookAddress !== ZERO_ADDRESS;
    return [
      id,
      {
        currency0: ZERO_ADDRESS,
        currency1: UNIV4_CONTRACTS[id].usdc,
        fee: isDynamic ? DYNAMIC_FEE_FLAG : 500,
        tickSpacing: 10,
        hooks: hookAddress,
      },
    ];
  }),
);

export const QUERY_POOL_KEYS: Record<number, PoolKey> = Object.fromEntries(
  Object.keys(UNIV4_CONTRACTS).map((chainId) => {
    const id = Number(chainId);
    return [
      id,
      {
        currency0: ZERO_ADDRESS,
        currency1: UNIV4_CONTRACTS[id].usdc,
        fee: 500,
        tickSpacing: 10,
        hooks: ZERO_ADDRESS,
      },
    ];
  }),
);

export const chains: Map<number, ChainConfig> = initializeChains(ENVIRONMENT);

export const agentConfig = {
  intervalMs: Number.parseInt(process.env.AGENT_INTERVAL_MS || "30000", 10),
  logLevel: process.env.AGENT_LOG_LEVEL || "info",
  lifiApiKey: process.env.LIFI_API_KEY || "",
  lifiRouterAddress: validateAddress(process.env.LIFI_ROUTER_ADDRESS),
  vaultPrivateKey: validatePrivateKey(process.env.VAULT_PRIVATE_KEY),
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL,
  vaultChainId: Number.parseInt(process.env.CHAIN_ID || "8453", 10),
};

export const createAgentWalletClient = (
  chainId: number = agentConfig.vaultChainId,
) => {
  const privateKey = agentConfig.vaultPrivateKey;
  if (!privateKey) {
    throw new Error("VAULT_PRIVATE_KEY is not set");
  }
  const chainConfig = chains.get(chainId);
  if (!chainConfig) {
    throw new Error(`No chain config for chain ${chainId}`);
  }
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: chainConfig.viemChain,
    transport: http(chainConfig.rpcUrl),
  });
};
