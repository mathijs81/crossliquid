// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {VolatilityFeeHook} from "../src/VolatilityFeeHook.sol";

contract VolatilityFeeHookVest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IPoolManager public manager;
    PoolModifyLiquidityTest public modifyLiquidityRouter;
    PoolSwapTest public swapRouter;
    MockERC20 public token0;
    MockERC20 public token1;

    VolatilityFeeHook public hook;
    PoolKey public poolKey;

    bytes constant ZERO_BYTES = bytes("");
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    address owner = address(this);
    address notOwner = address(0xBEEF);

    function setUp() public {
        manager = new PoolManager(address(this));
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);
        swapRouter = new PoolSwapTest(manager);

        // Permission bits: AFTER_INITIALIZE | BEFORE_SWAP | AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        address hookAddr = address(flags);

        deployCodeTo(
            "VolatilityFeeHook.sol:VolatilityFeeHook", abi.encode(address(manager), owner), hookAddr
        );
        hook = VolatilityFeeHook(hookAddr);

        MockERC20 tokenA = new MockERC20("TokenA", "A", 18);
        MockERC20 tokenB = new MockERC20("TokenB", "B", 18);
        if (address(tokenA) > address(tokenB)) {
            token0 = tokenB;
            token1 = tokenA;
        } else {
            token0 = tokenA;
            token1 = tokenB;
        }

        token0.mint(address(this), 100_000_000 ether);
        token1.mint(address(this), 100_000_000 ether);

        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 10,
            hooks: IHooks(hookAddr)
        });

        manager.initialize(poolKey, SQRT_PRICE_1_1);

        token0.approve(address(modifyLiquidityRouter), type(uint256).max);
        token1.approve(address(modifyLiquidityRouter), type(uint256).max);
        modifyLiquidityRouter.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: 100 ether, salt: 0}),
            ZERO_BYTES
        );
    }

    function test_swap_accumulatesProtocolFee() public {
        Currency outputCurrency = Currency.wrap(address(token1));
        uint256 hookClaimsBefore = manager.balanceOf(address(hook), outputCurrency.toId());
        assertEq(hookClaimsBefore, 0);

        _doSwap(true, 1 ether);

        // Hook should have accumulated ERC-6909 claims for the output token (token1)
        uint256 hookClaimsAfter = manager.balanceOf(address(hook), outputCurrency.toId());
        assertGt(hookClaimsAfter, 0, "hook should have accumulated protocol fee claims");
    }

    function test_swap_protocolFeeIsReasonable() public {
        // With protocolFee = 1000 (0.1%), the fee should be ~0.1% of swap output
        hook.setProtocolFee(10_000); // Set to 1% for easier verification

        uint256 balBefore = token1.balanceOf(address(this));
        _doSwap(true, 1 ether);
        uint256 received = token1.balanceOf(address(this)) - balBefore;

        Currency outputCurrency = Currency.wrap(address(token1));
        uint256 hookClaims = manager.balanceOf(address(hook), outputCurrency.toId());

        // Hook fee should be roughly 1% of (received + hookClaims), i.e. ~1% of gross output
        uint256 grossOutput = received + hookClaims;
        // Allow 1 wei rounding tolerance
        assertApproxEqAbs(hookClaims, grossOutput / 100, 1, "hook fee should be ~1% of gross output");
    }

    function test_handleHookFees_withdraws() public {
        Currency outputCurrency = Currency.wrap(address(token1));
        assertEq(0, manager.balanceOf(address(hook), outputCurrency.toId()), "hook claims should be zero before swap");
        _doSwap(true, 10 ether);

        uint256 hookClaims = manager.balanceOf(address(hook), outputCurrency.toId());
        assertGt(hookClaims, 0);

        uint256 ownerBalBefore = token1.balanceOf(owner);

        Currency[] memory currencies = new Currency[](1);
        currencies[0] = outputCurrency;
        hook.handleHookFees(currencies);

        uint256 ownerBalAfter = token1.balanceOf(owner);
        assertEq(ownerBalAfter - ownerBalBefore, hookClaims, "owner should receive all claims as real tokens");
        assertEq(manager.balanceOf(address(hook), outputCurrency.toId()), 0, "claims should be zero after withdrawal");
    }

    function test_handleHookFees_reverts_notOwner() public {
        Currency[] memory currencies = new Currency[](1);
        currencies[0] = Currency.wrap(address(token1));

        vm.prank(notOwner);
        vm.expectRevert();
        hook.handleHookFees(currencies);
    }

    function test_setProtocolFee() public {
        hook.setProtocolFee(5000);
        assertEq(hook.protocolFee(), 5000);
    }

    function test_setProtocolFee_reverts_notOwner() public {
        vm.prank(notOwner);
        vm.expectRevert();
        hook.setProtocolFee(5000);
    }

    function test_setProtocolFee_zero_noFee() public {
        hook.setProtocolFee(0);
        _doSwap(true, 1 ether);

        Currency outputCurrency = Currency.wrap(address(token1));
        uint256 hookClaims = manager.balanceOf(address(hook), outputCurrency.toId());
        assertEq(hookClaims, 0, "no protocol fee should be taken when set to 0");
    }

    function test_lpFeeStillWorks() public {
        hook.setTargetFee(poolKey, 3000);
        assertEq(hook.getTargetFee(poolKey), 3000);

        // Swap should still work with both fees active
        _doSwap(true, 1 ether);
    }

    function _doSwap(bool zeroForOne, int256 amount) internal {
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);

        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});

        uint160 priceLimit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -amount, sqrtPriceLimitX96: priceLimit}),
            settings,
            ZERO_BYTES
        );
    }
}
