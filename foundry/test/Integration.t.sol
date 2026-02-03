// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { Test, console } from "forge-std/Test.sol";
import { PositionManager } from "../src/PositionManager.sol";
import { CrossLiquidVault } from "../src/CrossLiquidVault.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// Integration tests for CrossLiquidVault + PositionManager
contract IntegrationTest is Test {
    CrossLiquidVault public vault;
    PositionManager public managerBase;
    PositionManager public managerOptimism;

    address public owner;
    address public operator;
    address public user1;
    address public user2;

    function setUp() public {
        owner = makeAddr("owner");
        operator = makeAddr("operator");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        // Deploy vault with proxy
        CrossLiquidVault vaultImpl = new CrossLiquidVault();
        ERC1967Proxy vaultProxy =
            new ERC1967Proxy(address(vaultImpl), abi.encodeCall(CrossLiquidVault.initialize, (owner)));
        vault = CrossLiquidVault(payable(address(vaultProxy)));

        // Deploy Base manager with proxy
        PositionManager managerBaseImpl = new PositionManager();
        ERC1967Proxy managerBaseProxy = new ERC1967Proxy(
            address(managerBaseImpl), abi.encodeCall(PositionManager.initialize, (payable(address(vault)), owner))
        );
        managerBase = PositionManager(payable(address(managerBaseProxy)));

        // Deploy Optimism manager with proxy (no vault)
        PositionManager managerOptimismImpl = new PositionManager();
        ERC1967Proxy managerOptimismProxy = new ERC1967Proxy(
            address(managerOptimismImpl), abi.encodeCall(PositionManager.initialize, (payable(address(0)), owner))
        );
        managerOptimism = PositionManager(payable(address(managerOptimismProxy)));

        vm.startPrank(owner);
        vault.setManager(address(managerBase));
        managerBase.setOperator(operator);
        managerOptimism.setOperator(operator);
        vm.stopPrank();

        vm.deal(user1, 200 ether);
        vm.deal(user2, 200 ether);
    }

    /// Complete cross-chain workflow: deposit → withdraw → bridge → invest → return → redeem
    function testFullCrosschainWorkflow() public {
        // 1. Users deposit to vault on Base
        uint256 price1 = vault.calcMintPrice(20 ether);
        vm.prank(user1);
        vault.mint{ value: price1 }(20 ether);

        uint256 price2 = vault.calcMintPrice(15 ether);
        vm.prank(user2);
        vault.mint{ value: price2 }(15 ether);

        uint256 totalDeposited = address(vault).balance;
        assertEq(vault.balanceOf(user1), 20 ether);
        assertEq(vault.balanceOf(user2), 15 ether);

        // 2. Operator withdraws for cross-chain deployment
        vm.prank(operator);
        managerBase.withdrawFromVault(10 ether);
        assertEq(address(managerBase).balance, 10 ether);

        // 3. Simulate bridge to Optimism (via Li.Fi in production)
        address mockBridge = makeAddr("lifi-bridge");
        vm.deal(mockBridge, 10 ether);
        vm.prank(mockBridge);
        managerOptimism.receiveFromBridge{ value: 10 ether }();
        assertEq(address(managerOptimism).balance, 10 ether);

        // 4. Simulate investment and profits on Optimism
        vm.deal(address(managerOptimism), 12 ether); // Made 2 ETH profit

        // 5. Bridge profits back to Base
        vm.deal(address(managerBase), 15 ether); // Base manager receives returned funds

        // 6. Manager returns funds + profits to vault
        vm.prank(operator);
        managerBase.returnToVault(12 ether);
        assertGt(address(vault).balance, totalDeposited - 10 ether); // Has more than reserve

        // 7. Users redeem with profit
        uint256 user1BalBefore = user1.balance;
        vm.prank(user1);
        vault.redeem(10 ether);
        assertGt(user1.balance, user1BalBefore);
        assertEq(vault.balanceOf(user1), 10 ether);
    }

    /// Reserve management: keep liquidity for redemptions while investing
    function testReserveManagementAndRebalancing() public {
        // Large deposit
        uint256 price = vault.calcMintPrice(100 ether);
        vm.prank(user1);
        vault.mint{ value: price }(100 ether);

        // Invest 95% (keep 5% reserve for redemptions)
        uint256 investAmount = (address(vault).balance * 95) / 100;
        vm.prank(operator);
        managerBase.withdrawFromVault(investAmount);

        // User can redeem from reserve
        vm.prank(user1);
        vault.redeem(3 ether);
        assertEq(vault.balanceOf(user1), 97 ether);

        // Large redemption depletes reserve
        vm.prank(user1);
        vm.expectRevert(); // Not enough in vault
        vault.redeem(50 ether);

        // Operator repatriates funds for redemption
        vm.prank(operator);
        managerBase.returnToVault(50 ether);

        // Now redemption works
        vm.prank(user1);
        vault.redeem(30 ether);
        assertEq(vault.balanceOf(user1), 67 ether);

        // Operator can re-deploy after redemption (amount available in vault)
        uint256 availableInVault = address(vault).balance;
        if (availableInVault > 1 ether) {
            vm.prank(operator);
            managerBase.withdrawFromVault(availableInVault - 1 ether); // Leave 1 ETH reserve
            assertGt(address(managerBase).balance, 0);
        }
    }

    /// Multi-user scenario with rebalancing across chains
    function testMultiUserRebalancing() public {
        // Multiple users deposit
        uint256 price1 = vault.calcMintPrice(10 ether);
        vm.prank(user1);
        vault.mint{ value: price1 }(10 ether);

        uint256 price2 = vault.calcMintPrice(15 ether);
        vm.prank(user2);
        vault.mint{ value: price2 }(15 ether);

        uint256 totalDeposited = address(vault).balance;

        // Rebalance: 40% Base, 60% other chains
        uint256 baseAllocation = (totalDeposited * 40) / 100;
        vm.prank(operator);
        managerBase.withdrawFromVault(baseAllocation);

        // Simulate deploying to Uniswap on Base
        // vm.prank(operator);
        // Skip for now - requires full Uniswap setup
        // managerBase.depositToUniswap(address(0), mockKey, -887220, 887220, 0, 0, 0, 0);

        // Simulate bridge to Optimism for remaining allocation
        uint256 optimismAllocation = totalDeposited - baseAllocation - address(vault).balance;

        // User1 redeems part of position
        vm.prank(user1);
        vault.redeem(5 ether);

        // Manager returns liquidity from Base position
        vm.prank(operator);
        managerBase.returnToVault(baseAllocation / 2);

        assertGt(address(vault).balance, 0);
        assertEq(vault.balanceOf(user1), 5 ether);
        assertEq(vault.balanceOf(user2), 15 ether);
    }

    /// Emergency scenarios and owner controls
    function testEmergencyRecovery() public {
        // Setup: funds in various locations
        uint256 price = vault.calcMintPrice(50 ether);
        vm.prank(user1);
        vault.mint{ value: price }(50 ether);

        vm.prank(operator);
        managerBase.withdrawFromVault(30 ether);

        // Emergency: owner recovers all funds from manager
        address safe = makeAddr("safe-multisig");
        vm.prank(owner);
        managerBase.emergencyWithdrawETH(payable(safe), 30 ether);
        assertEq(safe.balance, 30 ether);
        assertEq(address(managerBase).balance, 0);

        // Owner can also change operator during emergency
        address newOperator = makeAddr("new-operator");
        vm.prank(owner);
        managerBase.setOperator(newOperator);
        assertEq(managerBase.operator(), newOperator);

        // Users can still redeem from vault reserve
        vm.prank(user1);
        vault.redeem(10 ether);
        assertEq(vault.balanceOf(user1), 40 ether);
    }

    /// Access control across the system
    function testSystemWideAccessControl() public {
        // Setup
        uint256 price = vault.calcMintPrice(10 ether);
        vm.prank(user1);
        vault.mint{ value: price }(10 ether);

        // Random user cannot manage vault
        vm.prank(user2);
        vm.expectRevert("Only manager can withdraw");
        vault.withdraw(user2, 1 ether);

        // Only manager can withdraw from vault
        vm.prank(operator);
        vm.expectRevert("Only manager can withdraw");
        vault.withdraw(operator, 1 ether);

        // Operator cannot withdraw on child chain
        vm.prank(operator);
        vm.expectRevert(PositionManager.NotVaultChain.selector);
        managerOptimism.withdrawFromVault(1 ether);

        // Random user cannot use manager functions
        vm.prank(user2);
        vm.expectRevert(PositionManager.NotOperatorOrOwner.selector);
        managerBase.withdrawFromVault(1 ether);
    }
}
