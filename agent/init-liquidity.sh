#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "Swapping some ETH for USDC for the manager"
pnpm cli swap --amount 0.5 --token-in eth --token-out usdc --for-manager

echo "Adding liquidity to uniswap pool"
pnpm cli add-liquidity --eth 0.4 --usdc 1000 --max-tick-diff=500
