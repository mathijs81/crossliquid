// Base contract addresses for production uniswap and usdc addresses
// This file is symlinked between agent/ and web/

export interface UniV4Contracts {
  poolManager: `0x${string}`;
  positionManager: `0x${string}`;
  stateView: `0x${string}`;
  quoter: `0x${string}`;
  weth: `0x${string}`;
  usdc: `0x${string}`;
  universalRouter: `0x${string}`;
  v4Router?: `0x${string}`; // IUniswapV4Router04 for local chains
}

// https://docs.uniswap.org/contracts/v4/deployments
export const PROD_UNIV4_CONTRACTS: Record<number, UniV4Contracts> = {
  8453: {
    poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    positionManager: "0x7C5f5A4bBd8fD63184577525326123B519429bDc",
    stateView: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
    quoter: "0x0d5e0F971ED27FBfF6c2837bf31316121532048D",
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    universalRouter: "0x6ff5693b99212da76ad316178a184ab56d299b43",
  },
  10: {
    poolManager: "0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3",
    positionManager: "0x3C3Ea4B57a46241e54610e5f022E5c45859A1017",
    stateView: "0xc18a3169788f4f75a170290584eca6395c75ecdb",
    quoter: "0x1f3131A13296FB91C90870043742C3CDBFF1A8d7",
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    universalRouter: "0x851116d9223fabed8e56c0e6b8ad0c31d98b3507",
  },
  1: {
    poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    positionManager: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
    stateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
    quoter: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
    weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    universalRouter: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
  },
  130: {
    poolManager: "0x1f98400000000000000000000000000000000004",
    positionManager: "0x4529a01c7a0410167c5740c487a8de60232617bf",
    quoter: "0x333e3c607b141b18ff6de9f258db6e77fe7491e0",
    stateView: "0x86e8631a016f9068c3f085faf484ee3f5fdee8f2",
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    universalRouter: "0xef740bf23acae26f6492b10de645d6b98dc8eaf3",
  },
};
