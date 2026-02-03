// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { Test, console } from "forge-std/Test.sol";
import { PositionManager } from "../src/PositionManager.sol";
import { CrossLiquidVault } from "../src/CrossLiquidVault.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

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

        // Deploy vault with proxy
        CrossLiquidVault vaultImpl = new CrossLiquidVault();
        ERC1967Proxy vaultProxy =
            new ERC1967Proxy(address(vaultImpl), abi.encodeCall(CrossLiquidVault.initialize, (owner)));
        vault = CrossLiquidVault(payable(address(vaultProxy)));

        // Deploy manager with proxy
        PositionManager managerImpl = new PositionManager();
        ERC1967Proxy managerProxy = new ERC1967Proxy(
            address(managerImpl), abi.encodeCall(PositionManager.initialize, (payable(address(vault)), owner))
        );
        manager = PositionManager(payable(address(managerProxy)));

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
        vault.mint{ value: price }(10 ether);

        // Operator withdraws from vault
        vm.prank(operator);
        manager.withdrawFromVault(5 ether);
        assertEq(address(manager).balance, 5 ether);

        // Simulate receiving funds from bridge (anyone can send)
        vm.deal(user1, 3 ether);
        vm.prank(user1);
        manager.receiveFromBridge{ value: 3 ether }();
        assertEq(address(manager).balance, 8 ether);

        // Operator can manage Uniswap positions (placeholder calls)
        vm.startPrank(operator);
        PoolKey memory mockKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        // Note: These will fail without actual pool setup, but test signature compatibility
        // manager.depositToUniswap(address(0), mockKey, -887220, 887220, 0, 0, 0, 0);
        // manager.withdrawFromUniswap(address(0), mockKey, -887220, 887220, 0, 0, 0);
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
        vault.mint{ value: price }(10 ether);

        vm.startPrank(owner);
        manager.withdrawFromVault(6 ether);
        // Skip uniswap call for now - requires full setup
        // manager.depositToUniswap(address(0), mockKey, -887220, 887220, 0, 0, 0, 0);
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
        // Deploy child chain manager (no vault)
        PositionManager childManagerImpl = new PositionManager();
        ERC1967Proxy childProxy = new ERC1967Proxy(
            address(childManagerImpl), abi.encodeCall(PositionManager.initialize, (payable(address(0)), owner))
        );
        PositionManager childManager = PositionManager(payable(address(childProxy)));

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
        childManager.receiveFromBridge{ value: 1 ether }();
        assertEq(address(childManager).balance, 11 ether);
    }

    /// Test access control - non-authorized users cannot perform operations
    function testAccessControl() public {
        vm.prank(owner);
        vault.setManager(address(manager));

        uint256 price = vault.calcMintPrice(5 ether);
        vm.prank(user1);
        vault.mint{ value: price }(5 ether);

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
        PoolKey memory mockKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        vm.prank(user1);
        vm.expectRevert(PositionManager.NotOperatorOrOwner.selector);
        manager.depositToUniswap(address(0), mockKey, -887220, 887220, 0, 0, 0, 0);

        vm.prank(user1);
        vm.expectRevert(PositionManager.NotOperatorOrOwner.selector);
        manager.withdrawFromUniswap(address(0), mockKey, -887220, 887220, 0, 0, 0);

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
