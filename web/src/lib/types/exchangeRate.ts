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
  1301: { id: 1301, name: "Unichain", color: "#FF007A" },
};
