import * as viemChains from "viem/chains";

// Environments:
// - local: everything on foundry/anvil
// - prod: vault on base, various other chains for liquidity on uniswap

export enum Environment {
  LOCAL = "local",
  PROD = "prod",
}
export const environment =
  process.env.NODE_ENV === "production" ? Environment.PROD : Environment.LOCAL;

/**
 * Foundry local chain configuration
 */
export const foundry = {
  id: 31337,
  name: "Foundry",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
    public: { http: ["http://127.0.0.1:8545"] },
  },
  blockExplorers: {
    default: { name: "Local Explorer", url: "http://localhost:5173/explorer" },
  },
} as const satisfies viemChains.Chain;

/**
 * All supported chains for the application
 */
export const chains = [
  environment === Environment.LOCAL ? foundry : viemChains.base,
  ...(environment === Environment.LOCAL
    ? []
    : [
        viemChains.unichain,
        // viemChains.arbitrum,
        viemChains.optimism,
        // viemChains.polygon,
        // viemChains.ink,
      ]),
] as readonly [viemChains.Chain, ...viemChains.Chain[]];

import unichainIcon from "$lib/assets/unichain.svg";
import baseIcon from "$lib/assets/base.svg";
import optimismIcon from "$lib/assets/optimism.svg";
import ethereumIcon from "$lib/assets/ethereum.svg";

export const getIcon = (chainId: number) => {
  switch (chainId) {
    case 130:
      return unichainIcon;
    case 8453:
      return baseIcon;
    case 10:
      return optimismIcon;
    default:
      return ethereumIcon;
  }
};

export const vaultChain = chains[0];
export const vaultChainId = vaultChain.id;
