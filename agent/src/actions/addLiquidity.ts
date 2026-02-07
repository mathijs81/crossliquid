import { formatEther, formatUnits, parseEther, parseUnits } from "viem";
import type { Address } from "viem/accounts";
import { logger } from "../logger.js";
import { getPoolCurrentTick } from "../services/pool.js";
import type { PositionManagerService } from "../services/positionManager.js";
import { calculateTickRange } from "../services/positionManager.js";
import {
  createEthUsdcPoolKey,
  createPoolId,
  FeeTier,
} from "../utils/poolIds.js";

export async function addLiquidity(
  service: PositionManagerService,
  options: {
    chainId: number;
    eth: string;
    usdc: string;
    poolManager: Address;
    stateView: Address;
    usdcAddress: Address;
    hookAddress?: Address;
    tickLower?: number;
    tickUpper?: number;
  },
) {
  const amount0Desired = parseEther(options.eth);
  const amount1Desired = parseUnits(options.usdc, 6);

  logger.info(
    {
      eth: options.eth,
      usdc: options.usdc,
      amount0Desired: amount0Desired.toString(),
      amount1Desired: amount1Desired.toString(),
      hookAddress: options.hookAddress,
    },
    "Preparing to add liquidity",
  );

  const poolKey = createEthUsdcPoolKey(
    options.usdcAddress,
    FeeTier.LOW,
    options.hookAddress,
  );
  const poolId = createPoolId(poolKey);
  // Get current tick from pool
  let tickLower: number;
  let tickUpper: number;

  if (options.tickLower !== undefined && options.tickUpper !== undefined) {
    tickLower = options.tickLower;
    tickUpper = options.tickUpper;
  } else {
    const currentTick = await getPoolCurrentTick(
      options.chainId,
      options.stateView,
      poolId,
    );

    const otherTick = await getPoolCurrentTick(
      options.chainId,
      options.stateView,
      createPoolId(createEthUsdcPoolKey(
        options.usdcAddress,
        FeeTier.LOW
      )),
    )
    if (!otherTick) {
      throw new Error("Failed to fetch current tick from pool");
    }
    if (!currentTick) {
      throw new Error("Failed to fetch current tick from pool");
    }

    if (Math.abs(currentTick - otherTick) > 100) {
      throw new Error(`Current tick (${currentTick}) is too far from other tick (${otherTick}).`);
    }
    const range = calculateTickRange(currentTick, 10);
    tickLower = range.tickLower;
    tickUpper = range.tickUpper;
    logger.info({ currentTick, tickLower, tickUpper }, "Calculated tick range");
  }

  const result = await service.addLiquidity({
    poolManagerAddress: options.poolManager,
    poolKey,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: 0n,
    amount1Min: 0n,
  });

  console.log("\n✓ Liquidity added successfully!");
  console.log(`Transaction Hash: ${result.hash}`);
  console.log(`Liquidity Added: ${result.liquidityAdded}`);
  console.log(`ETH Used: ${formatEther(result.amount0)}`);
  console.log(`USDC Used: ${formatUnits(result.amount1, 6)}`);
}
