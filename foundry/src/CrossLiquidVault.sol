//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { ERC20 } from "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "lib/openzeppelin-contracts/contracts/access/Ownable.sol";

// import { console } from "forge-std/console.sol";

// Mint/retrieve assets for CLQ tokens
// The offchain brain bot will regularly update the conversion rate
// We keep this as a multiplier vs. oracle ETH price
contract CrossLiquidVault is ERC20, Ownable {
    uint256 public constant CONVERSION_RATE_MULTIPLIER = 1e9;
    uint256 public constant FEE_DIVISOR = 100000;

    uint256 public mintFee = 1000; // 1%
    uint256 public redeemFee = 1000; // 1%
    
    // This defines the ratio of ETH-to-tokens. E.g. 2e9 means 1 token = 2 ETH
    // 1-to-1 default
    uint256 public conversionRate = CONVERSION_RATE_MULTIPLIER; 
    
    constructor(address initialOwner) ERC20("CrossLiquidVault", "CLQ") Ownable(initialOwner) {
    }

    function mint(uint256 tokens) payable public {
        uint256 fee = (msg.value * mintFee) / FEE_DIVISOR;
        uint256 valueAfterFee = msg.value - fee;
        require(valueAfterFee > 0, "Value must be greater than 0");
        require(valueAfterFee == (tokens * conversionRate) / CONVERSION_RATE_MULTIPLIER, "Value must be equal to the conversion rate");
        _mint(msg.sender, tokens);
    }

    function redeem(uint256 amount) public {
        // TODO(mathijs): check that we can pay out this amount, e.g. keep track of 
        // accumulated fees?
        _burn(msg.sender, amount);
        uint256 fee = (amount * redeemFee) / FEE_DIVISOR;
        uint256 payout = ((amount - fee) * conversionRate) / CONVERSION_RATE_MULTIPLIER;
        (bool success, ) = payable(msg.sender).call{value: payout}("");                                                    
        require(success, "Transfer failed");   
    }

    function setConversionRate(uint256 newConversionRate) public onlyOwner {
        conversionRate = newConversionRate;
    }

    function setFees(uint256 newMintFee, uint256 newRedeemFee) public onlyOwner {
        mintFee = newMintFee;
        redeemFee = newRedeemFee;
    }

    function calcMintPrice(uint256 tokens) public view returns (uint256) {
        uint256 tokenCost = (tokens * conversionRate) / CONVERSION_RATE_MULTIPLIER;
        // mintPrice - (mintPrice * mintFee / FEE_DIVISOR) = tokenCost
        return tokenCost * FEE_DIVISOR / (FEE_DIVISOR - mintFee);
    }
}