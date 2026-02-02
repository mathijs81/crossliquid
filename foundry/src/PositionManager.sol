//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { Ownable } from "lib/openzeppelin-contracts/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import { CrossLiquidVault } from "./CrossLiquidVault.sol";

/// PositionManager for CrossLiquid
/// Keeps funds, deploys them to uniswap, bridges funds to other chains.
/// Deployed on all chains with same bytecode. On "parent chain", vault is set. 
/// On other chains, vault is address(0).
contract PositionManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // === State Variables ===

    /// Vault contract (only set on parent chain (Base))
    CrossLiquidVault public immutable vault;
    bool public immutable isVaultChain;

    address public operator;

    event FundsWithdrawnFromVault(uint256 amount);
    event FundsReturnedToVault(uint256 amount);
    event DepositedToUniswap(uint256 amount, bytes32 positionId);
    event WithdrawnFromUniswap(uint256 amount, bytes32 positionId);
    event BridgedToChain(address bridge, uint256 destinationChainId, uint256 amount);
    event ReceivedFromBridge(address sender, uint256 amount);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    // === Errors ===

    error NotVaultChain();
    error NotOperatorOrOwner();
    error InsufficientBalance();
    error TransferFailed();

    // === Modifiers ===

    modifier onlyVaultChain() {
        if (!isVaultChain) revert NotVaultChain();
        _;
    }

    modifier onlyOperatorOrOwner() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperatorOrOwner();
        _;
    }

    // === Constructor ===

    /// @param _vault Address of CrossLiquidVault (only on Base, pass address(0) on other chains)
    /// @param initialOwner Owner address (should be same across all chains)
    constructor(address _vault, address initialOwner) Ownable(initialOwner) {
        vault = CrossLiquidVault(_vault);
        isVaultChain = _vault != address(0);
    }

    // === Vault Interaction Functions ===

    /// Withdraw ETH from the vault to this contract
    /// @param amount Amount of ETH to withdraw
    function withdrawFromVault(uint256 amount) external onlyOwner onlyVaultChain nonReentrant {
        // TODO(mathijs): Implement mechanism to pull from crossliquid vault

        emit FundsWithdrawnFromVault(amount);
    }

    /// @notice Return ETH to the vault
    /// @param amount Amount of ETH to return
    function returnToVault(uint256 amount) external onlyOperatorOrOwner onlyVaultChain nonReentrant {
        if (address(this).balance < amount) revert InsufficientBalance();

        (bool success, ) = payable(address(vault)).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit FundsReturnedToVault(amount);
    }

    // === Uniswap v4 Position Management (All chains) ===

    /// @notice Deploy funds into a Uniswap v4 position
    /// @dev Implementation depends on Uniswap v4 hook and pool setup
    function depositToUniswap(
        address poolManager,
        bytes calldata positionParams
    ) external onlyOperatorOrOwner nonReentrant returns (bytes32 positionId) {
        // TODO(mathijs): Implement Uniswap v4 position creation

        positionId = bytes32(0); // Placeholder

        emit DepositedToUniswap(0, positionId);
    }

    /// @notice Withdraw funds from a Uniswap v4 position
    function withdrawFromUniswap(
        address poolManager,
        bytes32 positionId,
        uint128 liquidityToRemove
    ) external onlyOperatorOrOwner nonReentrant returns (uint256 amount0, uint256 amount1) {
        // TODO(mathijs): Implement Uniswap v4 position withdrawal

        emit WithdrawnFromUniswap(0, positionId);
    }

    // === Bridge Integration (All chains) ===

    /// Bridge funds to another chain via Li.Fi (or other bridge)
    /// @param bridge Address of the bridge contract (Li.Fi diamond)
    /// @param destinationChainId Destination chain ID
    /// @param destinationManager Address of PositionManager on destination chain
    /// @param amount Amount to bridge
    /// @param bridgeCallData Calldata for the bridge (from Li.Fi API)
    /// Note: under the hood this is just a generic call-any-contract function.
    /// Real production use case should have a whitelist so the operator can't
    /// call any contract without approval first from the owner (with e.g. timelock)
    function bridgeToChain(
        address bridge,
        uint256 destinationChainId,
        address destinationManager,
        uint256 amount,
        bytes calldata bridgeCallData
    ) external onlyOperatorOrOwner nonReentrant {
        if (address(this).balance < amount) revert InsufficientBalance();

        (bool success, ) = bridge.call{value: amount}(bridgeCallData);
        if (!success) revert TransferFailed();

        emit BridgedToChain(bridge, destinationChainId, amount);
    }

    /// Bridge funds (ERC20) to another chain via Li.Fi (or other bridge)
    function bridgeTokenToChain(
        address bridge,
        address token,
        uint256 destinationChainId,
        address destinationManager,
        uint256 amount,
        bytes calldata bridgeCallData
    ) external onlyOperatorOrOwner nonReentrant {
        // Approve bridge to spend tokens
        IERC20(token).safeIncreaseAllowance(bridge, amount);

        // Execute the bridge call
        (bool success, ) = bridge.call(bridgeCallData);
        if (!success) revert TransferFailed();

        emit BridgedToChain(bridge, destinationChainId, amount);
    }

    /// Receive funds from bridge or any source
    /// Anyone can send ETH to this contract - operator controls deployment separately
    function receiveFromBridge() external payable {
        emit ReceivedFromBridge(msg.sender, msg.value);
    }

    // === Admin Functions ===

    /// @notice Set the operator address (your off-chain agent)
    function setOperator(address newOperator) external onlyOwner {
        address oldOperator = operator;
        operator = newOperator;
        emit OperatorUpdated(oldOperator, newOperator);
    }

    /// @notice Emergency withdrawal of ETH (only owner)
    function emergencyWithdrawETH(address payable to, uint256 amount) external onlyOwner {
        if (address(this).balance < amount) revert InsufficientBalance();
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /// @notice Emergency withdrawal of ERC20 tokens (only owner)
    function emergencyWithdrawToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // === Receive ETH ===

    receive() external payable {
        // Accept ETH from any source
        emit ReceivedFromBridge(msg.sender, msg.value);
    }
}
