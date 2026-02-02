// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { Test, console } from "forge-std/Test.sol";
import { CrossLiquidVault } from "../src/CrossLiquidVault.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract CrossLiquidVaultTest is Test {
    CrossLiquidVault public vault;
    address public owner;
    address public user1;
    address public user2;
    address public manager;

    uint256 constant CONVERSION_RATE_MULTIPLIER = 1e9;
    uint256 constant FEE_DIVISOR = 100000;

    function setUp() public {
        owner = makeAddr("owner");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        manager = makeAddr("manager");

        // Deploy implementation
        CrossLiquidVault vaultImpl = new CrossLiquidVault();

        // Deploy proxy
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(vaultImpl),
            abi.encodeCall(CrossLiquidVault.initialize, (owner))
        );

        vault = CrossLiquidVault(payable(address(proxy)));

        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);
    }

    function testInitialState() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.name(), "CrossLiquidVault");
        assertEq(vault.symbol(), "CLQ");
        assertEq(vault.conversionRate(), CONVERSION_RATE_MULTIPLIER);
        assertEq(vault.mintFee(), 1000); // 1%
        assertEq(vault.redeemFee(), 1000); // 1%
    }

    function testMintTokens() public {
        uint256 tokensToMint = 10 ether;

        // At 1:1 rate with 1% fee, we need to pay more to account for the fee
        // After fee: amountAfterFee = msg.value * (FEE_DIVISOR - mintFee) / FEE_DIVISOR
        // We want: amountAfterFee = tokensToMint * conversionRate / CONVERSION_RATE_MULTIPLIER = 10 ether
        // So: msg.value * 99000 / 100000 = 10 ether
        // msg.value = 10 ether * 100000 / 99000
        uint256 ethNeeded = (tokensToMint * FEE_DIVISOR) / (FEE_DIVISOR - 1000);

        vm.prank(user1);
        vault.mint{value: ethNeeded}(tokensToMint);

        assertEq(vault.balanceOf(user1), tokensToMint);
        assertEq(address(vault).balance, ethNeeded);
    }

    function testCalcMintPrice() public view {
        uint256 tokensToMint = 10 ether;
        uint256 price = vault.calcMintPrice(tokensToMint);

        // Expected: 10 ether * 100000 / 99000 = ~10.10101... ether
        uint256 expected = (tokensToMint * FEE_DIVISOR) / (FEE_DIVISOR - 1000);
        assertEq(price, expected);
    }

    function testMintWithCalcPrice() public {
        uint256 tokensToMint = 5 ether;
        uint256 price = vault.calcMintPrice(tokensToMint);

        vm.prank(user1);
        vault.mint{value: price}(tokensToMint);

        assertEq(vault.balanceOf(user1), tokensToMint);
    }

    function testRedeemTokens() public {
        // First mint some tokens
        uint256 tokensToMint = 10 ether;
        uint256 mintPrice = vault.calcMintPrice(tokensToMint);

        vm.prank(user1);
        vault.mint{value: mintPrice}(tokensToMint);

        uint256 balanceBefore = user1.balance;
        uint256 tokensToRedeem = 5 ether;

        // Calculate expected payout
        uint256 fee = (tokensToRedeem * 1000) / FEE_DIVISOR;
        uint256 expectedPayout = tokensToRedeem - fee; // 1:1 rate

        vm.prank(user1);
        vault.redeem(tokensToRedeem);

        assertEq(vault.balanceOf(user1), tokensToMint - tokensToRedeem);
        assertEq(user1.balance, balanceBefore + expectedPayout);
    }

    function testRedeemRevertsIfInsufficientBalance() public {
        vm.prank(user1);
        vm.expectRevert();
        vault.redeem(1 ether);
    }

    function testSetConversionRate() public {
        uint256 newRate = 2 * CONVERSION_RATE_MULTIPLIER; // 1 token = 2 ETH

        vm.prank(owner);
        vault.setConversionRate(newRate);

        assertEq(vault.conversionRate(), newRate);
    }

    function testSetConversionRateRevertsForNonOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        vault.setConversionRate(2 * CONVERSION_RATE_MULTIPLIER);
    }

    function testHigherConversionRate() public {
        // Set rate to 2:1 (1 token = 2 ETH)
        vm.prank(owner);
        vault.setConversionRate((1556 * CONVERSION_RATE_MULTIPLIER) / 1000);

        uint256 tokensToMint = 1 ether;
        uint256 price = vault.calcMintPrice(tokensToMint);
        assertEq(price, 1.571717171717171717 ether);

        vm.prank(user1);
        vault.mint{value: price}(tokensToMint);

        assertEq(vault.balanceOf(user1), tokensToMint);
        
        vm.prank(owner);
        vault.setConversionRate(CONVERSION_RATE_MULTIPLIER);
        vm.prank(user1);
        // Mint at 1:1 rate
        tokensToMint = 10 ether;
        uint256 mintPrice = vault.calcMintPrice(tokensToMint);

        vault.mint{value: mintPrice}(tokensToMint);

        // Change rate to 2:1 (tokens more valuable)
        vm.prank(owner);
        vault.setConversionRate(2 * CONVERSION_RATE_MULTIPLIER);

        // Try to redeem - should give 2 ETH per token (minus fee)
        uint256 tokensToRedeem = 1 ether;
        uint256 expectedRawPayout = 2 * tokensToRedeem;
        uint256 fee = (expectedRawPayout * 1000) / FEE_DIVISOR;
        uint256 expectedPayout = expectedRawPayout - fee;

        uint256 balanceBefore = user1.balance;
        vm.prank(user1);

        vault.redeem(tokensToRedeem);
        assertEq(user1.balance, balanceBefore + expectedPayout);
    }

    function testSetFees() public {
        uint256 newMintFee = 2000; // 2%
        uint256 newRedeemFee = 1500; // 1.5%

        vm.prank(owner);
        vault.setFees(newMintFee, newRedeemFee);

        assertEq(vault.mintFee(), newMintFee);
        assertEq(vault.redeemFee(), newRedeemFee);
    }

    function testSetFeesRevertsForNonOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        vault.setFees(2000, 1500);
    }

    function testMintWithDifferentFees() public {
        // Set 2% mint fee
        vm.prank(owner);
        vault.setFees(2000, 1000);

        uint256 tokensToMint = 10 ether;
        uint256 price = vault.calcMintPrice(tokensToMint);

        // Expected: 10 ether * 100000 / 98000 = ~10.204 ether
        uint256 expected = (tokensToMint * FEE_DIVISOR) / (FEE_DIVISOR - 2000);
        assertEq(price, expected);

        vm.prank(user1);
        vault.mint{value: price}(tokensToMint);

        assertEq(vault.balanceOf(user1), tokensToMint);
    }

    function testMultipleUsersMintAndRedeem() public {
        uint256 amount1 = 5 ether;
        uint256 amount2 = 3 ether;

        // User1 mints
        uint256 price1 = vault.calcMintPrice(amount1);
        vm.prank(user1);
        vault.mint{value: price1}(amount1);

        // User2 mints
        uint256 price2 = vault.calcMintPrice(amount2);
        vm.prank(user2);
        vault.mint{value: price2}(amount2);

        assertEq(vault.balanceOf(user1), amount1);
        assertEq(vault.balanceOf(user2), amount2);

        // User1 redeems half
        uint256 balanceBefore = user1.balance;
        uint256 redeemAmount = amount1 / 2;

        vm.prank(user1);
        vault.redeem(redeemAmount);

        assertEq(vault.balanceOf(user1), amount1 - redeemAmount);
        assertGt(user1.balance, balanceBefore);
    }

    function testFuzzMintAndRedeem(uint96 amount) public {
        vm.assume(amount > 0.01 ether && amount < 10 ether);

        uint256 tokensToMint = uint256(amount);
        uint256 price = vault.calcMintPrice(tokensToMint);

        vm.prank(user1);
        vault.mint{value: price}(tokensToMint);

        assertEq(vault.balanceOf(user1), tokensToMint);

        uint256 balanceBefore = user1.balance;

        vm.prank(user1);
        vault.redeem(tokensToMint);

        assertEq(vault.balanceOf(user1), 0);
        assertGt(user1.balance, balanceBefore);
    }

    function testFuzzCalcMintPriceMatchesMint(uint96 amount) public {
        vm.assume(amount > 0.01 ether && amount < 10 ether);

        uint256 tokensToMint = uint256(amount);
        uint256 calculatedPrice = vault.calcMintPrice(tokensToMint);

        vm.prank(user1);
        vault.mint{value: calculatedPrice}(tokensToMint);

        assertEq(vault.balanceOf(user1), tokensToMint);
    }

    // === Manager Tests ===

    function testSetManager() public {
        vm.prank(owner);
        vault.setManager(manager);

        assertEq(vault.manager(), manager);
    }

    function testSetManagerRevertsForNonOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        vault.setManager(manager);
    }

    function testSetManagerEmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit CrossLiquidVault.ManagerUpdated(address(0), manager);
        vault.setManager(manager);
    }

    function testWithdraw() public {
        // Setup: mint some tokens to get ETH in vault
        uint256 tokensToMint = 10 ether;
        uint256 price = vault.calcMintPrice(tokensToMint);
        vm.prank(user1);
        vault.mint{value: price}(tokensToMint);

        // Set manager
        vm.prank(owner);
        vault.setManager(manager);

        // Manager withdraws
        uint256 withdrawAmount = 5 ether;
        address recipient = makeAddr("recipient");
        uint256 balanceBefore = recipient.balance;

        vm.prank(manager);
        vault.withdraw(recipient, withdrawAmount);

        assertEq(recipient.balance, balanceBefore + withdrawAmount);
        assertEq(address(vault).balance, price - withdrawAmount);
    }

    function testWithdrawRevertsForNonManager() public {
        // Setup: mint some tokens
        uint256 tokensToMint = 10 ether;
        uint256 price = vault.calcMintPrice(tokensToMint);
        vm.prank(user1);
        vault.mint{value: price}(tokensToMint);

        // Try to withdraw without being manager
        vm.prank(user1);
        vm.expectRevert("Only manager can withdraw");
        vault.withdraw(user2, 1 ether);
    }

    function testWithdrawRevertsIfInsufficientBalance() public {
        vm.prank(owner);
        vault.setManager(manager);

        vm.prank(manager);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(user1, 1 ether);
    }

    function testWithdrawEmitsEvent() public {
        // Setup
        uint256 price = vault.calcMintPrice(10 ether);
        vm.prank(user1);
        vault.mint{value: price}(10 ether);

        vm.prank(owner);
        vault.setManager(manager);

        // Expect event
        address recipient = makeAddr("recipient");
        vm.prank(manager);
        vm.expectEmit(true, false, false, true);
        emit CrossLiquidVault.FundsWithdrawn(recipient, 1 ether);
        vault.withdraw(recipient, 1 ether);
    }

    function testWithdrawMultipleTimes() public {
        // Setup
        uint256 price = vault.calcMintPrice(20 ether);
        vm.prank(user1);
        vault.mint{value: price}(20 ether);

        vm.prank(owner);
        vault.setManager(manager);

        address recipient = makeAddr("recipient");

        // Multiple withdrawals
        vm.startPrank(manager);
        vault.withdraw(recipient, 5 ether);
        vault.withdraw(recipient, 3 ether);
        vault.withdraw(recipient, 2 ether);
        vm.stopPrank();

        assertEq(recipient.balance, 10 ether);
    }
}
