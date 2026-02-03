import { type Chain, createPublicClient, http, type PublicClient } from "viem";
import { base, mainnet, optimism } from "viem/chains";
import { logger } from "./logger";

export type Environment = "development" | "production" | "testnet";

export const ENVIRONMENT: Environment =
  (process.env.ENVIRONMENT?.toLowerCase() as Environment) ||
  (process.env.NODE_ENV === "production" ? "production" : "development");

export interface ChainConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  publicClient: PublicClient;
}

export interface UniV4Contracts {
  poolManager: `0x${string}`;
  positionManager: `0x${string}`;
  quoter: `0x${string}`;
  weth: `0x${string}`;
  usdc: `0x${string}`;
}

// https://docs.uniswap.org/contracts/v4/deployments
export const UNIV4_CONTRACTS: Record<number, UniV4Contracts> = {
  8453: {
    poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    positionManager: "0x7C5f5A4bBd8fD63184577525326123B519429bDc",
    quoter: "0x0d5e0F971ED27FBfF6c2837bf31316121532048D",
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  10: {
    poolManager: "0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3",
    positionManager: "0x3C3Ea4B57a46241e54610e5f022E5c45859A1017",
    quoter: "0x1f3131A13296FB91C90870043742C3CDBFF1A8d7",
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  },
};

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

const initializeChains = () => {
  if (ENVIRONMENT === "development") {
    logger.info(
      "Running in development mode - chains disabled (use local setup if needed)",
    );
    return;
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

  logger.info(
    { environment: ENVIRONMENT, chains: Array.from(chains.keys()) },
    "Chains initialized",
  );
};

initializeChains();

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
