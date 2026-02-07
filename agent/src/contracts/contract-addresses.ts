import type { Address } from "viem";
import { readUniswapDeployments } from "../dev/dev-config.js";
import { ENVIRONMENT } from "../env.js";
import {
  type UniV4Contracts,
  PROD_UNIV4_CONTRACTS,
} from "./base-contract-addresses.js";

export const ZERO_ADDRESS: Address =
  "0x0000000000000000000000000000000000000000";

export const UNIV4_CONTRACTS: Record<number, UniV4Contracts> = {
  ...PROD_UNIV4_CONTRACTS,

  31337: {
    poolManager: ZERO_ADDRESS,
    positionManager: ZERO_ADDRESS,
    stateView: ZERO_ADDRESS,
    quoter: ZERO_ADDRESS,
    weth: ZERO_ADDRESS,
    usdc: ZERO_ADDRESS,
    universalRouter: ZERO_ADDRESS,
    ...(() => {
      if (ENVIRONMENT === "development") {
        return readUniswapDeployments();
      } else return {};
    })(),
  },
};
