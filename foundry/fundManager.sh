#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# Manager address: get it from json
DEPLOY_ADDRESS_FILE="broadcast/uniswapContracts/31337/deployedCrossLiquid.json"
MANAGER_ADDRESS=$(jq -r '.manager' < $DEPLOY_ADDRESS_FILE)

# Fund the manager with 1.234 ETH
echo "Funding manager $MANAGER_ADDRESS with 1.234 ETH"
cast send --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --value 1234000000000000000 $MANAGER_ADDRESS
