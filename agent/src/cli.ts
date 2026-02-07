#!/usr/bin/env -S tsx --env-file=.env

import { parseArgs } from "node:util";
import { erc20Abi, isAddress, type Address } from "viem";
import { addLiquidity } from "./actions/addLiquidity.js";
import { removeLiquidity } from "./actions/removeLiquidity.js";
import { swapTokens } from "./actions/swap.js";
import { syncVault } from "./actions/vaultSync.js";
import {
  agentConfig,
  chains,
  createAgentWalletClient,
  getOurAddressesForChain,
  UNIV4_CONTRACTS,
} from "./config.js";
import { logger } from "./logger.js";
import {
  formatPosition,
  PositionManagerService,
} from "./services/positionManager.js";
import { SwappingService } from "./services/swapping.js";
import { getContractEvents } from "viem/actions";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

const COMMANDS = {
  "list-positions": "List all positions",
  "add-liquidity": "Add liquidity to a pool",
  "remove-liquidity": "Remove liquidity from a pool",
  swap: "Swap tokens through the Universal Router",
  "sync-vault":
    "Sync funds between the $CLQ vault and the pool manager on Base",
  "dump-usdc-transfers": "Dump all USDC transfers from the manager",
  "price-to-sqrt": "Convert ETH price to sqrtPriceX96 format",
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
  console.log();
  console.log("  # Convert ETH price to sqrtPriceX96");
  console.log("  pnpm cli price-to-sqrt --price 2042");
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

  const chain = Number(process.env.CHAIN_ID) ?? agentConfig.vaultChainId;
  const ourAddresses = getOurAddressesForChain(chain);
  const service = new PositionManagerService(chain, ourAddresses.manager);

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
          chainId: chain,
          eth: values.eth,
          usdc: values.usdc,
          poolManager: poolManagerAddress,
          stateView: UNIV4_CONTRACTS[chain].stateView,
          usdcAddress,
          hookAddress: ourAddresses.hook,
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

      case "dump-usdc-transfers": {
        const publicClient = chains.get(chain)?.publicClient;
        if (!publicClient) {
          throw new Error(`No public client for chain ${chain}`);
        }
        const events = await getContractEvents(publicClient, {
          address: usdcAddress,
          abi: erc20Abi,
          eventName: "Transfer",
          fromBlock: "earliest",
          toBlock: "latest",
        });
        logger.info(events);
        break;
      }

      case "swap": {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            amount: { type: "string" },
            "token-in": { type: "string" },
            "token-out": { type: "string" },
            "slippage-bps": { type: "string" },
            "deadline-seconds": { type: "string" },
            recipient: { type: "string" },
            "quote-only": { type: "boolean", default: false },
            "for-manager": { type: "boolean", default: false },
            "dry-run-production": { type: "boolean", default: false },
          },
        });

        if (!values.amount) {
          console.error("--amount is required");
          process.exit(1);
        }

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

        const forManager = values["for-manager"] as boolean;

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
          : forManager
            ? ourAddresses.manager
            : walletClient.account?.address;

        if (!recipient) {
          throw new Error("Recipient address is required");
        }

        const positionManagerAddress = ourAddresses.manager;
        const dryRunProduction = values["dry-run-production"] as boolean;

        // dry-run-production implies quote-only
        const quoteOnly = (values["quote-only"] as boolean) || dryRunProduction;

        if (dryRunProduction) {
          console.log(
            "\n🧪 Dry-run production mode: simulating production chain behavior\n",
          );
        }

        await swapTokens(swapService, publicClient, walletClient, {
          chainId: chain,
          tokenIn,
          tokenOut,
          amountIn: values.amount,
          slippageBps,
          recipient,
          deadlineSeconds,
          quoteOnly,
          forManager,
          positionManagerAddress,
          useProductionRouting: dryRunProduction,
        });
        break;
      }

      case "price-to-sqrt": {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            price: { type: "string" },
          },
        });

        if (!values.price) {
          console.error("--price is required (e.g., --price 2042)");
          process.exit(1);
        }

        const price = Number(values.price);
        if (Number.isNaN(price) || price <= 0) {
          console.error("Price must be a positive number");
          process.exit(1);
        }

        const sqrtPriceX96 = ethPriceToSqrtPriceX96(price);
        console.log(`ETH Price: ${price}`);
        console.log(`sqrtPriceX96: ${sqrtPriceX96}`);
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

/**
 * Convert an ETH price (e.g., 2042 USDC per ETH) to Uniswap v4's sqrtPriceX96 format.
 * Formula: sqrtPriceX96 = sqrt(price) * 2^96
 *
 * @param ethPrice - Price of ETH in USDC (e.g., 2042)
 * @returns Formatted sqrtPriceX96 value with underscores every 3 digits
 */
export function ethPriceToSqrtPriceX96(ethPrice: number): string {
  const sqrtPrice = Math.sqrt(ethPrice);
  const sqrtPriceX96 = sqrtPrice * 2 ** 96;
  const sqrtPriceX96BigInt = BigInt(Math.floor(sqrtPriceX96));

  const numStr = sqrtPriceX96BigInt.toString();
  const formatted = numStr.replace(/\B(?=(\d{3})+(?!\d))/g, "_");

  return formatted;
}

main();
