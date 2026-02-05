import { chains } from "../config.js";
import { logger } from "../logger.js";

const VAULT_ABI = [
  {
    inputs: [],
    name: "totalAssets",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "assets", type: "uint256" }],
    name: "previewRedeem",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface VaultState {
  chainId: number;
  totalAssets: bigint;
  totalSupply: bigint;
  availableForWithdrawal: bigint;
  lastUpdated: string;
}

export const getVaultState = async (
  chainId: number,
  vaultAddress: `0x${string}`,
): Promise<VaultState | null> => {
  const config = chains.get(chainId);
  if (!config) {
    return null;
  }

  try {
    const client = config.publicClient;
    const [totalAssets, totalSupply] = await Promise.all([
      client.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "totalAssets",
      }),
      client.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "totalSupply",
      }),
    ]);

    const availableForWithdrawal = (totalAssets * 5n) / 100n;

    return {
      chainId,
      totalAssets,
      totalSupply,
      availableForWithdrawal,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(
      {
        chainId,
        vaultAddress,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to fetch vault state",
    );
    return null;
  }
};

export const getTotalVaultValue = async (
  vaultStates: Map<number, VaultState>,
): Promise<bigint> => {
  let total = 0n;
  for (const state of vaultStates.values()) {
    if (state) {
      total += state.totalAssets;
    }
  }
  return total;
};
