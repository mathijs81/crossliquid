// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test, console } from "forge-std/Test.sol";
import { PositionManager as CLPositionManager } from "../src/PositionManager.sol";
import { CrossLiquidVault } from "../src/CrossLiquidVault.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { LiquidityAmounts } from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";

import { Deployers } from "./utils/Deployers.sol";

/// @notice Tests that our PositionManager can add/remove liquidity on Uniswap v4
/// with a native ETH/USDC pool, using real Uniswap v4 infrastructure.
contract PositionManagerUniswapV4Test is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;

    CLPositionManager public clManager;
    CrossLiquidVault public vault;
    address public owner;
    address public operator;

    PoolKey public ethUsdcPoolKey;
    PoolId public ethUsdcPoolId;

    // ~$2135 per ETH
    uint160 constant SQRT_PRICE_ETH_USDC = 3_660_848_142_156_780_574_518_248;
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    function _etch(address target, bytes memory bytecode) internal override {
        vm.etch(target, bytecode);
    }

    function setUp() public {
        owner = makeAddr("owner");
        operator = makeAddr("operator");

        // Deploy full Uniswap v4 infrastructure (PoolManager, Permit2, etc.)
        deployArtifacts();

        // Initialize native ETH / USDC pool
        Currency eth = CurrencyLibrary.ADDRESS_ZERO;
        Currency usdcCurrency = Currency.wrap(address(usdc));

        ethUsdcPoolKey = PoolKey({
            currency0: eth,
            currency1: usdcCurrency,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        poolManager.initialize(ethUsdcPoolKey, SQRT_PRICE_ETH_USDC);
        ethUsdcPoolId = ethUsdcPoolKey.toId();

        // Deploy CrossLiquid vault + manager
        CrossLiquidVault vaultImpl = new CrossLiquidVault();
        ERC1967Proxy vaultProxy =
            new ERC1967Proxy(address(vaultImpl), abi.encodeCall(CrossLiquidVault.initialize, (owner)));
        vault = CrossLiquidVault(payable(address(vaultProxy)));

        CLPositionManager managerImpl = new CLPositionManager();
        ERC1967Proxy managerProxy = new ERC1967Proxy(
            address(managerImpl), abi.encodeCall(CLPositionManager.initialize, (payable(address(vault)), owner))
        );
        clManager = CLPositionManager(payable(address(managerProxy)));

        vm.startPrank(owner);
        vault.setManager(address(clManager));
        clManager.setOperator(operator);
        vm.stopPrank();

        // Fund the manager with ETH and USDC
        vm.deal(address(clManager), 100 ether);
        usdc.mint(address(clManager), 500_000 * 1e6);
    }

    function testPoolInitialized() public view {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(ethUsdcPoolId);
        assertEq(sqrtPriceX96, SQRT_PRICE_ETH_USDC, "Pool should be initialized at expected price");
    }

    function testDepositLiquidity() public {
        int24 tickLower = TickMath.minUsableTick(TICK_SPACING);
        int24 tickUpper = TickMath.maxUsableTick(TICK_SPACING);

        uint256 ethAmount = 10 ether;
        uint256 usdcAmount = 21_350 * 1e6; // ~$2135 per ETH

        uint256 ethBefore = address(clManager).balance;
        uint256 usdcBefore = usdc.balanceOf(address(clManager));

        vm.prank(operator);
        (uint128 liquidity, uint256 amount0, uint256 amount1) = clManager.depositToUniswap(
            address(poolManager), ethUsdcPoolKey, tickLower, tickUpper, ethAmount, usdcAmount, 0, 0
        );

        assertGt(liquidity, 0, "Should have added liquidity");
        assertGt(amount0, 0, "Should have used some ETH");
        assertGt(amount1, 0, "Should have used some USDC");

        // ETH and USDC balances should have decreased
        assertEq(address(clManager).balance, ethBefore - amount0, "ETH balance mismatch");
        assertEq(usdc.balanceOf(address(clManager)), usdcBefore - amount1, "USDC balance mismatch");

        // Position should be tracked
        assertEq(clManager.getPositionCount(), 1, "Should track one position");
    }

    function testDepositAndWithdraw() public {
        int24 tickLower = TickMath.minUsableTick(TICK_SPACING);
        int24 tickUpper = TickMath.maxUsableTick(TICK_SPACING);

        uint256 ethAmount = 5 ether;
        uint256 usdcAmount = 10_675 * 1e6;

        // Deposit
        vm.prank(operator);
        (uint128 liquidity, uint256 depositedEth, uint256 depositedUsdc) = clManager.depositToUniswap(
            address(poolManager), ethUsdcPoolKey, tickLower, tickUpper, ethAmount, usdcAmount, 0, 0
        );

        uint256 ethBeforeWithdraw = address(clManager).balance;
        uint256 usdcBeforeWithdraw = usdc.balanceOf(address(clManager));

        // Withdraw all liquidity
        vm.prank(operator);
        (uint256 withdrawnEth, uint256 withdrawnUsdc) = clManager.withdrawFromUniswap(
            address(poolManager), ethUsdcPoolKey, tickLower, tickUpper, liquidity, 0, 0
        );

        assertGt(withdrawnEth, 0, "Should have received ETH back");
        assertGt(withdrawnUsdc, 0, "Should have received USDC back");

        // Balances should have increased
        assertEq(address(clManager).balance, ethBeforeWithdraw + withdrawnEth, "ETH not returned");
        assertEq(usdc.balanceOf(address(clManager)), usdcBeforeWithdraw + withdrawnUsdc, "USDC not returned");

        // Position should be removed (all liquidity withdrawn)
        assertEq(clManager.getPositionCount(), 0, "Position should be removed after full withdrawal");
    }

    function testPartialWithdraw() public {
        int24 tickLower = TickMath.minUsableTick(TICK_SPACING);
        int24 tickUpper = TickMath.maxUsableTick(TICK_SPACING);

        vm.prank(operator);
        (uint128 liquidity,,) = clManager.depositToUniswap(
            address(poolManager), ethUsdcPoolKey, tickLower, tickUpper, 10 ether, 21_350 * 1e6, 0, 0
        );

        // Withdraw half
        uint128 halfLiquidity = liquidity / 2;
        vm.prank(operator);
        clManager.withdrawFromUniswap(
            address(poolManager), ethUsdcPoolKey, tickLower, tickUpper, halfLiquidity, 0, 0
        );

        // Position should still exist with remaining liquidity
        assertEq(clManager.getPositionCount(), 1, "Position should still exist");

        bytes32[] memory ids = clManager.getAllPositionIds();
        CLPositionManager.Position memory pos = clManager.getPosition(ids[0]);
        assertEq(pos.liquidity, liquidity - halfLiquidity, "Remaining liquidity should be half");
    }

    function testAddToExistingPosition() public {
        int24 tickLower = TickMath.minUsableTick(TICK_SPACING);
        int24 tickUpper = TickMath.maxUsableTick(TICK_SPACING);

        // First deposit
        vm.prank(operator);
        (uint128 liquidity1,,) = clManager.depositToUniswap(
            address(poolManager), ethUsdcPoolKey, tickLower, tickUpper, 5 ether, 10_675 * 1e6, 0, 0
        );

        // Second deposit to same range — should increase existing position
        vm.prank(operator);
        (uint128 liquidity2,,) = clManager.depositToUniswap(
            address(poolManager), ethUsdcPoolKey, tickLower, tickUpper, 5 ether, 10_675 * 1e6, 0, 0
        );

        assertEq(clManager.getPositionCount(), 1, "Should still be one position");

        bytes32[] memory ids = clManager.getAllPositionIds();
        CLPositionManager.Position memory pos = clManager.getPosition(ids[0]);
        assertEq(pos.liquidity, liquidity1 + liquidity2, "Liquidity should be combined");
    }

    function testAccessControlOnDeposit() public {
        int24 tickLower = TickMath.minUsableTick(TICK_SPACING);
        int24 tickUpper = TickMath.maxUsableTick(TICK_SPACING);

        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(CLPositionManager.NotOperatorOrOwner.selector);
        clManager.depositToUniswap(
            address(poolManager), ethUsdcPoolKey, tickLower, tickUpper, 1 ether, 2_135 * 1e6, 0, 0
        );
    }

    function testAccessControlOnWithdraw() public {
        int24 tickLower = TickMath.minUsableTick(TICK_SPACING);
        int24 tickUpper = TickMath.maxUsableTick(TICK_SPACING);

        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(CLPositionManager.NotOperatorOrOwner.selector);
        clManager.withdrawFromUniswap(
            address(poolManager), ethUsdcPoolKey, tickLower, tickUpper, 100, 0, 0
        );
    }

    function testGetPositionWithPoolState() public {
        int24 tickLower = TickMath.minUsableTick(TICK_SPACING);
        int24 tickUpper = TickMath.maxUsableTick(TICK_SPACING);

        vm.prank(operator);
        clManager.depositToUniswap(
            address(poolManager), ethUsdcPoolKey, tickLower, tickUpper, 5 ether, 10_675 * 1e6, 0, 0
        );

        bytes32[] memory ids = clManager.getAllPositionIds();
        (CLPositionManager.Position memory pos, int24 currentTick, uint160 sqrtPriceX96, bool inRange) =
            clManager.getPositionWithPoolState(ids[0]);

        assertGt(pos.liquidity, 0, "Position should have liquidity");
        assertEq(sqrtPriceX96, SQRT_PRICE_ETH_USDC, "Price should match init price");
        assertTrue(inRange, "Full-range position should be in range");
    }
}
