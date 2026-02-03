// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { Test, console } from "forge-std/Test.sol";
import { PositionManager } from "../src/PositionManager.sol";
import { CrossLiquidVault } from "../src/CrossLiquidVault.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Uniswap v4 imports
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolManager } from "v4-core/PoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";

// Mock ERC20
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PositionManagerUniswapTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // CrossLiquid contracts
    PositionManager public manager;
    CrossLiquidVault public vault;
    address public owner;
    address public operator;

    // Uniswap v4 contracts
    IPoolManager public poolManager;
    MockERC20 public token0; // USDC
    MockERC20 public token1; // WETH
    PoolKey public poolKey;
    PoolId public poolId;

    // Test constants
    uint24 constant FEE = 3000; // 0.3%
    int24 constant TICK_SPACING = 60;

    function setUp() public {
        owner = makeAddr("owner");
        operator = makeAddr("operator");

        // 1. Deploy Uniswap v4 PoolManager
        poolManager = new PoolManager(owner);

        // 2. Deploy mock tokens (ensure token0 < token1 address-wise)
        MockERC20 tokenA = new MockERC20("USD Coin", "USDC", 6);
        MockERC20 tokenB = new MockERC20("Wrapped Ether", "WETH", 18);

        // Sort tokens for v4 (token0 must be < token1)
        if (address(tokenA) < address(tokenB)) {
            token0 = tokenA;
            token1 = tokenB;
        } else {
            token0 = tokenB;
            token1 = tokenA;
        }

        console.log("Token0 (should be smaller):", address(token0));
        console.log("Token1:", address(token1));

        // 3. Create pool key (no hook for now)
        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0)) // No hook yet
        });

        poolId = poolKey.toId();

        // 4. Initialize the pool (sets starting price)
        // sqrtPriceX96 = sqrt(price) * 2^96
        // For 1:1 price ratio: sqrt(1) * 2^96 = 2^96
        uint160 sqrtPriceX96 = 79228162514264337593543950336; // ~1:1 price

        vm.prank(owner);
        poolManager.initialize(poolKey, sqrtPriceX96);

        console.log("Pool initialized with ID:");
        console.logBytes32(PoolId.unwrap(poolId));

        // 5. Deploy CrossLiquid contracts
        CrossLiquidVault vaultImpl = new CrossLiquidVault();
        ERC1967Proxy vaultProxy =
            new ERC1967Proxy(address(vaultImpl), abi.encodeCall(CrossLiquidVault.initialize, (owner)));
        vault = CrossLiquidVault(payable(address(vaultProxy)));

        PositionManager managerImpl = new PositionManager();
        ERC1967Proxy managerProxy = new ERC1967Proxy(
            address(managerImpl), abi.encodeCall(PositionManager.initialize, (payable(address(vault)), owner))
        );
        manager = PositionManager(payable(address(managerProxy)));

        vm.prank(owner);
        vault.setManager(address(manager));

        vm.prank(owner);
        manager.setOperator(operator);

        // 6. Mint tokens to manager for testing
        token0.mint(address(manager), 1_000_000 * 10 ** 6); // 1M USDC
        token1.mint(address(manager), 1_000 * 10 ** 18); // 1K WETH
    }

    function testUniswapV4Setup() public view {
        // Verify pool exists
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        assertGt(sqrtPriceX96, 0, "Pool should be initialized");

        // Verify tokens
        assertEq(token0.balanceOf(address(manager)), 1_000_000 * 10 ** 6);
        assertEq(token1.balanceOf(address(manager)), 1_000 * 10 ** 18);

        // Verify pool key
        assertEq(Currency.unwrap(poolKey.currency0), address(token0));
        assertEq(Currency.unwrap(poolKey.currency1), address(token1));
        assertEq(poolKey.fee, FEE);
    }

    /// This shows the PATTERN for how depositToUniswap should work
    /// Not testing the actual implementation yet since it's a TODO
    function testLiquidityAdditionPattern() public {
        // This demonstrates what your PositionManager.depositToUniswap() will need to do:

        // 1. Define tick range for liquidity (full range for simplicity)
        int24 tickLower = -887220; // Min tick for tick spacing 60
        int24 tickUpper = 887220; // Max tick for tick spacing 60

        // 2. Calculate liquidity amount from token amounts
        // For full range, we can add equal value of both tokens
        uint256 amount0Desired = 100_000 * 10 ** 6; // 100k USDC
        uint256 amount1Desired = 50 * 10 ** 18; // 50 WETH

        // 3. Approve PoolManager to spend tokens
        vm.startPrank(address(manager));
        token0.approve(address(poolManager), amount0Desired);
        token1.approve(address(poolManager), amount1Desired);
        vm.stopPrank();

        // 4. Position would be tracked by: keccak256(poolId, owner, tickLower, tickUpper, salt)
        bytes32 positionId = keccak256(abi.encodePacked(poolId, address(manager), tickLower, tickUpper, bytes32(0)));

        console.log("Position ID that would be created:");
        console.logBytes32(positionId);

        // 5. Your PositionManager.depositToUniswap() would call:
        // poolManager.modifyLiquidity(
        //     poolKey,
        //     IPoolManager.ModifyLiquidityParams({
        //         tickLower: tickLower,
        //         tickUpper: tickUpper,
        //         liquidityDelta: int256(liquidity),
        //         salt: bytes32(0)
        //     }),
        //     ZERO_BYTES
        // );

        console.log("This test shows the PATTERN. Implementation next!");
    }

    function testPoolManagerInterface() public view {
        // Show what interfaces are available
        console.log("PoolManager address:", address(poolManager));

        // The key functions your PositionManager will use:
        // - poolManager.modifyLiquidity() - add/remove liquidity
        // - poolManager.getSlot0() - get current price
        // - poolManager.getPosition() - get position state

        // Position in v4 is identified by:
        bytes32 examplePositionId = keccak256(
            abi.encodePacked(
                poolId, // Pool identifier
                address(manager), // Position owner
                int24(-887220), // Tick lower
                int24(887220), // Tick upper
                bytes32(0) // Salt for multiple positions in same range
            )
        );

        console.log("Example position ID structure:");
        console.logBytes32(examplePositionId);
    }
}
