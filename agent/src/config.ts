import { Chain, createWalletClient, http, type PublicClient } from "viem";
import { initializeChains } from "./utils/chain.js";
import { validateAddress, validatePrivateKey } from "./utils/validation.js";
import { type Address, privateKeyToAccount } from "viem/accounts";
import { readOurDeployment, readUniswapDeployments } from "./dev/dev-config.js";
import { logger } from "./logger.js";
import { ChainId } from "@lifi/sdk";

export type Environment = "development" | "production" | "testnet";

export const ENVIRONMENT: Environment =
  (process.env.ENVIRONMENT?.toLowerCase() as Environment) ||
  (process.env.NODE_ENV === "production" ? "production" : "development");

export interface ChainConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  publicClient: PublicClient;
  viemChain: Chain;
  lifiId: ChainId;
}

export interface UniV4Contracts {
  poolManager: `0x${string}`;
  positionManager: `0x${string}`;
  stateView: `0x${string}`;
  quoter: `0x${string}`;
  weth: `0x${string}`;
  usdc: `0x${string}`;
  universalRouter: `0x${string}`;
  v4Router?: `0x${string}`; // IUniswapV4Router04 for local chains
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

// https://docs.uniswap.org/contracts/v4/deployments
export const UNIV4_CONTRACTS: Record<number, UniV4Contracts> = {
  8453: {
    poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    positionManager: "0x7C5f5A4bBd8fD63184577525326123B519429bDc",
    stateView: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
    quoter: "0x0d5e0F971ED27FBfF6c2837bf31316121532048D",
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    universalRouter: "0x6ff5693b99212da76ad316178a184ab56d299b43",
  },
  10: {
    poolManager: "0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3",
    positionManager: "0x3C3Ea4B57a46241e54610e5f022E5c45859A1017",
    stateView: "0xc18a3169788f4f75a170290584eca6395c75ecdb",
    quoter: "0x1f3131A13296FB91C90870043742C3CDBFF1A8d7",
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    universalRouter: "0x851116d9223fabed8e56c0e6b8ad0c31d98b3507",
  },
  1: {
    poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    positionManager: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
    stateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
    quoter: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
    weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    universalRouter: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
  },
  130: {
    poolManager: "0x1f98400000000000000000000000000000000004",
    positionManager: "0x4529a01c7a0410167c5740c487a8de60232617bf",
    quoter: "0x333e3c607b141b18ff6de9f258db6e77fe7491e0",
    stateView: "0x86e8631a016f9068c3f085faf484ee3f5fdee8f2",
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    universalRouter: "0xef740bf23acae26f6492b10de645d6b98dc8eaf3",
  },
  31337: {
    poolManager: "0x0000000000000000000000000000000000000000",
    positionManager: "0x0000000000000000000000000000000000000000",
    stateView: "0x0000000000000000000000000000000000000000",
    quoter: "0x0000000000000000000000000000000000000000",
    weth: "0x0000000000000000000000000000000000000000",
    usdc: "0x0000000000000000000000000000000000000000",
    universalRouter: "0x0000000000000000000000000000000000000000",
    ...(() => {
      if (ENVIRONMENT === "development") {
        return readUniswapDeployments();
      } else return {};
    })(),
  },
};

export const ETHUSDC_POOLS: Record<number, string[]> = {
  8453: [],
  10: [],
  130: [],
};

export const DEFAULT_POOL_KEYS: Record<number, PoolKey> = Object.fromEntries(
  Object.keys(UNIV4_CONTRACTS).map((chainId) => {
    const id = Number(chainId);
    return [
      id,
      {
        currency0: "0x0000000000000000000000000000000000000000",
        currency1: UNIV4_CONTRACTS[id].usdc,
        fee: 500,
        tickSpacing: 10,
        hooks: "0x0000000000000000000000000000000000000000",
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
  const publicClient = chains.get(chainId)?.publicClient;
  if (!publicClient) {
    throw new Error(`No public client for chain ${chainId}`);
  }
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: publicClient.chain!,
    transport: http(),
  });
};

function getOurAddresses() {
  let addresses = {
    vault: "0x0000000000000000000000000000000000000000" as Address,
    manager: "0x0000000000000000000000000000000000000000" as Address,
  };

  if (ENVIRONMENT === "development") {
    addresses = readOurDeployment();
  } else if (ENVIRONMENT === "production") {
    logger.warn(
      "Warning: production addresses of vault/manager not supported yet",
    );
    addresses.manager = "0x0e2500ffa1dfe19c21f7f81272b0b4e0fc0b958a";
  }

  return addresses;
}

export const OUR_ADDRESSES = getOurAddresses();
