// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { VolatilityFeeHook } from "../src/VolatilityFeeHook.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

/// @notice Deploys VolatilityFeeHook and initializes an ETH/USDC pool with it.
/// Uses CREATE2 with HookMiner to get an address whose lower bits encode the hook permissions.
///
/// Usage:
///   POOL_MANAGER=0x... USDC_ADDRESS=0x... forge script script/DeployVolatilityFeeHook.s.sol --rpc-url localhost --broadcast
///   POOL_MANAGER=0x... USDC_ADDRESS=0x... forge script script/DeployVolatilityFeeHook.s.sol --rpc-url base --broadcast --verify
contract DeployVolatilityFeeHook is Script {
    using PoolIdLibrary for PoolKey;

    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint160 constant SQRT_PRICE_ETH_USDC = 3_660_848_142_156_780_574_518_248;

    function run() public {
        IPoolManager poolManager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address owner = msg.sender;

        console.log("=== VolatilityFeeHook Deployment ===");
        console.log("PoolManager:", address(poolManager));
        console.log("USDC:", usdcAddress);
        console.log("Owner:", owner);
        console.log("Chain ID:", block.chainid);

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory constructorArgs = abi.encode(poolManager, owner);

        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(VolatilityFeeHook).creationCode, constructorArgs);

        console.log("Mined hook address:", hookAddress);

        vm.startBroadcast();

        VolatilityFeeHook hook = new VolatilityFeeHook{ salt: salt }(poolManager, owner);
        require(address(hook) == hookAddress, "DeployVolatilityFeeHook: address mismatch");

        // Initialize ETH/USDC pool with the hook
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(usdcAddress),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 10,
            hooks: IHooks(address(hook))
        });

        int24 tick = poolManager.initialize(poolKey, SQRT_PRICE_ETH_USDC);
        PoolId poolId = poolKey.toId();

        vm.stopBroadcast();

        console.log("VolatilityFeeHook deployed at:", address(hook));
        console.log("Hook pool initialized:");
        console.log("  Pool ID:", vm.toString(PoolId.unwrap(poolId)));
        console.log("  Initial tick:", vm.toString(tick));
        console.log("=== Deployment Complete ===");

        // Write hook address to deployedCrossLiquid.json (merge into existing if present)
        string memory chainIdStr = vm.toString(block.chainid);
        string memory outputDir = string.concat("broadcast/uniswapContracts/", chainIdStr);
        string memory outputPath = string.concat(outputDir, "/deployedCrossLiquid.json");

        vm.createDir(outputDir, true);

        string memory json = vm.serializeAddress("hook", "hook", address(hook));
        vm.writeJson(json, outputPath, ".hook");
    }
}
