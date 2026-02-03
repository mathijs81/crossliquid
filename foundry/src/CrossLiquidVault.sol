//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// Mint/retrieve assets for CLQ tokens
/// The offchain brain bot will regularly update the conversion rate
/// We keep this as a multiplier vs. oracle ETH price
contract CrossLiquidVault is Initializable, ERC20Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    uint256 public constant CONVERSION_RATE_MULTIPLIER = 1e9;
    uint256 public constant FEE_DIVISOR = 100_000;

    uint256 public mintFee;
    uint256 public redeemFee;
    uint256 public conversionRate;

    /// Manager can withdraw funds for investment (typically the PositionManager)
    address public manager;

    event ManagerUpdated(address indexed oldManager, address indexed newManager);
    event FundsWithdrawn(address indexed to, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __ERC20_init("CrossLiquidVault", "CLQ");
        __Ownable_init(initialOwner);

        mintFee = 1000; // 1%
        redeemFee = 1000; // 1%
        conversionRate = CONVERSION_RATE_MULTIPLIER; // 1:1 default
    }

    function mint(uint256 tokens) public payable {
        uint256 fee = (msg.value * mintFee) / FEE_DIVISOR;
        uint256 valueAfterFee = msg.value - fee;
        require(valueAfterFee > 0, "Value must be greater than 0");
        require(
            valueAfterFee == (tokens * conversionRate) / CONVERSION_RATE_MULTIPLIER,
            "Value must be equal to the conversion rate"
        );
        _mint(msg.sender, tokens);
    }

    function redeem(uint256 amount) public {
        _burn(msg.sender, amount);
        uint256 fee = (amount * redeemFee) / FEE_DIVISOR;
        uint256 payout = ((amount - fee) * conversionRate) / CONVERSION_RATE_MULTIPLIER;
        (bool success,) = payable(msg.sender).call{ value: payout }("");
        require(success, "Transfer failed");
    }

    function setConversionRate(uint256 newConversionRate) public onlyOwner {
        conversionRate = newConversionRate;
    }

    function setFees(uint256 newMintFee, uint256 newRedeemFee) public onlyOwner {
        mintFee = newMintFee;
        redeemFee = newRedeemFee;
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

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner { }

    /// Accept ETH from manager returning funds
    receive() external payable { }

    /// @dev Storage gap for future upgrades
    uint256[50] private __gap;
}
