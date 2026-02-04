//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { CrossLiquidVault } from "./CrossLiquidVault.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "v4-core/interfaces/callback/IUnlockCallback.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency, CurrencyLibrary } from "v4-core/types/Currency.sol";
import { BalanceDelta } from "v4-core/types/BalanceDelta.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { UniswapUtil } from "./UniswapUtil.sol";
import { ModifyLiquidityParams } from "v4-core/types/PoolOperation.sol";

/// PositionManager for CrossLiquid
/// Keeps funds, deploys them to uniswap, bridges funds to other chains.
/// Deployed on all chains with same bytecode. On "parent chain", vault is set.
/// On other chains, vault is address(0).
contract PositionManager is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardTransient,
    UUPSUpgradeable,
    IUnlockCallback
{
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // === State Variables ===

    /// Vault contract (only set on parent chain (Base))
    CrossLiquidVault public vault;
    bool public isVaultChain;

    address public operator;

    struct Position {
        address poolManager;
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 amount0;
        uint256 amount1;
        uint256 timestamp;
    }

    mapping(bytes32 => Position) public positions;
    bytes32[] public positionIds;

    event FundsWithdrawnFromVault(uint256 amount);
    event FundsReturnedToVault(uint256 amount);
    event DepositedToUniswap(
        bytes32 indexed positionId,
        address indexed poolManager,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );
    event WithdrawnFromUniswap(bytes32 indexed positionId, uint128 liquidityRemoved, uint256 amount0, uint256 amount1);
    event BridgedToChain(address bridge, uint256 destinationChainId, uint256 amount);
    event ReceivedFromBridge(address sender, uint256 amount);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    // === Errors ===

    error NotVaultChain();
    error NotOperatorOrOwner();
    error InsufficientBalance();
    error TransferFailed();
    error InvalidCaller();
    error SlippageExceeded();
    error InvalidAction();
    error PositionNotFound();
    error PositionAlreadyExists();

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param _vault Address of CrossLiquidVault (only on Base, pass address(0) on other chains)
    /// @param initialOwner Owner address (should be same across all chains)
    function initialize(address payable _vault, address initialOwner) public initializer {
        __Ownable_init(initialOwner);

        vault = CrossLiquidVault(_vault);
        isVaultChain = _vault != address(0);
    }

    // === Vault Interaction Functions ===

    /// Withdraw ETH from the vault to this contract
    /// @param amount Amount of ETH to withdraw
    function withdrawFromVault(uint256 amount) external onlyOperatorOrOwner onlyVaultChain nonReentrant {
        vault.withdraw(address(this), amount);
        emit FundsWithdrawnFromVault(amount);
    }

    /// @notice Return ETH to the vault
    /// @param amount Amount of ETH to return
    function returnToVault(uint256 amount) external onlyOperatorOrOwner onlyVaultChain nonReentrant {
        if (address(this).balance < amount) revert InsufficientBalance();

        (bool success,) = payable(address(vault)).call{ value: amount }("");
        if (!success) revert TransferFailed();

        emit FundsReturnedToVault(amount);
    }

    // === Uniswap v4 Position Management (All chains) ===

    enum CallbackAction {
        ADD_LIQUIDITY,
        REMOVE_LIQUIDITY
    }

    struct AddLiquidityCallbackData {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
    }

    struct RemoveLiquidityCallbackData {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bytes32 salt;
    }

    struct CallbackData {
        CallbackAction action;
        bytes data;
    }

    function depositToUniswap(
        address poolManagerAddress,
        PoolKey calldata poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min
    ) external onlyOperatorOrOwner nonReentrant returns (uint128 liquidityAdded, uint256 amount0, uint256 amount1) {
        IERC20(Currency.unwrap(poolKey.currency0)).safeIncreaseAllowance(poolManagerAddress, amount0Desired);
        IERC20(Currency.unwrap(poolKey.currency1)).safeIncreaseAllowance(poolManagerAddress, amount1Desired);

        (liquidityAdded, amount0, amount1) =
            _addLiquidityToPool(poolManagerAddress, poolKey, tickLower, tickUpper, amount0Desired, amount1Desired);

        if (amount0 < amount0Min || amount1 < amount1Min) revert SlippageExceeded();

        _storePosition(poolManagerAddress, poolKey, tickLower, tickUpper, liquidityAdded, amount0, amount1);
    }

    function _addLiquidityToPool(
        address poolManagerAddress,
        PoolKey calldata poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) internal returns (uint128 liquidityAdded, uint256 amount0, uint256 amount1) {
        CallbackData memory cbData = CallbackData({
            action: CallbackAction.ADD_LIQUIDITY,
            data: abi.encode(
                AddLiquidityCallbackData({
                    key: poolKey,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired
                })
            )
        });

        bytes memory result = IPoolManager(poolManagerAddress).unlock(abi.encode(cbData));
        (liquidityAdded, amount0, amount1) = abi.decode(result, (uint128, uint256, uint256));
    }

    function _storePosition(
        address poolManagerAddress,
        PoolKey calldata poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidityAdded,
        uint256 amount0,
        uint256 amount1
    ) internal {
        bytes32 positionId = keccak256(
            abi.encodePacked(poolKey.toId(), address(this), tickLower, tickUpper, bytes32(0))
        );

        if (positions[positionId].timestamp == 0) {
            positions[positionId] = Position({
                poolManager: poolManagerAddress,
                poolKey: poolKey,
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidity: liquidityAdded,
                amount0: amount0,
                amount1: amount1,
                timestamp: block.timestamp
            });
            positionIds.push(positionId);
        } else {
            positions[positionId].liquidity += liquidityAdded;
            positions[positionId].amount0 += amount0;
            positions[positionId].amount1 += amount1;
        }

        emit DepositedToUniswap(positionId, poolManagerAddress, tickLower, tickUpper, liquidityAdded, amount0, amount1);
    }

    function withdrawFromUniswap(
        address poolManagerAddress,
        PoolKey calldata poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min
    ) external onlyOperatorOrOwner nonReentrant returns (uint256 amount0, uint256 amount1) {
        bytes32 positionId = keccak256(
            abi.encodePacked(poolKey.toId(), address(this), tickLower, tickUpper, bytes32(0))
        );

        if (positions[positionId].timestamp == 0) revert PositionNotFound();

        IPoolManager poolManager = IPoolManager(poolManagerAddress);

        CallbackData memory cbData = CallbackData({
            action: CallbackAction.REMOVE_LIQUIDITY,
            data: abi.encode(
                RemoveLiquidityCallbackData({
                    key: poolKey, tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity, salt: bytes32(0)
                })
            )
        });

        bytes memory result = poolManager.unlock(abi.encode(cbData));
        (amount0, amount1) = abi.decode(result, (uint256, uint256));

        if (amount0 < amount0Min || amount1 < amount1Min) revert SlippageExceeded();

        if (positions[positionId].liquidity >= liquidity) {
            positions[positionId].liquidity -= liquidity;
            if (positions[positionId].liquidity == 0) {
                _removePosition(positionId);
            }
        }

        emit WithdrawnFromUniswap(positionId, liquidity, amount0, amount1);
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender.code.length == 0) revert InvalidCaller();

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        if (data.action == CallbackAction.ADD_LIQUIDITY) {
            return _handleAddLiquidity(IPoolManager(msg.sender), data.data);
        } else if (data.action == CallbackAction.REMOVE_LIQUIDITY) {
            return _handleRemoveLiquidity(IPoolManager(msg.sender), data.data);
        } else {
            revert InvalidAction();
        }
    }

    function _handleAddLiquidity(IPoolManager poolManager, bytes memory data) internal returns (bytes memory) {
        AddLiquidityCallbackData memory addData = abi.decode(data, (AddLiquidityCallbackData));

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(addData.key.toId());

        uint128 liquidity = UniswapUtil.getLiquidityForAmounts(
            sqrtPriceX96, addData.tickLower, addData.tickUpper, addData.amount0Desired, addData.amount1Desired
        );

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            addData.key,
            ModifyLiquidityParams({
                tickLower: addData.tickLower,
                tickUpper: addData.tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );

        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();

        uint256 amount0Used = 0;
        uint256 amount1Used = 0;

        if (delta0 < 0) {
            amount0Used = uint128(-delta0);
            _settle(poolManager, addData.key.currency0, amount0Used);
        }
        if (delta1 < 0) {
            amount1Used = uint128(-delta1);
            _settle(poolManager, addData.key.currency1, amount1Used);
        }

        return abi.encode(liquidity, amount0Used, amount1Used);
    }

    function _handleRemoveLiquidity(IPoolManager poolManager, bytes memory data) internal returns (bytes memory) {
        RemoveLiquidityCallbackData memory removeData = abi.decode(data, (RemoveLiquidityCallbackData));

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            removeData.key,
            ModifyLiquidityParams({
                tickLower: removeData.tickLower,
                tickUpper: removeData.tickUpper,
                liquidityDelta: -int256(uint256(removeData.liquidity)),
                salt: removeData.salt
            }),
            ""
        );

        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();

        uint256 amount0Received = 0;
        uint256 amount1Received = 0;

        if (delta0 > 0) {
            amount0Received = uint128(delta0);
            poolManager.take(removeData.key.currency0, address(this), amount0Received);
        }
        if (delta1 > 0) {
            amount1Received = uint128(delta1);
            poolManager.take(removeData.key.currency1, address(this), amount1Received);
        }

        return abi.encode(amount0Received, amount1Received);
    }

    function _settle(IPoolManager poolManager, Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    function _removePosition(bytes32 positionId) internal {
        delete positions[positionId];

        for (uint256 i = 0; i < positionIds.length; i++) {
            if (positionIds[i] == positionId) {
                positionIds[i] = positionIds[positionIds.length - 1];
                positionIds.pop();
                break;
            }
        }
    }

    // === View Functions ===

    function getPositionCount() external view returns (uint256) {
        return positionIds.length;
    }

    function getAllPositionIds() external view returns (bytes32[] memory) {
        return positionIds;
    }

    function getPosition(bytes32 positionId) external view returns (Position memory) {
        if (positions[positionId].timestamp == 0) revert PositionNotFound();
        return positions[positionId];
    }

    function getPositionWithPoolState(bytes32 positionId)
        external
        view
        returns (Position memory position, int24 currentTick, uint160 sqrtPriceX96, bool inRange)
    {
        if (positions[positionId].timestamp == 0) revert PositionNotFound();
        position = positions[positionId];

        IPoolManager poolManager = IPoolManager(position.poolManager);
        PoolId poolId = position.poolKey.toId();

        (sqrtPriceX96, currentTick,,) = poolManager.getSlot0(poolId);
        inRange = currentTick >= position.tickLower && currentTick < position.tickUpper;
    }

    function getAllPositionsWithPoolState()
        external
        view
        returns (
            bytes32[] memory ids,
            Position[] memory positionList,
            int24[] memory currentTicks,
            bool[] memory inRangeList
        )
    {
        uint256 count = positionIds.length;
        ids = new bytes32[](count);
        positionList = new Position[](count);
        currentTicks = new int24[](count);
        inRangeList = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            bytes32 positionId = positionIds[i];
            Position memory position = positions[positionId];

            IPoolManager poolManager = IPoolManager(position.poolManager);
            PoolId poolId = position.poolKey.toId();
            (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(poolId);

            ids[i] = positionId;
            positionList[i] = position;
            currentTicks[i] = currentTick;
            inRangeList[i] = currentTick >= position.tickLower && currentTick < position.tickUpper;
        }
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

        (bool success,) = bridge.call{ value: amount }(bridgeCallData);
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
        (bool success,) = bridge.call(bridgeCallData);
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
        (bool success,) = to.call{ value: amount }("");
        if (!success) revert TransferFailed();
    }

    /// @notice Emergency withdrawal of ERC20 tokens (only owner)
    function emergencyWithdrawToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner { }

    // === Receive ETH ===

    receive() external payable {
        // Accept ETH from any source
        emit ReceivedFromBridge(msg.sender, msg.value);
    }

    /// @dev Storage gap for future upgrades
    uint256[50] private __gap;
}
