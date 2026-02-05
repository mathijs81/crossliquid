#!/usr/bin/env -S tsx --env-file=.env

import { parseArgs } from "node:util";
import { formatEther, formatUnits, isAddress, type Address } from "viem";
import { addLiquidity } from "./actions/addLiquidity";
import { swapTokens } from "./actions/swap";
import { syncVault } from "./actions/vaultSync";
import {
  agentConfig,
  chains,
  createAgentWalletClient,
  UNIV4_CONTRACTS,
} from "./config";
import { logger } from "./logger";
import {
  formatPosition,
  PositionManagerService,
} from "./services/positionManager";
import { SwappingService } from "./services/swapping";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

const COMMANDS = {
  "list-positions": "List all positions",
  "add-liquidity": "Add liquidity to a pool",
  "remove-liquidity": "Remove liquidity from a pool",
  swap: "Swap tokens through the Universal Router",
  "sync-vault":
    "Sync funds between the $CLQ vault and the pool manager on Base",
  help: "Show this help message",
} as const;

type CommandName = keyof typeof COMMANDS;

function showHelp() {
  console.log("CrossLiquid Agent CLI\n");
  console.log("Usage: pnpm cli <command> [options]\n");
  console.log("Commands:");
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    console.log(`  ${cmd.padEnd(20)} ${desc}`);
  }
  console.log("\nEnvironment Variables:");
  console.log(
    "  POSITION_MANAGER_ADDRESS  Address of PositionManager contract (required)",
  );
  console.log(
    "  POOL_MANAGER_ADDRESS      Address of PoolManager contract (required)",
  );
  console.log("  USDC_ADDRESS              Address of USDC token (required)");
  console.log(
    "  OPERATOR_PRIVATE_KEY      Private key for signing transactions (required for write ops)",
  );
  console.log(
    "  CHAIN_ID                  Chain ID (default: 31337 for local)",
  );
  console.log(
    "  UNISWAP_API_KEY           API key for Uniswap routing API (optional)",
  );
  console.log(
    "  UNIVERSAL_ROUTER_ADDRESS  Local Universal Router address (chain 31337)",
  );
  console.log(
    "  PERMIT2_ADDRESS           Local Permit2 address (chain 31337)",
  );
  console.log("\nExamples:");
  console.log("  # List all positions");
  console.log("  pnpm cli list-positions");
  console.log();
  console.log("  # Add liquidity (ETH/USDC pool)");
  console.log("  pnpm cli add-liquidity --eth 0.5 --usdc 1000");
  console.log();
  console.log("  # Remove liquidity");
  console.log("  pnpm cli remove-liquidity --position-id 0 --amount 100");
  console.log();
  console.log("  # Swap ETH for USDC");
  console.log("  pnpm cli swap --amount 0.1 --token-in eth --token-out usdc");
}

async function listPositions(service: PositionManagerService) {
  logger.info("Fetching all positions...");
  const { ids, positions, currentTicks, inRange } =
    await service.getAllPositions();

  if (positions.length === 0) {
    console.log("No positions found");
    return;
  }

  console.log(`\nFound ${positions.length} position(s):\n`);
  for (let i = 0; i < positions.length; i++) {
    console.log(`Position #${i}`);
    console.log(`ID: ${ids[i]}`);
    console.log(`Current Tick: ${currentTicks[i]}`);
    console.log(`In Range: ${inRange[i] ? "✓" : "✗"}`);
    console.log(formatPosition(positions[i]));
    console.log();
  }
}

async function removeLiquidity(
  service: PositionManagerService,
  options: {
    positionIndex: number;
    amount: string;
    poolManager: Address;
    usdcAddress: Address;
  },
) {
  const { positions } = await service.getAllPositions();

  if (options.positionIndex >= positions.length) {
    throw new Error(`Position index ${options.positionIndex} not found`);
  }

  const position = positions[options.positionIndex];
  const liquidityToRemove = BigInt(options.amount);

  if (liquidityToRemove > position.liquidity) {
    throw new Error(
      `Requested liquidity ${liquidityToRemove} exceeds position liquidity ${position.liquidity}`,
    );
  }

  logger.info(
    {
      positionIndex: options.positionIndex,
      liquidityToRemove: liquidityToRemove.toString(),
      totalLiquidity: position.liquidity.toString(),
    },
    "Preparing to remove liquidity",
  );

  const result = await service.removeLiquidity({
    poolManagerAddress: options.poolManager,
    poolKey: position.poolKey,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    liquidity: liquidityToRemove,
    amount0Min: 0n,
    amount1Min: 0n,
  });

  console.log("\n✓ Liquidity removed successfully!");
  console.log(`Transaction Hash: ${result.hash}`);
  console.log(`ETH Received: ${formatEther(result.amount0)}`);
  console.log(`USDC Received: ${formatUnits(result.amount1, 6)}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "help") {
    showHelp();
    process.exit(0);
  }

  const command = args[0] as CommandName;

  if (!(command in COMMANDS)) {
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
  }

  const positionManagerAddress = process.env.POSITION_MANAGER_ADDRESS as
    | Address
    | undefined;

  // TODO: handle this stuff somewhere else
  if (!positionManagerAddress) {
    console.error("POSITION_MANAGER_ADDRESS environment variable is required");
    process.exit(1);
  }

  const service = new PositionManagerService(
    agentConfig.vaultChainId,
    positionManagerAddress,
  );

  const chain = Number(process.env.CHAIN_ID) ?? agentConfig.vaultChainId;
  const poolManagerAddress = UNIV4_CONTRACTS[chain].poolManager;
  const usdcAddress = UNIV4_CONTRACTS[chain].usdc;

  try {
    switch (command) {
      case "list-positions": {
        await listPositions(service);
        break;
      }

      case "add-liquidity": {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            eth: { type: "string" },
            usdc: { type: "string" },
            "tick-lower": { type: "string" },
            "tick-upper": { type: "string" },
          },
        });

        if (!values.eth || !values.usdc) {
          console.error("--eth and --usdc are required");
          process.exit(1);
        }

        await addLiquidity(service, {
          eth: values.eth,
          usdc: values.usdc,
          poolManager: poolManagerAddress,
          stateView: UNIV4_CONTRACTS[chain].stateView,
          usdcAddress,
          tickLower: values["tick-lower"]
            ? Number(values["tick-lower"])
            : undefined,
          tickUpper: values["tick-upper"]
            ? Number(values["tick-upper"])
            : undefined,
        });
        break;
      }

      case "remove-liquidity": {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            "position-id": { type: "string" },
            amount: { type: "string" },
          },
        });

        if (!values["position-id"] || !values.amount) {
          console.error("--position-id and --amount are required");
          process.exit(1);
        }

        await removeLiquidity(service, {
          positionIndex: Number(values["position-id"]),
          amount: values.amount,
          poolManager: poolManagerAddress!,
          usdcAddress: usdcAddress!,
        });
        break;
      }

      case "sync-vault": {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            "dry-run": { type: "boolean", default: false },
          },
        });
        await syncVault(
          createAgentWalletClient(agentConfig.vaultChainId),
          values["dry-run"] as boolean,
        );
        break;
      }

      case "swap": {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            amount: { type: "string" },
            "token-in": { type: "string" },
            "token-out": { type: "string" },
            "exact-out": { type: "boolean", default: false },
            "slippage-bps": { type: "string" },
            "deadline-seconds": { type: "string" },
            recipient: { type: "string" },
            "quote-only": { type: "boolean", default: false },
          },
        });

        if (!values.amount) {
          console.error("--amount is required");
          process.exit(1);
        }

        const tradeType = values["exact-out"] ? "EXACT_OUTPUT" : "EXACT_INPUT";
        const slippageBps = values["slippage-bps"]
          ? Number(values["slippage-bps"])
          : 50;
        const deadlineSeconds = values["deadline-seconds"]
          ? Number(values["deadline-seconds"])
          : 1800;

        if (Number.isNaN(slippageBps) || slippageBps < 0) {
          throw new Error("Invalid --slippage-bps value");
        }
        if (Number.isNaN(deadlineSeconds) || deadlineSeconds <= 0) {
          throw new Error("Invalid --deadline-seconds value");
        }

        const chainContracts = UNIV4_CONTRACTS[chain];
        if (!chainContracts) {
          throw new Error(`Unsupported chain ${chain}`);
        }

        const tokenIn = resolveTokenAddress(
          values["token-in"],
          chainContracts,
          ZERO_ADDRESS,
        );
        const tokenOut = resolveTokenAddress(
          values["token-out"],
          chainContracts,
          chainContracts.usdc,
        );

        const publicClient = chains.get(chain)?.publicClient;
        if (!publicClient) {
          throw new Error(`No public client for chain ${chain}`);
        }

        const walletClient = createAgentWalletClient(chain);
        const swapService = new SwappingService(
          publicClient,
          walletClient,
          chain,
          chainContracts,
        );

        const recipient = values.recipient
          ? resolveRecipientAddress(values.recipient)
          : walletClient.account?.address;

        if (!recipient) {
          throw new Error("Recipient address is required");
        }

        await swapTokens(swapService, publicClient, {
          chainId: chain,
          tokenIn,
          tokenOut,
          amount: values.amount,
          tradeType,
          slippageBps,
          recipient,
          deadlineSeconds,
          quoteOnly: values["quote-only"] as boolean,
        });
        break;
      }

      case "help": {
        showHelp();
        break;
      }
    }
  } catch (error) {
    logger.error({ error }, "Command failed");
    console.error(
      "\n✗ Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

function resolveTokenAddress(
  value: string | undefined,
  contracts: { weth: Address; usdc: Address },
  fallback: Address,
): Address {
  if (!value) {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (normalized === "eth" || normalized === "native") {
    return ZERO_ADDRESS;
  }
  if (normalized === "weth") {
    return contracts.weth;
  }
  if (normalized === "usdc") {
    return contracts.usdc;
  }
  if (normalized === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
    return ZERO_ADDRESS;
  }
  if (isAddress(value)) {
    return value as Address;
  }

  throw new Error(`Invalid address: ${value}`);
}

function resolveRecipientAddress(value: string): Address {
  if (isAddress(value)) {
    return value as Address;
  }

  throw new Error(`Invalid recipient address: ${value}`);
}

main();
