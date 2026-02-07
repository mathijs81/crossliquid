// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { BeforeSwapDelta } from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { BaseOverrideFee } from "../lib/uniswap-hooks/src/fee/BaseOverrideFee.sol";
import { BaseHookFee } from "../lib/uniswap-hooks/src/fee/BaseHookFee.sol";
import { BaseHook } from "../lib/uniswap-hooks/src/base/BaseHook.sol";

/// @title VolatilityFeeHook
/// @notice Combines two fee mechanisms:
///   1. LP fee override (BaseOverrideFee) — dynamic fee set by the off-chain agent, paid to LPs
///   2. Protocol hook fee (BaseHookFee) — percentage of swap output taken as ERC-6909 claims for the hook owner
contract VolatilityFeeHook is BaseOverrideFee, BaseHookFee, Ownable, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    // All fee units are in hundredths of a bip (ie. a millionth of a unit = 0.0001%)
    uint24 public constant DEFAULT_LP_FEE = 490; // 0.049%
    uint24 public constant INITIAL_MIN_FEE = 50; // 0.005%
    uint24 public constant MAX_FEE_CAP = 1_000_000; // 100% (Uniswap's hard cap)

    uint24 public minFee = INITIAL_MIN_FEE;
    uint24 public maxFee = 10_000; // 1%
    uint24 public protocolFee = 10; // 0.001% of swap output

    address public operator;

    mapping(PoolId => uint24) public targetFees;

    event TargetFeeSet(PoolId indexed poolId, uint24 fee);
    event BoundsUpdated(uint24 minFee, uint24 maxFee);
    event ProtocolFeeUpdated(uint24 feeBps);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    error FeeTooLow(uint24 fee, uint24 minimum);
    error FeeTooHigh(uint24 fee, uint24 maximum);
    error InvalidBounds();
    error NotOperatorOrOwner();

    modifier onlyOperatorOrOwner() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperatorOrOwner();
        _;
    }

    constructor(IPoolManager _poolManager, address _owner) BaseHook(_poolManager) Ownable(_owner) { }

    // --- Diamond inheritance: route each hook to the correct base ---

    function _afterInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
        internal
        override(BaseOverrideFee, BaseHook)
        returns (bytes4)
    {
        return BaseOverrideFee._afterInitialize(sender, key, sqrtPriceX96, tick);
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override(BaseOverrideFee, BaseHook)
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return BaseOverrideFee._beforeSwap(sender, key, params, hookData);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override(BaseHookFee, BaseHook) returns (bytes4, int128) {
        return BaseHookFee._afterSwap(sender, key, params, delta, hookData);
    }

    // --- LP fee (beforeSwap via BaseOverrideFee) ---
    function _getFee(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (uint24)
    {
        uint24 fee = targetFees[key.toId()];
        if (fee == 0) return DEFAULT_LP_FEE;
        return fee;
    }

    // --- Protocol hook fee (afterSwap via BaseHookFee) ---
    function _getHookFee(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        view
        override
        returns (uint24)
    {
        return protocolFee;
    }

    // --- Owner admin functions ---
    function setTargetFee(PoolKey calldata key, uint24 fee) external onlyOperatorOrOwner {
        if (fee < minFee) revert FeeTooLow(fee, minFee);
        if (fee > maxFee) revert FeeTooHigh(fee, maxFee);

        PoolId id = key.toId();
        targetFees[id] = fee;
        emit TargetFeeSet(id, fee);
    }

    function setBounds(uint24 _minFee, uint24 _maxFee) external onlyOwner {
        if (_minFee > _maxFee || _maxFee > MAX_FEE_CAP) revert InvalidBounds();
        minFee = _minFee;
        maxFee = _maxFee;
        emit BoundsUpdated(_minFee, _maxFee);
    }

    function setProtocolFee(uint24 _feeBps) external onlyOwner {
        if (_feeBps > MAX_FEE_CAP) revert FeeTooHigh(_feeBps, uint24(MAX_FEE_CAP));
        protocolFee = _feeBps;
        emit ProtocolFeeUpdated(_feeBps);
    }

    function getTargetFee(PoolKey calldata key) external view returns (uint24) {
        uint24 fee = targetFees[key.toId()];
        return fee == 0 ? DEFAULT_LP_FEE : fee;
    }

    // --- Withdraw accumulated ERC-6909 claims as real tokens ---
    function handleHookFees(Currency[] memory currencies) public override onlyOperatorOrOwner {
        poolManager.unlock(abi.encode(currencies, owner()));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (Currency[] memory currencies, address recipient) = abi.decode(data, (Currency[], address));

        for (uint256 i = 0; i < currencies.length; i++) {
            uint256 balance = poolManager.balanceOf(address(this), currencies[i].toId());
            if (balance > 0) {
                poolManager.burn(address(this), currencies[i].toId(), balance);
                poolManager.take(currencies[i], recipient, balance);
            }
        }
        return "";
    }

    // --- Operator management (owner-only) ---
    function setOperator(address newOperator) external onlyOwner {
        address oldOperator = operator;
        operator = newOperator;
        emit OperatorUpdated(oldOperator, newOperator);
    }

    // --- Merged permissions from BaseOverrideFee + BaseHookFee ---
    function getHookPermissions()
        public
        pure
        override(BaseOverrideFee, BaseHookFee)
        returns (Hooks.Permissions memory)
    {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true, // BaseOverrideFee: validates dynamic fee
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true, // BaseOverrideFee: LP fee override
            afterSwap: true, // BaseHookFee: protocol fee on output
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true, // BaseHookFee: takes output tokens
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }
}
