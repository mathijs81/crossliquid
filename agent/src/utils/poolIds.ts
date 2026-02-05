import { encodeAbiParameters, keccak256, type Address } from "viem";
export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export enum FeeTier {
  LOWEST = 100, // 0.01%, tickSpacing 1
  LOW = 500, // 0.05%, tickSpacing 10
  MEDIUM = 3000, // 0.3%, tickSpacing 60
  HIGH = 10000, // 1%, tickSpacing 200
}

const FEE_TIER_TO_TICK_SPACING: Record<FeeTier, number> = {
  [FeeTier.LOWEST]: 1,
  [FeeTier.LOW]: 10,
  [FeeTier.MEDIUM]: 60,
  [FeeTier.HIGH]: 200,
};

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export function createEthUsdcPoolKey(
  usdcAddress: Address,
  feeTier: FeeTier = FeeTier.LOW,
): PoolKey {
  return {
    currency0: ZERO_ADDRESS,
    currency1: usdcAddress,
    fee: feeTier,
    tickSpacing: FEE_TIER_TO_TICK_SPACING[feeTier],
    hooks: ZERO_ADDRESS,
  };
}

export function createPoolId(poolKey: PoolKey): `0x${string}` {
  return keccak256(encodePoolKey(poolKey));
}
export function encodePoolKey(poolKey: PoolKey): `0x${string}` {
  return encodeAbiParameters(
    [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ],
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ],
  );
}
