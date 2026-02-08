import { type Account, type Address, formatEther, formatUnits } from "viem";
import { positionManagerAbi } from "../abi/PositionManager.js";
import { chains, createAgentWalletClient, getOurAddressesForChain } from "../config.js";
import { UNIV4_CONTRACTS, ZERO_ADDRESS } from "../contracts/contract-addresses.js";
import { logger } from "../logger.js";
import {
  createNewTask,
  type ActionDefinition,
  type NotStartedTask,
  type TaskInfo,
  type TaskInfoUnknown,
} from "../services/actionRunner.js";
import { SwappingService } from "../services/swapping.js";
import { getManagerBalances } from "./managerBalances.js";
import { pollTxReceipt, type TxTaskData } from "./txLifecycle.js";

const MIN_TOTAL_VALUE_USD = 20;
const IMBALANCE_RATIO = 2;

interface SwapForBalanceTaskData extends TxTaskData {
  direction: "eth-to-usdc" | "usdc-to-eth";
  amountIn: bigint;
  tokenIn: Address;
  tokenOut: Address;
}

export class SwapForBalanceAction implements ActionDefinition<SwapForBalanceTaskData> {
  name: string;

  constructor(private chainId: number) {
    this.name = `swap-for-balance-${chainId}`;
  }

  lockResources() {
    return [`chain:${this.chainId}:liquidity`];
  }

  async shouldStart(_existingTasks: TaskInfoUnknown[]): Promise<boolean> {
    const bal = await getManagerBalances(this.chainId);
    if (bal.totalValueUsdc < MIN_TOTAL_VALUE_USD) return false;
    return (
      bal.ethValueUsdc > IMBALANCE_RATIO * bal.usdcValueUsdc || bal.usdcValueUsdc > IMBALANCE_RATIO * bal.ethValueUsdc
    );
  }

  async start(
    existingTasks: TaskInfoUnknown[],
    force: boolean,
  ): Promise<NotStartedTask | TaskInfo<SwapForBalanceTaskData>> {
    if (!force && !(await this.shouldStart(existingTasks))) {
      return { message: "Balances are within range" };
    }

    const bal = await getManagerBalances(this.chainId);
    const usdcAddress = UNIV4_CONTRACTS[this.chainId].usdc;
    const targetValueEach = bal.totalValueUsdc / 2;

    let direction: "eth-to-usdc" | "usdc-to-eth";
    let amountIn: bigint;
    let tokenIn: Address;
    let tokenOut: Address;

    if (bal.ethValueUsdc > bal.usdcValueUsdc) {
      direction = "eth-to-usdc";
      const excessUsd = bal.ethValueUsdc - targetValueEach;
      const ethToSwap = excessUsd / bal.ethPriceUsdc;
      amountIn = BigInt(Math.floor(ethToSwap * 1e18));
      tokenIn = ZERO_ADDRESS;
      tokenOut = usdcAddress;
    } else {
      direction = "usdc-to-eth";
      const excessUsd = bal.usdcValueUsdc - targetValueEach;
      amountIn = BigInt(Math.floor(excessUsd * 1e6));
      tokenIn = usdcAddress;
      tokenOut = ZERO_ADDRESS;
    }

    logger.info(
      {
        chainId: this.chainId,
        direction,
        amountIn: amountIn.toString(),
        ethValue: bal.ethValueUsdc.toFixed(2),
        usdcValue: bal.usdcValueUsdc.toFixed(2),
      },
      "Starting swap for balance",
    );

    return createNewTask(this.name, this.lockResources(), {
      direction,
      amountIn,
      tokenIn,
      tokenOut,
      hash: null,
    });
  }

  async update(taskInfo: TaskInfo<SwapForBalanceTaskData>): Promise<TaskInfo<SwapForBalanceTaskData>> {
    switch (taskInfo.status) {
      case "pre-start": {
        const d = taskInfo.taskData;
        const publicClient = chains.get(this.chainId)?.publicClient;
        if (!publicClient) throw new Error(`No public client for chain ${this.chainId}`);

        const walletClient = createAgentWalletClient(this.chainId);
        const ourAddresses = getOurAddressesForChain(this.chainId);
        const contracts = UNIV4_CONTRACTS[this.chainId];
        const managerAddress = ourAddresses.manager;

        const swapService = new SwappingService(publicClient, walletClient, this.chainId, contracts);

        const quote = await swapService.quoteSwap({
          chainId: this.chainId,
          tokenIn: d.tokenIn,
          tokenOut: d.tokenOut,
          amountIn: d.amountIn,
          recipient: managerAddress,
          forManager: true,
          fromAddress: managerAddress,
        });

        const plan = swapService.buildExecutionPlan(quote, {
          chainId: this.chainId,
          tokenIn: d.tokenIn,
          tokenOut: d.tokenOut,
          amountIn: d.amountIn,
          recipient: managerAddress,
          forManager: true,
          fromAddress: managerAddress,
        });

        let hash: `0x${string}`;
        if (d.direction === "usdc-to-eth") {
          // ERC20 swap: use bridgeTokenToChain (handles approval)
          hash = await walletClient.writeContract({
            account: walletClient.account as Account,
            chain: walletClient.chain,
            address: managerAddress,
            abi: positionManagerAbi,
            functionName: "bridgeTokenToChain",
            args: [plan.to, d.tokenIn, 0n, d.amountIn, plan.data],
          });
        } else {
          // ETH swap: use bridgeToChain with ETH value
          hash = await walletClient.writeContract({
            account: walletClient.account as Account,
            chain: walletClient.chain,
            address: managerAddress,
            abi: positionManagerAbi,
            functionName: "bridgeToChain",
            args: [plan.to, 0n, plan.value, plan.data],
          });
        }

        logger.info({ hash, direction: d.direction, amountIn: d.amountIn.toString() }, "Swap tx submitted");
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
        const d2 = taskInfo.taskData;
        return pollTxReceipt(publicClient, taskInfo, () => {
          if (d2.direction === "eth-to-usdc") {
            return `Swapped ${formatEther(d2.amountIn)} ETH for USDC`;
          }
          return `Swapped ${formatUnits(d2.amountIn, 6)} USDC for ETH`;
        });
      }
      default:
        throw new Error(`Unexpected status: ${taskInfo.status}`);
    }
  }

  async stop(): Promise<void> {}
}
