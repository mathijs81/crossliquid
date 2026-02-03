// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { Script, console } from "forge-std/Script.sol";
import { PoolManager } from "v4-core/PoolManager.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
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

/**
 * @title DeployUniswapV4
 * @notice Deploys Uniswap v4 infrastructure for local testing
 * @dev Use this for local anvil/development. For production, use real deployed contracts.
 *
 * Usage:
 *   Local anvil deployment:
 *     forge script script/DeployUniswapV4.s.sol --rpc-url localhost --broadcast
 *
 *   With initial liquidity (for testing):
 *     MINT_TOKENS=true forge script script/DeployUniswapV4.s.sol --rpc-url localhost --broadcast
 */
contract DeployUniswapV4 is Script {
    using PoolIdLibrary for PoolKey;

    // Pool configuration
    uint24 constant FEE = 3000; // 0.3%
    int24 constant TICK_SPACING = 60;

    function run() public {
        address deployer = msg.sender;
        bool mintTokens = vm.envOr("MINT_TOKENS", false);

        console.log("=== Uniswap v4 Local Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("Mint test tokens:", mintTokens);
        console.log("");

        vm.startBroadcast();

        // 1. Deploy PoolManager
        IPoolManager poolManager = new PoolManager(deployer);
        console.log("PoolManager deployed:", address(poolManager));

        // 2. Deploy mock tokens
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        console.log("USDC deployed:", address(usdc));
        console.log("WETH deployed:", address(weth));

        // 3. Sort tokens (v4 requires token0 < token1)
        (Currency currency0, Currency currency1) = address(usdc) < address(weth)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(usdc)));

        console.log("Token0 (sorted):", Currency.unwrap(currency0));
        console.log("Token1 (sorted):", Currency.unwrap(currency1));

        // 4. Create and initialize pool (no hook for now)
        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0)) // No hook yet - will add in later phase
        });

        // Initialize at ~1:1 price ratio
        // For USDC (6 decimals) : WETH (18 decimals)
        // At 1 USDC = 0.001 WETH (WETH = $1000):
        // sqrtPriceX96 = sqrt(10^12 / 1000) * 2^96 ≈ 2.505414e+33
        uint160 sqrtPriceX96 = 2505414483750479311864138015696063; // ~1 USDC = 0.001 WETH

        int24 tick = poolManager.initialize(poolKey, sqrtPriceX96);
        PoolId poolId = poolKey.toId();

        console.log("");
        console.log("Pool initialized!");
        console.log("Pool ID:", vm.toString(PoolId.unwrap(poolId)));
        console.log("Initial tick:", vm.toString(tick));
        console.log("Fee tier:", FEE);
        console.log("Tick spacing:", vm.toString(tick));

        // 5. Mint test tokens to deployer if requested
        if (mintTokens) {
            // Mint substantial amounts for testing
            MockERC20(Currency.unwrap(currency0)).mint(deployer, 10_000_000 * 10 ** 6); // 10M USDC
            MockERC20(Currency.unwrap(currency1)).mint(deployer, 10_000 * 10 ** 18); // 10K WETH

            console.log("");
            console.log("Test tokens minted to deployer:");
            console.log("Token0:", 10_000_000, "(adjusted for decimals)");
            console.log("Token1:", 10_000, "(adjusted for decimals)");
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("");
        console.log("Addresses to save:");
        console.log("  PoolManager:", address(poolManager));
        console.log("  USDC:", address(usdc));
        console.log("  WETH:", address(weth));
        console.log("  Token0 (sorted):", Currency.unwrap(currency0));
        console.log("  Token1 (sorted):", Currency.unwrap(currency1));
        console.log("  Pool ID:", vm.toString(PoolId.unwrap(poolId)));
        console.log("");
        console.log("Next steps:");
        console.log("  1. Update deployedContracts.ts with these addresses");
        console.log("  2. Test liquidity operations with PositionManager");
        console.log("  3. Add hook contract in later phase");
        console.log("");
        console.log("To add liquidity for testing:");
        console.log("  - Approve tokens to PoolManager");
        console.log("  - Call PositionManager.depositToUniswap()");
    }
}
