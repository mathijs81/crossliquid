#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

contracts=(CrossLiquidVault PositionManager ERC20 StateView IPoolManager IV4Quoter)

for contract in "${contracts[@]}"; do
  if [ ! -f "out/${contract}.sol/${contract}.json" ]; then
    echo "Error: ${contract} artifact not found. Run 'forge build' first."
    exit 1
  fi

  cat > "../agent/src/abi/${contract}.ts" << EOF
import type { Abi } from 'viem'

export const ${contract,}Abi = $(cat "out/${contract}.sol/${contract}.json" | jq .abi) as const satisfies Abi
EOF
done
