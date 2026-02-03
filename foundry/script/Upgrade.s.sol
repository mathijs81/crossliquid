// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { Script, console } from "forge-std/Script.sol";
import { CrossLiquidVault } from "../src/CrossLiquidVault.sol";
import { PositionManager } from "../src/PositionManager.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title Upgrade
 * @notice Script to upgrade implementation contracts for deployed proxies
 * @dev Works on any chain where proxies are deployed
 *
 * Usage:
 *   Upgrade on Base (both vault and manager):
 *     VAULT_PROXY=0x... MANAGER_PROXY=0x... forge script script/Upgrade.s.sol --rpc-url base --broadcast
 *
 *   Upgrade on child chain (manager only):
 *     MANAGER_PROXY=0x... forge script script/Upgrade.s.sol --rpc-url optimism --broadcast
 *
 *   Upgrade only vault:
 *     VAULT_PROXY=0x... UPGRADE_VAULT=true forge script script/Upgrade.s.sol --rpc-url base --broadcast
 *
 *   Upgrade only manager:
 *     MANAGER_PROXY=0x... UPGRADE_MANAGER=true forge script script/Upgrade.s.sol --rpc-url base --broadcast
 */
contract Upgrade is Script {
    function run() public {
        address vaultProxy = vm.envOr("VAULT_PROXY", address(0));
        address managerProxy = vm.envOr("MANAGER_PROXY", address(0));
        bool upgradeVault = vm.envOr("UPGRADE_VAULT", vaultProxy != address(0));
        bool upgradeManager = vm.envOr("UPGRADE_MANAGER", managerProxy != address(0));

        console.log("=== CrossLiquid Upgrade ===");
        console.log("Chain ID:", block.chainid);
        console.log("Upgrader:", msg.sender);
        console.log("");

        vm.startBroadcast();

        if (upgradeVault && vaultProxy != address(0)) {
            upgradeVaultImplementation(payable(vaultProxy));
        }

        if (upgradeManager && managerProxy != address(0)) {
            upgradeManagerImplementation(payable(managerProxy));
        }

        if (!upgradeVault && !upgradeManager) {
            console.log("ERROR: No proxies specified for upgrade");
            console.log("Set VAULT_PROXY and/or MANAGER_PROXY environment variables");
            revert("No proxies specified");
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Upgrade Complete ===");
    }

    function upgradeVaultImplementation(address payable vaultProxy) internal {
        console.log("Upgrading vault...");
        console.log("Vault proxy:", vaultProxy);

        // Get current implementation
        address currentImpl = getImplementation(vaultProxy);
        console.log("Current implementation:", currentImpl);

        // Deploy new implementation
        CrossLiquidVault newVaultImpl = new CrossLiquidVault();
        console.log("New implementation deployed:", address(newVaultImpl));

        // Upgrade proxy to new implementation
        CrossLiquidVault(vaultProxy).upgradeToAndCall(address(newVaultImpl), "");
        console.log("Vault upgraded successfully");

        // Verify upgrade
        address newImpl = getImplementation(vaultProxy);
        require(newImpl == address(newVaultImpl), "Upgrade verification failed");
        console.log("Upgrade verified!");
        console.log("");
    }

    function upgradeManagerImplementation(address payable managerProxy) internal {
        console.log("Upgrading manager...");
        console.log("Manager proxy:", managerProxy);

        // Get current implementation
        address currentImpl = getImplementation(managerProxy);
        console.log("Current implementation:", currentImpl);

        // Deploy new implementation
        PositionManager newManagerImpl = new PositionManager();
        console.log("New implementation deployed:", address(newManagerImpl));

        // Upgrade proxy to new implementation
        PositionManager(managerProxy).upgradeToAndCall(address(newManagerImpl), "");
        console.log("Manager upgraded successfully");

        // Verify upgrade
        address newImpl = getImplementation(managerProxy);
        require(newImpl == address(newManagerImpl), "Upgrade verification failed");
        console.log("Upgrade verified!");
        console.log("");
    }

    /// Get implementation address from ERC1967 proxy
    function getImplementation(address proxy) internal view returns (address) {
        bytes32 slot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        return address(uint160(uint256(vm.load(proxy, slot))));
    }
}
