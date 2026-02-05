//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;


import { StateView } from "v4-periphery/lens/StateView.sol";
import { V4Quoter } from "v4-periphery/lens/V4Quoter.sol";

contract ForceCompile {
    // Just a contract that will force uniswap contracts that we need to be compiled so we can copy the abis
    StateView stateView;
    V4Quoter v4Quoter;
}