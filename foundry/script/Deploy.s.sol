// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { Script, console } from "forge-std/Script.sol";
import { CrossLiquidVault } from "../src/CrossLiquidVault.sol";
import { PositionManager } from "../src/PositionManager.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ICREATE3Factory } from "create3-factory/src/ICREATE3Factory.sol";

/**
 * @title Deploy
 * @notice Script to deploy upgradeable contracts using CREATE3 for deterministic addresses
 * @dev Deploys same proxy addresses across all chains using CREATE3
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
    // CREATE3 Factory (deployed on most chains at this address)
    ICREATE3Factory constant CREATE3_FACTORY = ICREATE3Factory(0x9fBB3DF7C40Da2e5A0dE984fFE2CCB7C47cd0ABf);

    // Deterministic salts for CREATE3 (change these to get different addresses)
    bytes32 constant VAULT_SALT = keccak256("CrossLiquid.Vault.v1");
    bytes32 constant MANAGER_SALT = keccak256("CrossLiquid.Manager.v1");

    function run() public {
        address deployer = msg.sender;
        bool isChildChain = vm.envOr("CHILD_CHAIN", false);

        // Allow custom salt prefix from env
        string memory saltPrefix = vm.envOr("SALT", string(""));
        bytes32 vaultSalt = saltPrefix.length > 0 ? keccak256(abi.encode(saltPrefix, "vault")) : VAULT_SALT;
        bytes32 managerSalt = saltPrefix.length > 0 ? keccak256(abi.encode(saltPrefix, "manager")) : MANAGER_SALT;

        console.log("=== CrossLiquid Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("Is child chain:", isChildChain);
        console.log("");

        // Predict addresses (same on all chains!)
        address predictedVaultProxy = CREATE3_FACTORY.getDeployed(deployer, vaultSalt);
        address predictedManagerProxy = CREATE3_FACTORY.getDeployed(deployer, managerSalt);

        console.log("Predicted vault proxy:", predictedVaultProxy);
        console.log("Predicted manager proxy:", predictedManagerProxy);
        console.log("");

        vm.startBroadcast();

        if (isChildChain) {
            deployChildChain(deployer, managerSalt, predictedManagerProxy);
        } else {
            deployParentChain(deployer, vaultSalt, managerSalt, predictedVaultProxy, predictedManagerProxy);
        }

        vm.stopBroadcast();
    }

    function deployParentChain(
        address deployer,
        bytes32 vaultSalt,
        bytes32 managerSalt,
        address predictedVaultProxy,
        address predictedManagerProxy
    ) internal {
        console.log("Deploying on parent chain (Base)...");

        // 1. Deploy vault implementation
        CrossLiquidVault vaultImpl = new CrossLiquidVault();
        console.log("Vault implementation deployed:", address(vaultImpl));

        // 2. Deploy vault proxy via CREATE3
        bytes memory vaultProxyCreationCode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(
                address(vaultImpl),
                abi.encodeCall(CrossLiquidVault.initialize, (deployer))
            )
        );

        address vaultProxy = CREATE3_FACTORY.deploy(vaultSalt, vaultProxyCreationCode);
        require(vaultProxy == predictedVaultProxy, "Vault proxy address mismatch");
        console.log("Vault proxy deployed:", vaultProxy);

        // 3. Deploy manager implementation
        PositionManager managerImpl = new PositionManager();
        console.log("Manager implementation deployed:", address(managerImpl));

        // 4. Deploy manager proxy via CREATE3
        bytes memory managerProxyCreationCode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(
                address(managerImpl),
                abi.encodeCall(PositionManager.initialize, (payable(vaultProxy), deployer))
            )
        );

        address managerProxy = CREATE3_FACTORY.deploy(managerSalt, managerProxyCreationCode);
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
        console.log("1. Deploy to child chains with: CHILD_CHAIN=true forge script script/Deploy.s.sol --rpc-url <chain>");
        console.log("2. Manager proxy will be at same address:", managerProxy);
    }

    function deployChildChain(
        address deployer,
        bytes32 managerSalt,
        address predictedManagerProxy
    ) internal {
        console.log("Deploying on child chain...");

        // 1. Deploy manager implementation
        PositionManager managerImpl = new PositionManager();
        console.log("Manager implementation deployed:", address(managerImpl));

        // 2. Deploy manager proxy via CREATE3 (no vault on child chain)
        bytes memory managerProxyCreationCode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(
                address(managerImpl),
                abi.encodeCall(PositionManager.initialize, (payable(address(0)), deployer))
            )
        );

        address managerProxy = CREATE3_FACTORY.deploy(managerSalt, managerProxyCreationCode);
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
