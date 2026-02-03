// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { Script, console } from "forge-std/Script.sol";
import { CrossLiquidVault } from "../src/CrossLiquidVault.sol";
import { PositionManager } from "../src/PositionManager.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

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
    // Deterministic salts for CREATE2 (change these to get different addresses)
    bytes32 constant VAULT_SALT = keccak256("CrossLiquid.Vault.v1");
    bytes32 constant MANAGER_SALT = keccak256("CrossLiquid.Manager.v1");

    function run() public {
        address deployer = msg.sender;
        bool isChildChain = vm.envOr("CHILD_CHAIN", false);

        bytes32 vaultSalt = VAULT_SALT;
        bytes32 managerSalt = MANAGER_SALT;

        console.log("=== CrossLiquid Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("Is child chain:", isChildChain);
        console.log("");

        vm.startBroadcast();

        if (isChildChain) {
            deployChildChain(managerSalt);
        } else {
            deployParentChain(vaultSalt, managerSalt);
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

    function deployParentChain(bytes32 vaultSalt, bytes32 managerSalt) internal {
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

        console.log("");
        console.log("=== Parent Chain Deployment Complete ===");
        console.log("Vault Proxy:", vaultProxy);
        console.log("Vault Implementation:", address(vaultImpl));
        console.log("Manager Proxy:", managerProxy);
        console.log("Manager Implementation:", address(managerImpl));
        console.log("Owner:", deployer);
        console.log("");
        console.log("Next steps:");
        console.log(
            "1. Deploy to child chains with: CHILD_CHAIN=true forge script script/Deploy.s.sol --rpc-url <chain>"
        );
        console.log("2. Manager proxy will be at same address:", managerProxy);
    }

    function deployChildChain(bytes32 managerSalt) internal {
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

        console.log("");
        console.log("=== Child Chain Deployment Complete ===");
        console.log("Manager Proxy:", managerProxy);
        console.log("Manager Implementation:", address(managerImpl));
        console.log("Owner:", deployer);
        console.log("");
        console.log("Note: Same proxy address on all chains!");
    }
}
