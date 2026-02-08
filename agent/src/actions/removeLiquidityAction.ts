import { type Account, decodeEventLog, formatEther, formatUnits } from "viem";
import { positionManagerAbi } from "../abi/PositionManager.js";
import { chains, createAgentWalletClient, getOurAddressesForChain } from "../config.js";
import { UNIV4_CONTRACTS } from "../contracts/contract-addresses.js";
import { logger } from "../logger.js";
import {
  createNewTask,
  type ActionDefinition,
  type NotStartedTask,
  type TaskInfo,
  type TaskInfoUnknown,
} from "../services/actionRunner.js";
import { PositionManagerService } from "../services/positionManager.js";
import type { PoolKey } from "../utils/poolIds.js";
import { pollTxReceipt, type TxTaskData } from "./txLifecycle.js";

interface RemoveLiquidityTaskData extends TxTaskData {
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  currentTick: number;
}

function isOutOfSafeRange(currentTick: number, tickLower: number, tickUpper: number): boolean {
  const range = tickUpper - tickLower;
  if (range <= 0) return true;
  const positionInRange = (currentTick - tickLower) / range;
  return positionInRange < 0.15 || positionInRange > 0.85;
}

export class RemoveLiquidityAction implements ActionDefinition<RemoveLiquidityTaskData> {
  name: string;

  constructor(private chainId: number) {
    this.name = `remove-liquidity-${chainId}`;
  }

  lockResources() {
    return [`chain:${this.chainId}:liquidity`];
  }

  async shouldStart(_existingTasks: TaskInfoUnknown[]): Promise<boolean> {
    const { positions, currentTicks } = await this.createService().getAllPositions();
    return positions.some(
      (pos, i) => pos.liquidity > 0n && isOutOfSafeRange(currentTicks[i], pos.tickLower, pos.tickUpper),
    );
  }

  async start(
    existingTasks: TaskInfoUnknown[],
    force: boolean,
  ): Promise<NotStartedTask | TaskInfo<RemoveLiquidityTaskData>> {
    if (!force && !(await this.shouldStart(existingTasks))) {
      return { message: "No out-of-range positions" };
    }

    const { positions, currentTicks } = await this.createService().getAllPositions();
    const index = positions.findIndex(
      (pos, i) => pos.liquidity > 0n && isOutOfSafeRange(currentTicks[i], pos.tickLower, pos.tickUpper),
    );
    if (index === -1) {
      return { message: "No out-of-range positions found on re-check" };
    }

    const pos = positions[index];
    logger.info(
      {
        chainId: this.chainId,
        tickLower: pos.tickLower,
        tickUpper: pos.tickUpper,
        currentTick: currentTicks[index],
        liquidity: pos.liquidity.toString(),
      },
      "Found out-of-range position to remove",
    );

    return createNewTask(this.name, this.lockResources(), {
      poolKey: pos.poolKey,
      tickLower: pos.tickLower,
      tickUpper: pos.tickUpper,
      liquidity: pos.liquidity,
      currentTick: currentTicks[index],
      hash: null,
    });
  }

  async update(taskInfo: TaskInfo<RemoveLiquidityTaskData>): Promise<TaskInfo<RemoveLiquidityTaskData>> {
    switch (taskInfo.status) {
      case "pre-start": {
        const walletClient = createAgentWalletClient(this.chainId);
        const managerAddress = getOurAddressesForChain(this.chainId).manager;
        const poolManagerAddress = UNIV4_CONTRACTS[this.chainId].poolManager;
        const d = taskInfo.taskData;

        const hash = await walletClient.writeContract({
          account: walletClient.account as Account,
          chain: walletClient.chain,
          address: managerAddress,
          abi: positionManagerAbi,
          functionName: "withdrawFromUniswap",
          args: [poolManagerAddress, d.poolKey, d.tickLower, d.tickUpper, d.liquidity, 0n, 0n],
        });

        logger.info({ hash, chainId: this.chainId }, "Remove liquidity tx submitted");
        return {
          ...taskInfo,
          taskData: { ...d, hash },
          status: "running",
          statusMessage: `Transaction ${hash} sent`,
        };
      }
      case "running": {
        const publicClient = chains.get(this.chainId)?.publicClient;
        if (!publicClient) throw new Error(`No public client for chain ${this.chainId}`);
        return pollTxReceipt(publicClient, taskInfo, (receipt) => {
          for (const log of receipt.logs) {
            try {
              const event = decodeEventLog({ abi: positionManagerAbi, data: log.data, topics: log.topics });
              if (event.eventName === "WithdrawnFromUniswap") {
                const { amount0, amount1 } = event.args;
                return `Removed ${formatEther(amount0)} ETH and ${formatUnits(amount1, 6)} USDC from pool`;
              }
            } catch {}
          }
          return "Liquidity removed";
        });
      }
      default:
        throw new Error(`Unexpected status: ${taskInfo.status}`);
    }
  }

  async stop(): Promise<void> {}

  private createService() {
    return new PositionManagerService(this.chainId, getOurAddressesForChain(this.chainId).manager);
  }
}
