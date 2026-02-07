import type { Address } from "viem/accounts";
import type { PositionManagerService } from "../services/positionManager.js";
import { formatEther, formatUnits } from "viem";
import { logger } from "../logger.js";

export async function removeLiquidity(
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
    amount0Min: 0n, // FIXME: add slippage protection, 95% of desired?
    amount1Min: 0n,
  });

  console.log("\n✓ Liquidity removed successfully!");
  console.log(`Transaction Hash: ${result.hash}`);
  console.log(`ETH Received: ${formatEther(result.amount0)}`);
  console.log(`USDC Received: ${formatUnits(result.amount1, 6)}`);
}
