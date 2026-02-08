import type { PublicClient, TransactionReceipt } from "viem";
import type { TaskInfo } from "../services/actionRunner.js";

export interface TxTaskData {
  hash: `0x${string}` | null;
}

const DEFAULT_TX_TIMEOUT_MS = 3 * 60 * 1000;

export async function pollTxReceipt<T extends TxTaskData>(
  publicClient: PublicClient,
  taskInfo: TaskInfo<T>,
  successMessageGenerator: (receipt: TransactionReceipt) => string = () =>
    "Transaction confirmed",
  timeoutMs = DEFAULT_TX_TIMEOUT_MS,
): Promise<TaskInfo<T>> {
  if (!taskInfo.taskData.hash) {
    return { ...taskInfo, status: "error", statusMessage: "No tx hash" };
  }
  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: taskInfo.taskData.hash,
    });
    if (receipt.status === "success") {
      return {
        ...taskInfo,
        status: "completed",
        statusMessage: successMessageGenerator(receipt),
      };
    }
    return {
      ...taskInfo,
      status: "error",
      statusMessage: `Transaction ${taskInfo.taskData.hash} reverted`,
    };
  } catch {
    // Receipt not available yet — tx still pending
    if (Date.now() - taskInfo.startedAt > timeoutMs) {
      return {
        ...taskInfo,
        status: "error",
        statusMessage: "Transaction timed out",
      };
    }
    return taskInfo;
  }
}
