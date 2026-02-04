#!/bin/bash
for contract in CrossLiquidVault PositionManager; do
  if [ ! -f "out/${contract}.sol/${contract}.json" ]; then
    echo "Error: ${contract} artifact not found. Run 'forge build' first."
    exit 1
  fi
  # TODO: fix it here ( needs name change for PositionManager)
  # cat out/${contract}.sol/${contract}.json | jq .abi > ../agent/src/abi/${contract}.json
done


cat out/CrossLiquidVault.sol/CrossLiquidVault.json | jq .abi > ../agent/src/abi/CrossLiquidVault.json
cat out/PositionManager.sol/PositionManager.json | jq .abi > ../agent/src/abi/CrossLiquidPM.json

