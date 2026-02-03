# Uniswap v4 Integration Guide

## Setup Complete ✅

### Dependencies Installed
- **v4-core** (v4.0.0) - Core PoolManager and types
- **v4-periphery** - Helper contracts and libraries
- **Remappings configured** in `foundry/remappings.txt`
- **Solidity version** downgraded to 0.8.26 (required by v4-core)

### Test Infrastructure
- **File**: `foundry/test/PositionManagerUniswap.t.sol`
- **Status**: All tests passing ✅
- **Setup includes**:
  - Local PoolManager deployment
  - Mock ERC20 tokens (USDC, WETH)
  - Initialized v4 pool
  - Integration with CrossLiquid contracts

## Key Learnings

### 1. **No NFTs in v4 Core**
Unlike Uniswap v3, the v4 `PoolManager` does NOT mint NFTs for positions.

**Position Tracking:**
```solidity
// Position identified by hash of:
bytes32 positionId = keccak256(abi.encode(
    poolId,        // Pool identifier
    owner,         // Position owner (your PositionManager)
    tickLower,     // Lower tick bound
    tickUpper,     // Upper tick bound
    salt           // For multiple positions in same range
));
```

**Your PositionManager should:**
- Track positions in a mapping or emit events
- Store: `poolId`, tick range, liquidity amount
- NO need to deal with NFT transfers/approvals

### 2. **v4 Architecture**
```
┌─────────────────────────────────────┐
│     Your PositionManager            │
│  (holds tokens, manages positions)  │
└──────────────┬──────────────────────┘
               │
               │ modifyLiquidity()
               ↓
┌─────────────────────────────────────┐
│      Uniswap v4 PoolManager         │
│  (singleton for ALL pools)          │
└─────────────────────────────────────┘
```

**Key Functions:**
- `initialize(poolKey, sqrtPriceX96)` - Create pool
- `modifyLiquidity(poolKey, params, hookData)` - Add/remove liquidity
- `swap()` - Execute swaps
- `donate()` - Add fees to LPs

**State Access (via StateLibrary):**
```solidity
using StateLibrary for IPoolManager;

(uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) =
    poolManager.getSlot0(poolId);
```

### 3. **Token Flow (Important!)**
v4 uses a unique accounting system via the `lock` pattern:

```solidity
// All pool operations must happen inside unlock callback
poolManager.unlock(abi.encode(operationType, params));

// In your unlock callback:
function unlockCallback(bytes calldata data) external returns (bytes memory) {
    // 1. Call modifyLiquidity / swap / etc

    // 2. Settle debts (tokens you owe)
    poolManager.settle(currency);  // Transfer tokens IN

    // 3. Take credits (tokens you're owed)
    poolManager.take(currency, to, amount);  // Transfer tokens OUT

    return result;
}
```

## Next Steps for Implementation

### Phase 1: Basic Liquidity Management (No Hook)
1. ✅ ~~Install dependencies~~
2. ✅ ~~Create test infrastructure~~
3. **Implement `depositToUniswap()`**:
   - Encode position parameters (tick range, liquidity)
   - Call `poolManager.unlock()` with add liquidity operation
   - In unlock callback: `modifyLiquidity()` with positive delta
   - Settle tokens to PoolManager
   - Store position info
4. **Implement `withdrawFromUniswap()`**:
   - Call `poolManager.unlock()` with remove liquidity operation
   - In unlock callback: `modifyLiquidity()` with negative delta
   - Take tokens from PoolManager
   - Update position info
5. **Add comprehensive tests**

### Phase 2: Hook Integration (Your TODO List)
According to your TODO and README, you want:

- **Dynamic Fee Adjustment**: `beforeSwap()` hook to modify fees based on volatility
- **Toxic Flow Prevention**: Compare swap price vs oracle to block JIT attacks
- **Access Gating**: Only allow liquidity from your PositionManager
- **Event Firing**: Emit events for off-chain agent monitoring

**Hook Requirements:**
- Address must have specific flags (requires address mining)
- Implement `IHooks` interface
- Deploy to correct address prefix
- Integration with oracle (Chainlink or TWAP)

### Phase 3: Multi-Chain Deployment
Once basic integration works on Base:
- Deploy PoolManager + Hook on Optimism, Unichain, Mainnet
- Test cross-chain position management
- Integrate with Li.Fi composer for fund bridging

## Code Examples

### Position Identification Pattern
```solidity
struct Position {
    PoolId poolId;
    int24 tickLower;
    int24 tickUpper;
    uint128 liquidity;
}

mapping(bytes32 => Position) public positions;

function _getPositionId(PoolId poolId, int24 tickLower, int24 tickUpper)
    internal view returns (bytes32)
{
    return keccak256(abi.encode(poolId, address(this), tickLower, tickUpper, bytes32(0)));
}
```

### Full Range Liquidity Helper
```solidity
// For full-range liquidity (simplest approach):
int24 tickLower = -887220;  // Min tick for spacing 60
int24 tickUpper = 887220;   // Max tick for spacing 60

// For concentrated liquidity, calculate ticks based on desired price range
```

## Testing Strategy

### Local Tests (Fast - for CI)
```bash
forge test --match-contract PositionManagerUniswap
```
- Deploy all contracts locally
- Full control over state
- Fast iteration

### Fork Tests (Realistic - for integration)
```bash
forge test --fork-url $BASE_RPC --match-contract PositionManagerFork
```
- Test against real deployed v4 contracts
- Use actual USDC/WETH
- Validate against mainnet conditions

## Resources

- [Uniswap v4 Docs](https://docs.uniswap.org/contracts/v4/overview)
- [v4-core GitHub](https://github.com/Uniswap/v4-core)
- [v4-periphery GitHub](https://github.com/Uniswap/v4-periphery)
- [Hook Examples](https://github.com/Uniswap/v4-periphery/tree/main/test)

## Questions to Decide

1. **Tick Range Strategy**: Full range or concentrated liquidity?
2. **Position Granularity**: One position per pool or multiple ranges?
3. **Liquidity Calculation**: How to determine amounts from ETH/USDC?
4. **Oracle Choice**: Chainlink, Uniswap v3 TWAP, or custom?
5. **Fee Tiers**: Start with 0.3% (3000) or support multiple tiers?
