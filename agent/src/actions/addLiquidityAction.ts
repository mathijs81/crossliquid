import { type Account, decodeEventLog, formatEther, formatUnits } from "viem";
import { positionManagerAbi } from "../abi/PositionManager.js";
import { chains, createAgentWalletClient, DEFAULT_POOL_KEYS, getOurAddressesForChain } from "../config.js";
import { UNIV4_CONTRACTS } from "../contracts/contract-addresses.js";
import { logger } from "../logger.js";
import {
  createNewTask,
  type ActionDefinition,
  type NotStartedTask,
  type TaskInfo,
  type TaskInfoUnknown,
} from "../services/actionRunner.js";
import { getPoolCurrentTick } from "../services/pool.js";
import { calculateTickRange } from "../services/positionManager.js";
import { createEthUsdcPoolKey, createPoolId, FeeTier, type PoolKey } from "../utils/poolIds.js";
import { getManagerBalances } from "./managerBalances.js";
import { pollTxReceipt, type TxTaskData } from "./txLifecycle.js";

const MIN_VALUE_PER_SIDE_USD = 10;
const IMBALANCE_RATIO = 2;

interface AddLiquidityTaskData extends TxTaskData {
  ethAmount: bigint;
  usdcAmount: bigint;
  tickLower: number;
  tickUpper: number;
  poolKey: PoolKey;
}

export class AddLiquidityAction implements ActionDefinition<AddLiquidityTaskData> {
  name: string;

  constructor(private chainId: number) {
    this.name = `add-liquidity-${chainId}`;
  }

  lockResources() {
    return [`chain:${this.chainId}:liquidity`];
  }

  async shouldStart(_existingTasks: TaskInfoUnknown[]): Promise<boolean> {
    const bal = await getManagerBalances(this.chainId);

    // Both sides need > $10
    if (bal.ethValueUsdc < MIN_VALUE_PER_SIDE_USD || bal.usdcValueUsdc < MIN_VALUE_PER_SIDE_USD) {
      return false;
    }

    // Don't add if significantly imbalanced — let swap fix it first
    if (
      bal.ethValueUsdc > IMBALANCE_RATIO * bal.usdcValueUsdc ||
      bal.usdcValueUsdc > IMBALANCE_RATIO * bal.ethValueUsdc
    ) {
      return false;
    }

    return true;
  }

  async start(
    existingTasks: TaskInfoUnknown[],
    force: boolean,
  ): Promise<NotStartedTask | TaskInfo<AddLiquidityTaskData>> {
    if (!force && !(await this.shouldStart(existingTasks))) {
      return { message: "Not enough balanced funds to add liquidity" };
    }

    const bal = await getManagerBalances(this.chainId);
    const poolKey = DEFAULT_POOL_KEYS[this.chainId];
    if (!poolKey) throw new Error(`No pool key for chain ${this.chainId}`);

    const contracts = UNIV4_CONTRACTS[this.chainId];

    const poolId = createPoolId(poolKey);
    const currentTick = await getPoolCurrentTick(this.chainId, contracts.stateView, poolId);
    if (currentTick === null) throw new Error(`Failed to get current tick for chain ${this.chainId}`);

    const otherTick = await getPoolCurrentTick(
      this.chainId,
      contracts.stateView,
      createPoolId(createEthUsdcPoolKey(contracts.usdc, FeeTier.LOW)),
    );
    if (otherTick === null) throw new Error(`Failed to get current tick for chain ${this.chainId}`);
    if (Math.abs(currentTick - otherTick) > 200) {
      logger.warn(`Current tick is too far from other tick: ${currentTick} - ${otherTick}`);
      return { message: "Current tick is too far from other tick" };
    }

    // TODO: could look for existing position at a similar range and add to it
    // instead of always creating a new one
    const { tickLower, tickUpper } = calculateTickRange(currentTick, poolKey.tickSpacing);

    // Use all available manager balance
    const ethAmount = bal.ethBalance;
    const usdcAmount = bal.usdcBalance;

    logger.info(
      {
        chainId: this.chainId,
        ethAmount: ethAmount.toString(),
        usdcAmount: usdcAmount.toString(),
        tickLower,
        tickUpper,
        currentTick,
      },
      "Starting add liquidity",
    );

    return createNewTask(this.name, this.lockResources(), {
      ethAmount,
      usdcAmount,
      tickLower,
      tickUpper,
      poolKey,
      hash: null,
    });
  }

  async update(taskInfo: TaskInfo<AddLiquidityTaskData>): Promise<TaskInfo<AddLiquidityTaskData>> {
    switch (taskInfo.status) {
      case "pre-start": {
        const d = taskInfo.taskData;
        const walletClient = createAgentWalletClient(this.chainId);
        const managerAddress = getOurAddressesForChain(this.chainId).manager;
        const poolManagerAddress = UNIV4_CONTRACTS[this.chainId].poolManager;

        const hash = await walletClient.writeContract({
          account: walletClient.account as Account,
          chain: walletClient.chain,
          address: managerAddress,
          abi: positionManagerAbi,
          functionName: "depositToUniswap",
          args: [
            poolManagerAddress,
            d.poolKey,
            d.tickLower,
            d.tickUpper,
            d.ethAmount,
            d.usdcAmount,
            0n, // TODO: slippage protection
            0n,
          ],
        });

        logger.info(
          {
            hash,
            chainId: this.chainId,
            ethAmount: d.ethAmount.toString(),
            usdcAmount: d.usdcAmount.toString(),
          },
          "Add liquidity tx submitted",
        );
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
              if (event.eventName === "DepositedToUniswap") {
                const { amount0, amount1, tickLower, tickUpper } = event.args;
                return `Deployed ${formatEther(amount0)} ETH and ${formatUnits(amount1, 6)} USDC to pool [${tickLower}, ${tickUpper}]`;
              }
            } catch {}
          }
          return "Liquidity added";
        });
      }
      default:
        throw new Error(`Unexpected status: ${taskInfo.status}`);
    }
  }

  async stop(): Promise<void> {}
}
