import { defineConfig } from "@wagmi/cli";
import { foundry, actions } from "@wagmi/cli/plugins";
import { readdirSync, readFileSync } from "node:fs";

// TODO: add prod chains
import latestDeploy from "../foundry/broadcast/Deploy.s.sol/31337/run-latest.json";

// Transactions typically have a CREATE with the implementation and then CREATE2 with the proxy.
// So we need to map the contract name of the CREATE to the address of the CREATE2 that comes after.

let lastContractName: string | undefined;
let lastContractAddress: `0x${string}` | undefined;

const deployments: Record<string, Record<number, `0x${string}`>> = {
  "CrossLiquidVault": {},
  "PositionManager": {},
  "VolatilityFeeHook": {},
};

const isProduction = process.env.NODE_ENV === "production";

if (!isProduction) {
  for (const transaction of latestDeploy.transactions) {
    if (transaction.transactionType === "CREATE") {
      if (lastContractName !== undefined) {
        deployments[lastContractName] = {
          // biome-ignore lint/style/noNonNullAssertion: guaranteed set here
          [latestDeploy.chain]: lastContractAddress!,
        };
      }
      lastContractName = transaction.contractName;
      lastContractAddress = transaction.contractAddress as `0x${string}`;
    } else if (
      transaction.transactionType === "CREATE2" &&
      lastContractName !== undefined
    ) {
      deployments[lastContractName] = {
        [latestDeploy.chain]: transaction.contractAddress as `0x${string}`,
      };
      lastContractName = undefined;
      lastContractAddress = undefined;
    }
  }
} else {
  // We also need to iterate ../foundry/broadcast/uniswapContracts/[* that's not 31337] for production contracts
  readdirSync("../foundry/broadcast/uniswapContracts").forEach((chainId) => {
    if (chainId === "31337") return;
    const deployment = JSON.parse(
      readFileSync(
        `../foundry/broadcast/uniswapContracts/${chainId}/deployedCrossLiquid.json`,
        "utf8",
      ),
    );
    // We need to remap the names to the exact contract name
    const nameMap = {
      vault: "CrossLiquidVault",
      manager: "PositionManager",
      hook: "VolatilityFeeHook",
    };
    for (const [key, value] of Object.entries(deployment)) {
      const deploymentMap = deployments[nameMap[key]] ?? {};
      deploymentMap[chainId] = value;
      deployments[nameMap[key]] = deploymentMap;
    }
  });
}

console.log(deployments);

export default defineConfig(() => {
  return {
    out: `src/lib/contracts/generated.${isProduction ? "prod" : "local"}.ts`,
    contracts: [],
    plugins: [
      foundry({
        project: "../foundry",
        deployments,
        include: [
          ...Object.keys(deployments).map(
            (contractName) => `${contractName}.sol/**`,
          ),
        ],

        /*exclude: [
          // Default excludes:
          "Common.sol/**",
          "Components.sol/**",
          "Script.sol/**",
          "StdAssertions.sol/**",
          "StdInvariant.sol/**",
          "StdError.sol/**",
          "StdCheats.sol/**",
          "StdMath.sol/**",
          "StdJson.sol/**",
          "StdStorage.sol/**",
          "StdUtils.sol/**",
          "Vm.sol/**",
          "console.sol/**",
          "console2.sol/**",
          "test.sol/**",
          "**.s.sol/*.json",
          "**.t.sol/*.json",

          // Our excludes:
          "Test.sol/**",
          "IMulticall3.sol/**", 
          "SafeCast.sol/**", 
        ],*/
      }),
      actions(),
    ],
  };
});
