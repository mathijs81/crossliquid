const Q96 = 1n << 96n;

// Compute sqrtPriceX96 from a tick: sqrt(1.0001^tick) * 2^96
// Uses floating point intermediate — precision loss is negligible for display purposes
export function getSqrtPriceAtTick(tick: number): bigint {
  const sqrtPrice = Math.pow(1.0001, tick / 2);
  return BigInt(Math.round(sqrtPrice * Number(Q96)));
}

function getAmount0ForLiquidity(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint,
): bigint {
  if (sqrtPriceAX96 > sqrtPriceBX96)
    [sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96];

  return (
    ((liquidity << 96n) * (sqrtPriceBX96 - sqrtPriceAX96)) /
    sqrtPriceBX96 /
    sqrtPriceAX96
  );
}

function getAmount1ForLiquidity(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint,
): bigint {
  if (sqrtPriceAX96 > sqrtPriceBX96)
    [sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96];

  return (liquidity * (sqrtPriceBX96 - sqrtPriceAX96)) / Q96;
}

// Compute the current token amounts for a liquidity position given the current tick
// Mirrors LiquidityAmounts.getAmountsForLiquidity from v4-core
export function getAmountsForLiquidity(
  currentTick: number,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  const sqrtPriceX96 = getSqrtPriceAtTick(currentTick);
  let sqrtPriceAX96 = getSqrtPriceAtTick(tickLower);
  let sqrtPriceBX96 = getSqrtPriceAtTick(tickUpper);

  if (sqrtPriceAX96 > sqrtPriceBX96)
    [sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96];

  let amount0 = 0n;
  let amount1 = 0n;

  if (sqrtPriceX96 <= sqrtPriceAX96) {
    amount0 = getAmount0ForLiquidity(sqrtPriceAX96, sqrtPriceBX96, liquidity);
  } else if (sqrtPriceX96 < sqrtPriceBX96) {
    amount0 = getAmount0ForLiquidity(sqrtPriceX96, sqrtPriceBX96, liquidity);
    amount1 = getAmount1ForLiquidity(sqrtPriceAX96, sqrtPriceX96, liquidity);
  } else {
    amount1 = getAmount1ForLiquidity(sqrtPriceAX96, sqrtPriceBX96, liquidity);
  }

  return { amount0, amount1 };
}
