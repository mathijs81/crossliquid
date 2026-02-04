// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { LiquidityAmounts } from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { Deployers } from "../test/utils/Deployers.sol";

/**
 * @title DeployUniswapV4
 * @notice Deployment script for Uniswap v4 infrastructure
 * @dev Usage:
 *   Local anvil: MINT_TOKENS=true forge script script/DeployUniswapV4.s.sol --rpc-url localhost --broadcast
 */
contract DeployUniswapV4 is Script, Deployers {
    using PoolIdLibrary for PoolKey;

    // Pool configuration
    // Main pool: 0.05% fee for cheap swaps
    uint24 constant MAIN_FEE = 500; // 0.05%
    int24 constant MAIN_TICK_SPACING = 10;

    // Test pool: 0.3% fee (will add hooks later)
    uint24 constant TEST_FEE = 3000; // 0.3%
    int24 constant TEST_TICK_SPACING = 60;

    // Initial price: 1 ETH = 2324 USDC
    // sqrt(2324 USDC / 1 ETH) = sqrt(2324e6 / 1e18) = sqrt(2.324e-9)
    // sqrtPriceX96 = sqrt(2.324e-9) * 2^96 ≈ 3.819e24
    uint160 constant SQRT_PRICE_ETH_USDC = 3_819_373_515_508_547_128_207_358_464;

    function run() public {
        address deployer = msg.sender;
        bool mintTokens = vm.envOr("MINT_TOKENS", false);

        console.log("=== Uniswap v4 Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("Mint tokens:", mintTokens);
        console.log("");
        vm.startBroadcast();
        // Deploy Permit2 before broadcast (etch operation)
        // deployPermit2();
        deployArtifacts();
        vm.label(address(permit2), "Permit2");
        vm.label(address(poolManager), "PoolManager");
        vm.label(address(positionManager), "PositionManager");
        vm.label(address(swapRouter), "V4SwapRouter");
        vm.label(address(usdc), "USDC");
        vm.label(address(weth), "WETH");
        console.log("Permit2 etched:", address(permit2));

        console.log("Infrastructure deployed:");
        console.log("  PoolManager:", address(poolManager));
        console.log("  PositionManager:", address(positionManager));
        console.log("  SwapRouter:", address(swapRouter));
        console.log("  USDC:", address(usdc));
        console.log("  WETH:", address(weth));
        console.log("");
        // Native ETH is always token0 (address(0) < any other address)
        Currency eth = Currency.wrap(address(0));
        Currency usdcCurrency = Currency.wrap(address(usdc));

        // 4. Initialize Pool 1: Main liquidity pool (0.05% fee)
        PoolKey memory mainPoolKey = PoolKey({
            currency0: eth,
            currency1: usdcCurrency,
            fee: MAIN_FEE,
            tickSpacing: MAIN_TICK_SPACING,
            hooks: IHooks(address(0))
        });

        int24 mainTick = poolManager.initialize(mainPoolKey, SQRT_PRICE_ETH_USDC);
        PoolId mainPoolId = mainPoolKey.toId();

        console.log("Main Pool (0.05%) initialized:");
        console.log("  Pool ID:", vm.toString(PoolId.unwrap(mainPoolId)));
        console.log("  Initial tick:", vm.toString(mainTick));
        console.log("  Initial price: 1 ETH = 2324 USDC");
        console.log("");

        // 5. Initialize Pool 2: Test pool for hooks (0.3% fee)
        PoolKey memory testPoolKey = PoolKey({
            currency0: eth,
            currency1: usdcCurrency,
            fee: TEST_FEE,
            tickSpacing: TEST_TICK_SPACING,
            hooks: IHooks(address(0))
        });

        int24 testTick = poolManager.initialize(testPoolKey, SQRT_PRICE_ETH_USDC);
        PoolId testPoolId = testPoolKey.toId();

        console.log("Test Pool (0.3%) initialized:");
        console.log("  Pool ID:", vm.toString(PoolId.unwrap(testPoolId)));
        console.log("  Initial tick:", vm.toString(testTick));
        console.log("  (No hooks yet - will add later)");
        console.log("");

        // 6. Mint USDC and add initial liquidity if requested
        if (mintTokens) {
            // Mint USDC (6 decimals)
            usdc.mint(deployer, 1_000_000 * 1e6); // 1M USDC
            console.log("Minted 1,000,000 USDC");
            console.log("Deployer has test ETH from Anvil");
            console.log("");

            // Add liquidity to main pool (0.05% - big & cheap)
            console.log("Adding liquidity to main pool (0.05%)...");
            addInitialLiquidity(mainPoolKey, usdc, deployer, 50 ether, 116_200 * 1e6); // ~50 ETH worth
            console.log("");

            // Add smaller liquidity to test pool (0.3%)
            console.log("Adding liquidity to test pool (0.3%)...");
            addInitialLiquidity(testPoolKey, usdc, deployer, 5 ether, 11_620 * 1e6); // ~5 ETH worth
            console.log("");
        }

        vm.stopBroadcast();

        // 7. Write deployment data to JSON
        string memory chainIdStr = vm.toString(block.chainid);
        string memory outputDir = string.concat("broadcast/uniswapContracts/", chainIdStr);
        string memory outputPath = string.concat(outputDir, "/deployedUniswap.json");

        vm.createDir(outputDir, true);

        string memory objectKey = "uniswapV4";
        vm.serializeAddress(objectKey, "poolManager", address(poolManager));
        vm.serializeAddress(objectKey, "positionManager", address(positionManager));
        vm.serializeAddress(objectKey, "permit2", address(permit2));
        vm.serializeAddress(objectKey, "weth", address(weth));
        vm.serializeAddress(objectKey, "usdc", address(usdc));
        vm.serializeString(objectKey, "mainPoolId", vm.toString(PoolId.unwrap(mainPoolId)));
        vm.serializeString(objectKey, "mainPoolFee", "0.05%");
        vm.serializeString(objectKey, "testPoolId", vm.toString(PoolId.unwrap(testPoolId)));
        string memory json = vm.serializeString(objectKey, "testPoolFee", "0.3%");

        vm.writeJson(json, outputPath);

        console.log("=== Deployment Complete ===");
        console.log("Data written to:", outputPath);
        console.log("");
        console.log("Main pool (0.05%): Use for cheap swaps");
        console.log("Test pool (0.3%): Will add hooks later");
    }

    // Override _etch to use anvil RPC
    function _etch(address target, bytes memory bytecode) internal override {
        // if (block.chainid == 31337) {
        //     vm.rpc("anvil_setCode", string.concat('["', vm.toString(target), '",', '"', vm.toString(bytecode), '"]'));
        //     //vm.etch(target, bytecode);
        // } else {

        revert("Permit2 should be injected from the commandline!");
        // }
    }

    function addInitialLiquidity(
        PoolKey memory poolKey,
        MockERC20 usdc,
        address recipient,
        uint256 ethAmount,
        uint256 usdcAmount
    ) internal {
        // Setup Permit2 approval for USDC
        usdc.approve(address(permit2), type(uint256).max);
        permit2.approve(address(usdc), address(positionManager), type(uint160).max, type(uint48).max);

        // Calculate liquidity for full range
        int24 tickLower = TickMath.minUsableTick(poolKey.tickSpacing);
        int24 tickUpper = TickMath.maxUsableTick(poolKey.tickSpacing);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            SQRT_PRICE_ETH_USDC,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            ethAmount,
            usdcAmount
        );

        // Encode actions: MINT_POSITION, SETTLE_PAIR, SWEEP (ETH), SWEEP (USDC)
        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP), uint8(Actions.SWEEP)
        );

        bytes[] memory params = new bytes[](4);
        params[0] = _encodeMintParams(poolKey, tickLower, tickUpper, liquidity, ethAmount, usdcAmount, recipient);
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1); // SETTLE_PAIR settles both currencies
        params[2] = abi.encode(poolKey.currency0, recipient); // SWEEP excess ETH
        params[3] = abi.encode(poolKey.currency1, recipient); // SWEEP excess USDC

        // Send ETH value with the call for native ETH settlement
        positionManager.modifyLiquidities{ value: ethAmount }(abi.encode(actions, params), block.timestamp + 60);

        console.log("  Added liquidity:");
        console.log("    ETH:", ethAmount / 1e18, "ETH");
        console.log("    USDC:", usdcAmount / 1e6, "USDC");
        console.log("    Liquidity:", uint256(liquidity));
    }

    function _encodeMintParams(
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 amount0Max,
        uint256 amount1Max,
        address recipient
    ) internal pure returns (bytes memory) {
        return abi.encode(poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, recipient, "");
    }
}
