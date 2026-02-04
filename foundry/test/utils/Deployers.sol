// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IPermit2 } from "permit2/src/interfaces/IPermit2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Permit2Deployer } from "hookmate/artifacts/Permit2.sol";
import { V4PoolManagerDeployer } from "hookmate/artifacts/V4PoolManager.sol";
import { V4PositionManagerDeployer } from "hookmate/artifacts/V4PositionManager.sol";
import { AddressConstants } from "hookmate/constants/AddressConstants.sol";
import { V4RouterDeployer } from "hookmate/artifacts/V4Router.sol";
import { IUniswapV4Router04 } from "hookmate/interfaces/router/IUniswapV4Router04.sol";

/**
 * @title Deployers
 * @notice Base contract for deploying Uniswap v4 infrastructure
 * @dev Automatically handles:
 *      - Permit2 deployment (using canonical address + etch on Anvil)
 *      - PoolManager deployment (new on Anvil, canonical on other chains)
 *      - PositionManager deployment (new on Anvil, canonical on other chains)
 */
abstract contract Deployers {
    IPermit2 public permit2;
    IPoolManager public poolManager;
    IPositionManager public positionManager;
    IUniswapV4Router04 public swapRouter;

    MockERC20 public usdc;
    MockERC20 public weth;

    function deployToken(string memory name, string memory symbol, uint8 decimals) internal returns (MockERC20 token) {
        token = new MockERC20(name, symbol, decimals);
        token.mint(address(msg.sender), 10_000_000 ether);

        // token.approve(address(permit2), type(uint256).max);
        // token.approve(address(swapRouter), type(uint256).max);

        // permit2.approve(address(token), address(positionManager), type(uint160).max, type(uint48).max);
        // permit2.approve(address(token), address(poolManager), type(uint160).max, type(uint48).max);
    }

    function deployPermit2() internal {
        address permit2Address = AddressConstants.getPermit2Address();

        if (permit2Address.code.length > 0) {
            // Permit2 already deployed
        } else {
            address deployed = Permit2Deployer.deploy();
            _etch(permit2Address, deployed.code);
        }

        permit2 = IPermit2(permit2Address);
    }

    function deployPoolManager() internal virtual {
        if (block.chainid == 31_337) {
            if (address(0x0D9BAf34817Fccd3b3068768E5d20542B66424A5).code.length > 0) {
                // Already deployed
                poolManager = IPoolManager(address(0x0D9BAf34817Fccd3b3068768E5d20542B66424A5));
                return;
            }
            // Deploy new PoolManager on Anvil
            poolManager = IPoolManager(V4PoolManagerDeployer.deploy(address(0x4444)));
        } else {
            // Use canonical deployment on other chains
            poolManager = IPoolManager(AddressConstants.getPoolManagerAddress(block.chainid));
        }
    }

    function deployPositionManager() internal virtual {
        if (block.chainid == 31_337) {
            // Deploy new PositionManager on Anvil
            positionManager = IPositionManager(
                V4PositionManagerDeployer.deploy(
                    address(poolManager),
                    address(permit2),
                    300_000, // unsubscribeGasLimit
                    address(0), // positionDescriptor (can be 0 for dev)
                    address(weth)
                    //address(0)  // WETH9 (can be 0 for ERC20-only testing)
                )
            );
        } else {
            // Use canonical deployment on other chains
            positionManager = IPositionManager(AddressConstants.getPositionManagerAddress(block.chainid));
        }
    }

    function deployRouter() internal virtual {
        if (block.chainid == 31_337) {
            if (address(0xB61598fa7E856D43384A8fcBBAbF2Aa6aa044FfC).code.length > 0) {
                // Already deployed
                swapRouter = IUniswapV4Router04(payable(address(0xB61598fa7E856D43384A8fcBBAbF2Aa6aa044FfC)));
                return;
            }
            swapRouter = IUniswapV4Router04(payable(V4RouterDeployer.deploy(address(poolManager), address(permit2))));
        } else {
            swapRouter = IUniswapV4Router04(payable(AddressConstants.getV4SwapRouterAddress(block.chainid)));
        }
    }

    function _etch(address, bytes memory) internal virtual {
        revert("Must override _etch in derived contract");
    }

    function deployArtifacts() internal {
        // Order matters - Permit2 must be first
        deployPermit2();

        usdc = deployToken("USD Coin", "USDC", 6);
        weth = deployToken("Wrapped Ether", "WETH", 18);

        deployPoolManager();
        deployPositionManager();
        deployRouter();
    }
}
