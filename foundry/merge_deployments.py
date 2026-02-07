#! /usr/bin/env python3

# Script to copy deployment addresses from foundry to agent/
# web/ is handled by wagmi (both abis and addresses)
# abis to agent/ is handled by copyAbis.sh

import json
import os

deployments = {}

for chainId in os.listdir("broadcast/uniswapContracts"):
    if chainId == "31337":
        continue
    with open(f"broadcast/uniswapContracts/{chainId}/deployedCrossLiquid.json", "r") as f:
        deployments[chainId] = json.load(f)

with open("../agent/src/contracts/deployed.ts", "w") as f:
    f.write("export const deployedContracts = {\n")
    for chainId, deployment in deployments.items():
        f.write(f"  {chainId}: {json.dumps(deployment, indent=2)},\n")
    f.write("}\n")
