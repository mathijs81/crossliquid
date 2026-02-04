//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {
    ERC20PermitUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";

/// Mint/retrieve assets for CLQ tokens
/// The offchain brain bot will regularly update the conversion rate
/// We keep this as a multiplier vs. oracle ETH price
contract CrossLiquidVault is
    Initializable,
    ERC20Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient,
    ERC20PermitUpgradeable
{
    uint256 public constant CONVERSION_RATE_MULTIPLIER = 1e9;
    uint256 public constant FEE_DIVISOR = 100_000;
    uint256 public constant MAX_FEE = 10_000; // 10% maximum fee

    uint256 public mintFee;
    uint256 public redeemFee;
    uint256 public conversionRate;

    /// Manager can withdraw funds for investment (typically the PositionManager)
    address public manager;

    event ManagerUpdated(address indexed oldManager, address indexed newManager);
    event FundsWithdrawn(address indexed to, uint256 amount);
    event FeesUpdated(uint256 oldMintFee, uint256 newMintFee, uint256 oldRedeemFee, uint256 newRedeemFee);
    event ConversionRateUpdated(uint256 oldRate, uint256 newRate);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __ERC20_init("CrossLiquidVault", "CLQ");
        __Ownable_init(initialOwner);
        __ERC20Permit_init("CrossLiquidVault");

        mintFee = 1000; // 1%
        redeemFee = 1000; // 1%
        conversionRate = CONVERSION_RATE_MULTIPLIER; // 1:1 default
    }

    function mint() public payable nonReentrant {
        uint256 fee = (msg.value * mintFee) / FEE_DIVISOR;
        uint256 valueAfterFee = msg.value - fee;
        require(valueAfterFee > 0, "Value must be greater than 0");
        uint256 tokens = valueAfterFee * CONVERSION_RATE_MULTIPLIER / conversionRate;
        _mint(msg.sender, tokens);
    }

    function mint(uint256 tokens) public payable nonReentrant {
        uint256 fee = (msg.value * mintFee) / FEE_DIVISOR;
        uint256 valueAfterFee = msg.value - fee;
        require(valueAfterFee > 0, "Value must be greater than 0");
        require(
            valueAfterFee == (tokens * conversionRate) / CONVERSION_RATE_MULTIPLIER,
            "Value must be equal to the conversion rate"
        );
        _mint(msg.sender, tokens);
    }

    function redeem(uint256 amount) public nonReentrant {
        _burn(msg.sender, amount);
        uint256 fee = (amount * redeemFee) / FEE_DIVISOR;
        uint256 payout = ((amount - fee) * conversionRate) / CONVERSION_RATE_MULTIPLIER;
        (bool success,) = payable(msg.sender).call{ value: payout }("");
        require(success, "Transfer failed");
    }

    function setConversionRate(uint256 newConversionRate) public onlyOwner {
        uint256 oldRate = conversionRate;
        conversionRate = newConversionRate;
        emit ConversionRateUpdated(oldRate, newConversionRate);
    }

    function setFees(uint256 newMintFee, uint256 newRedeemFee) public onlyOwner {
        require(newMintFee <= MAX_FEE, "Mint fee exceeds maximum");
        require(newRedeemFee <= MAX_FEE, "Redeem fee exceeds maximum");

        uint256 oldMintFee = mintFee;
        uint256 oldRedeemFee = redeemFee;
        mintFee = newMintFee;
        redeemFee = newRedeemFee;
        emit FeesUpdated(oldMintFee, newMintFee, oldRedeemFee, newRedeemFee);
    }

    function setManager(address newManager) public onlyOwner {
        address oldManager = manager;
        manager = newManager;
        emit ManagerUpdated(oldManager, newManager);
    }

    /// Withdraw funds for investment purposes (callable by manager, typically PositionManager)
    function withdraw(address to, uint256 amount) public {
        require(msg.sender == manager, "Only manager can withdraw");
        require(address(this).balance >= amount, "Insufficient balance");

        (bool success,) = payable(to).call{ value: amount }("");
        require(success, "Transfer failed");

        emit FundsWithdrawn(to, amount);
    }

    function calcMintPrice(uint256 tokens) public view returns (uint256) {
        uint256 tokenCost = (tokens * conversionRate) / CONVERSION_RATE_MULTIPLIER;
        // mintPrice - (mintPrice * mintFee / FEE_DIVISOR) = tokenCost
        return tokenCost * FEE_DIVISOR / (FEE_DIVISOR - mintFee);
    }

    function calcTokensFromValue(uint256 value) public view returns (uint256) {
        uint256 fee = (value * mintFee) / FEE_DIVISOR;
        uint256 valueAfterFee = value - fee;
        return (valueAfterFee * CONVERSION_RATE_MULTIPLIER) / conversionRate;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner { }

    /// Accept ETH from manager returning funds
    receive() external payable { }

    /// @dev Storage gap for future upgrades
    uint256[50] private __gap;
}
