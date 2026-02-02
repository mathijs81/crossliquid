// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { Test, console } from "forge-std/Test.sol";
import { PositionManager } from "../src/PositionManager.sol";
import { CrossLiquidVault } from "../src/CrossLiquidVault.sol";

contract PositionManagerTest is Test {
    PositionManager public manager;
    CrossLiquidVault public vault;
    address public owner;
    address public operator;
    address public user1;

    function setUp() public {
        owner = makeAddr("owner");
        operator = makeAddr("operator");
        user1 = makeAddr("user1");

        vm.prank(owner);
        vault = new CrossLiquidVault(owner);

        vm.prank(owner);
        manager = new PositionManager(payable(address(vault)), owner);

        vm.deal(user1, 100 ether);
    }

    /// Comprehensive operator workflow: receive funds, manage positions, return to vault
    function testOperatorWorkflow() public {
        // Setup: set manager on vault and operator on manager
        vm.prank(owner);
        vault.setManager(address(manager));

        vm.prank(owner);
        manager.setOperator(operator);
        assertEq(manager.operator(), operator);

        // User deposits to vault
        uint256 price = vault.calcMintPrice(10 ether);
        vm.prank(user1);
        vault.mint{value: price}(10 ether);

        // Operator withdraws from vault
        vm.prank(operator);
        manager.withdrawFromVault(5 ether);
        assertEq(address(manager).balance, 5 ether);

        // Simulate receiving funds from bridge (anyone can send)
        vm.deal(user1, 3 ether);
        vm.prank(user1);
        manager.receiveFromBridge{value: 3 ether}();
        assertEq(address(manager).balance, 8 ether);

        // Operator can manage Uniswap positions (placeholder calls)
        vm.startPrank(operator);
        manager.depositToUniswap(address(0), "");
        manager.withdrawFromUniswap(address(0), bytes32(0), 0);
        vm.stopPrank();

        // Operator returns funds to vault
        vm.prank(operator);
        manager.returnToVault(4 ether);
        assertEq(address(manager).balance, 4 ether);
        assertGt(address(vault).balance, price - 5 ether);
    }

    /// Comprehensive owner workflow: emergency controls and admin functions
    function testOwnerWorkflow() public {
        // Owner sets up contracts
        vm.startPrank(owner);
        vault.setManager(address(manager));
        manager.setOperator(operator);

        // Owner can do everything operator can
        uint256 price = vault.calcMintPrice(10 ether);
        vm.stopPrank();

        vm.prank(user1);
        vault.mint{value: price}(10 ether);

        vm.startPrank(owner);
        manager.withdrawFromVault(6 ether);
        manager.depositToUniswap(address(0), "");
        manager.returnToVault(2 ether);

        // Emergency withdrawal
        address safe = makeAddr("safe");
        manager.emergencyWithdrawETH(payable(safe), 4 ether);
        assertEq(safe.balance, 4 ether);
        assertEq(address(manager).balance, 0);

        // Change operator
        address newOperator = makeAddr("newOperator");
        manager.setOperator(newOperator);
        assertEq(manager.operator(), newOperator);
        vm.stopPrank();
    }

    /// Test child chain deployment and restrictions
    function testChildChainRestrictions() public {
        vm.prank(owner);
        PositionManager childManager = new PositionManager(payable(address(0)), owner);

        assertEq(address(childManager.vault()), address(0));
        assertEq(childManager.isVaultChain(), false);

        // Cannot withdraw from vault on child chain
        vm.prank(owner);
        vm.expectRevert(PositionManager.NotVaultChain.selector);
        childManager.withdrawFromVault(1 ether);

        // Cannot return to vault on child chain
        vm.deal(address(childManager), 10 ether);
        vm.prank(owner);
        vm.expectRevert(PositionManager.NotVaultChain.selector);
        childManager.returnToVault(1 ether);

        // Can receive funds and manage Uniswap on child chain
        vm.prank(user1);
        childManager.receiveFromBridge{value: 1 ether}();
        assertEq(address(childManager).balance, 11 ether);
    }

    /// Test access control - non-authorized users cannot perform operations
    function testAccessControl() public {
        vm.prank(owner);
        vault.setManager(address(manager));

        uint256 price = vault.calcMintPrice(5 ether);
        vm.prank(user1);
        vault.mint{value: price}(5 ether);

        // Random user cannot withdraw from vault
        vm.prank(user1);
        vm.expectRevert(PositionManager.NotOperatorOrOwner.selector);
        manager.withdrawFromVault(1 ether);

        // Random user cannot return to vault
        vm.deal(address(manager), 10 ether);
        vm.prank(user1);
        vm.expectRevert(PositionManager.NotOperatorOrOwner.selector);
        manager.returnToVault(1 ether);

        // Random user cannot bridge
        vm.prank(user1);
        vm.expectRevert(PositionManager.NotOperatorOrOwner.selector);
        manager.bridgeToChain(address(0), 10, address(manager), 1 ether, "");

        // Random user cannot manage Uniswap
        vm.prank(user1);
        vm.expectRevert(PositionManager.NotOperatorOrOwner.selector);
        manager.depositToUniswap(address(0), "");

        vm.prank(user1);
        vm.expectRevert(PositionManager.NotOperatorOrOwner.selector);
        manager.withdrawFromUniswap(address(0), bytes32(0), 0);

        // Random user cannot set operator
        vm.prank(user1);
        vm.expectRevert();
        manager.setOperator(user1);

        // Random user cannot emergency withdraw
        vm.prank(user1);
        vm.expectRevert();
        manager.emergencyWithdrawETH(payable(user1), 1 ether);
    }

    /// Test balance checks and reverts
    function testBalanceChecks() public {
        vm.prank(owner);
        vault.setManager(address(manager));

        // Cannot return more than balance
        vm.deal(address(manager), 1 ether);
        vm.prank(owner);
        vm.expectRevert(PositionManager.InsufficientBalance.selector);
        manager.returnToVault(2 ether);

        // Cannot bridge more than balance
        vm.prank(owner);
        vm.expectRevert(PositionManager.InsufficientBalance.selector);
        manager.bridgeToChain(address(0), 10, address(manager), 2 ether, "");

        // Cannot emergency withdraw more than balance
        vm.prank(owner);
        vm.expectRevert(PositionManager.InsufficientBalance.selector);
        manager.emergencyWithdrawETH(payable(owner), 2 ether);
    }
}
