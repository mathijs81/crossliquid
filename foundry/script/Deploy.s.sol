// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { CrossLiquidVault } from "../src/CrossLiquidVault.sol";
import { PositionManager } from "../src/PositionManager.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { VolatilityFeeHook } from "../src/VolatilityFeeHook.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

/**
 * @title Deploy
 * @notice Script to deploy upgradeable contracts using CREATE2 for deterministic addresses
 * @dev Deploys same proxy addresses across all chains using CREATE2
 *
 * Usage:
 *   Deploy to Base (parent chain with vault):
 *     forge script script/Deploy.s.sol --rpc-url base --broadcast --verify
 *
 *   Deploy to child chain (Optimism, no vault):
 *     CHILD_CHAIN=true forge script script/Deploy.s.sol --rpc-url optimism --broadcast --verify
 *
 *   Use custom salt:
 *     SALT="my-unique-salt" forge script script/Deploy.s.sol --rpc-url base --broadcast
 */
contract Deploy is Script {
    using PoolIdLibrary for PoolKey;

    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // ~$2135 ETH/USDC (same as DeployUniswapV4)
    uint160 constant SQRT_PRICE_ETH_USDC = 3_660_848_142_156_780_574_518_248;
    int24 constant HOOK_POOL_TICK_SPACING = 10;

    // Deterministic salts for CREATE2 (change these to get different addresses)
    bytes32 constant VAULT_SALT = keccak256("CrossLiquid.Vault.v1");
    bytes32 constant MANAGER_SALT = keccak256("CrossLiquid.Manager.v1");

    function run() public {
        address deployer = msg.sender;
        bool isChildChain = vm.envOr("CHILD_CHAIN", false);
        IPoolManager poolManager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        address usdcAddress = vm.envAddress("USDC_ADDRESS");

        bytes32 vaultSalt = VAULT_SALT;
        bytes32 managerSalt = MANAGER_SALT;

        console.log("=== CrossLiquid Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("PoolManager:", address(poolManager));
        console.log("USDC:", usdcAddress);
        console.log("Is child chain:", isChildChain);
        console.log("");

        vm.startBroadcast();

        if (isChildChain) {
            deployChildChain(managerSalt, poolManager, usdcAddress);
        } else {
            deployParentChain(vaultSalt, managerSalt, poolManager, usdcAddress);
        }

        vm.stopBroadcast();
    }

    function deployCreate2(bytes32 salt, bytes memory bytecode) internal returns (address addr) {
        assembly {
            addr := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }
        }
    }

    function deployHook(IPoolManager poolManager, address usdcAddress) internal returns (address) {
        address deployer = msg.sender;
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory constructorArgs = abi.encode(poolManager, deployer);

        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(VolatilityFeeHook).creationCode, constructorArgs);

        console.log("Mined hook address:", hookAddress);

        VolatilityFeeHook hook = new VolatilityFeeHook{ salt: salt }(poolManager, deployer);
        require(address(hook) == hookAddress, "Hook address mismatch");
        console.log("VolatilityFeeHook deployed:", address(hook));

        // Initialize ETH/USDC pool with the hook
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(usdcAddress),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: HOOK_POOL_TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        int24 tick = poolManager.initialize(poolKey, SQRT_PRICE_ETH_USDC);
        PoolId poolId = poolKey.toId();
        console.log("Hook pool initialized:");
        console.log("  Pool ID:", vm.toString(PoolId.unwrap(poolId)));
        console.log("  Initial tick:", vm.toString(tick));

        return address(hook);
    }

    function deployParentChain(
        bytes32 vaultSalt,
        bytes32 managerSalt,
        IPoolManager poolManager,
        address usdcAddress
    ) internal {
        address deployer = msg.sender;
        console.log("Deploying on parent chain (Base)...");

        // 1. Deploy vault implementation
        CrossLiquidVault vaultImpl = new CrossLiquidVault();
        console.log("Vault implementation deployed:", address(vaultImpl));

        // 2. Deploy vault proxy via CREATE2
        bytes memory vaultProxyCreationCode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(address(vaultImpl), abi.encodeCall(CrossLiquidVault.initialize, (deployer)))
        );

        bytes32 vaultProxyInitCodeHash = keccak256(vaultProxyCreationCode);
        address predictedVaultProxy = vm.computeCreate2Address(vaultSalt, vaultProxyInitCodeHash);
        console.log("Predicted vault proxy:", predictedVaultProxy);

        address payable vaultProxy = payable(deployCreate2(vaultSalt, vaultProxyCreationCode));
        require(vaultProxy == predictedVaultProxy, "Vault proxy address mismatch");
        console.log("Vault proxy deployed:", vaultProxy);

        // 3. Deploy manager implementation
        PositionManager managerImpl = new PositionManager();
        console.log("Manager implementation deployed:", address(managerImpl));

        // 4. Deploy manager proxy via CREATE2
        bytes memory managerProxyCreationCode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(
                address(managerImpl), abi.encodeCall(PositionManager.initialize, (payable(vaultProxy), deployer))
            )
        );

        bytes32 managerProxyInitCodeHash = keccak256(managerProxyCreationCode);
        address predictedManagerProxy = vm.computeCreate2Address(managerSalt, managerProxyInitCodeHash);
        console.log("Predicted manager proxy:", predictedManagerProxy);

        address managerProxy = deployCreate2(managerSalt, managerProxyCreationCode);
        require(managerProxy == predictedManagerProxy, "Manager proxy address mismatch");
        console.log("Manager proxy deployed:", managerProxy);

        // 5. Setup: set manager on vault
        CrossLiquidVault(vaultProxy).setManager(managerProxy);
        console.log("Manager set on vault");

        // 6. Deploy hook and initialize pool
        address hook = deployHook(poolManager, usdcAddress);

        console.log("");
        console.log("=== Parent Chain Deployment Complete ===");
        console.log("Vault Proxy:", vaultProxy);
        console.log("Vault Implementation:", address(vaultImpl));
        console.log("Manager Proxy:", managerProxy);
        console.log("Manager Implementation:", address(managerImpl));
        console.log("Hook:", hook);
        console.log("Owner:", deployer);
        console.log("");
        console.log("Next steps:");
        console.log(
            "1. Deploy to child chains with: CHILD_CHAIN=true forge script script/Deploy.s.sol --rpc-url <chain>"
        );
        console.log("2. Manager proxy will be at same address:", managerProxy);

        // 7. Write json deployment file
        // TODO(mathijs): take a better directory name than "uniswapContracts", needs to be adjusted in agent/
        // and foundry.toml permissions
        string memory chainIdStr = vm.toString(block.chainid);
        string memory outputDir = string.concat("broadcast/uniswapContracts/", chainIdStr);
        string memory outputPath = string.concat(outputDir, "/deployedCrossLiquid.json");

        vm.createDir(outputDir, true);

        string memory objectKey = "crossLiquid";
        vm.serializeAddress(objectKey, "vault", address(vaultProxy));
        vm.serializeAddress(objectKey, "manager", address(managerProxy));
        string memory json = vm.serializeAddress(objectKey, "hook", hook);

        vm.writeJson(json, outputPath);
    }

    function deployChildChain(bytes32 managerSalt, IPoolManager poolManager, address usdcAddress) internal {
        address deployer = msg.sender;
        console.log("Deploying on child chain...");

        // 1. Deploy manager implementation
        PositionManager managerImpl = new PositionManager();
        console.log("Manager implementation deployed:", address(managerImpl));

        // 2. Deploy manager proxy via CREATE2 (no vault on child chain)
        bytes memory managerProxyCreationCode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(
                address(managerImpl), abi.encodeCall(PositionManager.initialize, (payable(address(0)), deployer))
            )
        );

        bytes32 managerProxyInitCodeHash = keccak256(managerProxyCreationCode);
        address predictedManagerProxy = vm.computeCreate2Address(managerSalt, managerProxyInitCodeHash);
        console.log("Predicted manager proxy:", predictedManagerProxy);

        address managerProxy = deployCreate2(managerSalt, managerProxyCreationCode);
        require(managerProxy == predictedManagerProxy, "Manager proxy address mismatch");
        console.log("Manager proxy deployed:", managerProxy);

        // 3. Deploy hook and initialize pool
        address hook = deployHook(poolManager, usdcAddress);

        console.log("");
        console.log("=== Child Chain Deployment Complete ===");
        console.log("Manager Proxy:", managerProxy);
        console.log("Manager Implementation:", address(managerImpl));
        console.log("Hook:", hook);
        console.log("Owner:", deployer);
        console.log("");
        console.log("Note: Same proxy address on all chains!");

        // 4. Write json deployment file
        string memory chainIdStr = vm.toString(block.chainid);
        string memory outputDir = string.concat("broadcast/uniswapContracts/", chainIdStr);
        string memory outputPath = string.concat(outputDir, "/deployedCrossLiquid.json");

        vm.createDir(outputDir, true);

        string memory objectKey = "crossLiquid";
        vm.serializeAddress(objectKey, "manager", address(managerProxy));
        string memory json = vm.serializeAddress(objectKey, "hook", hook);

        vm.writeJson(json, outputPath);
    }
}
