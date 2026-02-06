export interface ExchangeRate {
  timestamp: string;
  chainId: number;
  usdcOutput: string;
}

export interface ChainInfo {
  id: number;
  name: string;
  color: string;
}

export const CHAIN_INFO: Record<number, ChainInfo> = {
  1: { id: 1, name: "Ethereum", color: "#627EEA" },
  10: { id: 10, name: "Optimism", color: "#FF0420" },
  8453: { id: 8453, name: "Base", color: "#0052FF" },
  130: { id: 130, name: "Unichain", color: "#FF007A" },
};

export interface PoolPrice {
  timestamp: string;
  chainId: number;
  poolAddress: string;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: string;
  fee: number;
  feeGrowthGlobal0: string;
  feeGrowthGlobal1: string;
}

export function convertSqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
  // sqrtPriceX96 = sqrt(ratio) * 2 ^ 96, so to go back we need to do (X / 2^96) ^ 2
  // ratio is also 10^12 because of the decimals difference between USDC and ETH
  return (Number(sqrtPriceX96) / 2.0 ** 96) ** 2 * 10 ** 12;
}
