import fs from "node:fs";
import path from "node:path";

function readFile(name: string) {
  const currentDir = process.cwd();
  return fs.readFileSync(
    path.join(currentDir, "..", "foundry", "broadcast", "uniswapContracts", "31337", name),
    "utf8",
  );
}

export function readUniswapDeployments() {
  // Read the uniswap deployments from the ../foundry/broadcast/uniswapContracts directory
  const deploymentContents = readFile("deployedUniswap.json");
  const deployment = JSON.parse(deploymentContents);
  // File looks like this:
  /*
{
  "weth": "0x0000001234567890000000000000000000000000",
  "mainPoolFee": "0.05%",
  "mainPoolId": "0x3ef023ad24a817bbd09344ec63e52da3d2de9713e1b7e82e4bd7407637415b7b",
  "permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  "poolManager": "0x0D9BAf34817Fccd3b3068768E5d20542B66424A5",
  "positionManager": "0xC687dc2eEA13f99caE59445e7bC71E355F4071BE",
  "testPoolFee": "0.3%",
  "testPoolId": "0x10b70c84751672cc05d94bbe01241052e28fb05cd92fa17677324b936a155e7a",
  "usdc": "0x0165878A594ca255338adfa4d48449f69242Eb8F"
}*/

  return {
    poolManager: deployment.poolManager,
    positionManager: deployment.positionManager,
    usdc: deployment.usdc,
    weth: deployment.weth,
    quoter: deployment.quoter,
    stateView: deployment.stateView,
    v4Router: deployment.swapRouter,
  };
}

export function readOurDeployment() {
  const deploymentContents = readFile("deployedCrossLiquid.json");
  const deployment = JSON.parse(deploymentContents);
  return {
    vault: deployment.vault,
    manager: deployment.manager,
    hook: deployment.hook,
  };
}
