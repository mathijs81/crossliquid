// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { Script, console } from "forge-std/Script.sol";
import { CrossLiquidVault } from "../src/CrossLiquidVault.sol";
import { PositionManager } from "../src/PositionManager.sol";

/**
 * @title Deploy
 * @notice Script to deploy all contracts
 * @dev Deploys CrossLiquidVault and PositionManager, sets up manager relationship
 *
 * Usage:
 *   Deploy to local anvil:
 *     forge script script/Deploy.s.sol --rpc-url localhost --broadcast
 *
 *   Deploy to Base mainnet:
 *     forge script script/Deploy.s.sol --rpc-url base --broadcast --verify
 *
 *   Deploy to child chain (Optimism, no vault):
 *     CHILD_CHAIN=true forge script script/Deploy.s.sol --rpc-url optimism --broadcast --verify
 */
contract Deploy is Script {
    function run() public {
        // Get the deployer's address (will be the owner of contracts)
        address deployer = msg.sender;
        bool isChildChain = vm.envOr("CHILD_CHAIN", false);

        console.log("Deploying contracts with deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("Is child chain:", isChildChain);

        // Start broadcasting transactions
        vm.startBroadcast();

        if (isChildChain) {
            // Deploy only PositionManager on child chains (no vault)
            PositionManager positionManager = new PositionManager(payable(address(0)), deployer);
            console.log("PositionManager deployed at:", address(positionManager));

            vm.stopBroadcast();

            console.log("\n=== Child Chain Deployment Summary ===");
            console.log("PositionManager:", address(positionManager));
            console.log("Owner:", deployer);
            console.log("\nNote: Deploy with same owner address on all chains for consistency");
        } else {
            // Deploy vault and manager on parent chain (Base)
            CrossLiquidVault vault = new CrossLiquidVault(deployer);
            console.log("CrossLiquidVault deployed at:", address(vault));

            PositionManager positionManager = new PositionManager(payable(address(vault)), deployer);
            console.log("PositionManager deployed at:", address(positionManager));

            // Set PositionManager as vault manager
            vault.setManager(address(positionManager));
            console.log("PositionManager set as vault manager");

            vm.stopBroadcast();

            console.log("\n=== Parent Chain Deployment Summary ===");
            console.log("CrossLiquidVault:", address(vault));
            console.log("PositionManager:", address(positionManager));
            console.log("Owner:", deployer);
            console.log("Vault Manager:", vault.manager());
        }
    }
}
