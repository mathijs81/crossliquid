import { chains } from "../config";

export interface RebalanceAction {
  chainId: number;
  type: "deposit" | "withdraw";
  token: string;
  amount: bigint;
}

export interface ExecutionResult {
  success: boolean;
  action: RebalanceAction;
  txHash?: string;
  error?: string;
}

const lifiCompose = async (
  _actions: RebalanceAction[],
): Promise<{ to: `0x${string}`; data: `0x${string}`; value: bigint }> => {
  return {
    to: "0x0000000000000000000000000000000000000000",
    data: "0x" as `0x${string}`,
    value: 0n,
  };
};

export const executeRebalance = async (
  actions: RebalanceAction[],
): Promise<ExecutionResult[]> => {
  const results: ExecutionResult[] = [];

  for (const action of actions) {
    try {
      const config = chains.get(action.chainId);
      if (!config) {
        throw new Error(`No config for chain ${action.chainId}`);
      }

      const _composed = await lifiCompose([action]);

      results.push({
        success: true,
        action,
        txHash: "0xplaceholder" as `0x${string}`,
      });
    } catch (error) {
      results.push({
        success: false,
        action,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
};

export const inFlightActions: Map<string, RebalanceAction> = new Map();

export const generateActionId = (action: RebalanceAction): string => {
  return `${action.chainId}-${action.type}-${action.token}-${action.amount}`;
};
