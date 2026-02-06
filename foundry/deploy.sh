#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
pnpm deploy:uniswap:anvil

# Our regular deploy needs poolmanager and usdc so that our hook can be deployed & initialize our pool

export POOL_MANAGER=$(cat broadcast/uniswapContracts/31337/deployedUniswap.json | jq -r '.poolManager')
export USDC_ADDRESS=$(cat broadcast/uniswapContracts/31337/deployedUniswap.json | jq -r '.usdc')

echo "POOL_MANAGER: $POOL_MANAGER"
echo "USDC_ADDRESS: $USDC_ADDRESS"

forge script script/Deploy.s.sol --rpc-url localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast 

