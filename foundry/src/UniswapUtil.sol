//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { LiquidityAmounts } from "../lib/v4-core/test/utils/LiquidityAmounts.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";

library UniswapUtil {
    function getLiquidityForAmounts(
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0,
        uint256 amount1
    ) public pure returns (uint128 liquidity) {
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        return LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, amount0, amount1);
    }

    function getAmountsForLiquidity(uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, uint128 liquidity)
        public
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        return LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, liquidity);
    }

    function getFullRangeTicks(int24 tickSpacing) public pure returns (int24 tickLower, int24 tickUpper) {
        tickLower = TickMath.minUsableTick(tickSpacing);
        tickUpper = TickMath.maxUsableTick(tickSpacing);
    }
}
