import { eRC20Abi } from "../abi/ERC20.js";
import { chains, getOurAddressesForChain, QUERY_POOL_KEYS } from "../config.js";
import { UNIV4_CONTRACTS } from "../contracts/contract-addresses.js";
import { getPoolCurrentTick } from "../services/pool.js";
import { createPoolId } from "../utils/poolIds.js";

export interface ManagerBalances {
  ethBalance: bigint;
  usdcBalance: bigint;
  ethPriceUsdc: number;
  ethValueUsdc: number;
  usdcValueUsdc: number;
  totalValueUsdc: number;
}

export function tickToEthPrice(tick: number): number {
  // price = 1.0001^tick gives token1/token0 in raw units (USDC-base / ETH-wei)
  // human price = raw * 10^(18-6) = raw * 10^12
  return 1.0001 ** tick * 1e12;
}

export async function getEthPriceUsdc(chainId: number): Promise<number> {
  const poolKey = QUERY_POOL_KEYS[chainId];
  if (!poolKey) throw new Error(`No query pool key for chain ${chainId}`);
  const poolId = createPoolId(poolKey);
  const tick = await getPoolCurrentTick(chainId, UNIV4_CONTRACTS[chainId].stateView, poolId);
  if (tick === null) throw new Error(`Failed to get current tick for chain ${chainId}`);
  return tickToEthPrice(tick);
}

export async function getManagerBalances(chainId: number): Promise<ManagerBalances> {
  const publicClient = chains.get(chainId)?.publicClient;
  if (!publicClient) throw new Error(`No public client for chain ${chainId}`);

  const managerAddress = getOurAddressesForChain(chainId).manager;
  const usdcAddress = UNIV4_CONTRACTS[chainId].usdc;

  const [ethBalance, usdcBalance, ethPriceUsdc] = await Promise.all([
    publicClient.getBalance({ address: managerAddress }),
    publicClient.readContract({
      address: usdcAddress,
      abi: eRC20Abi,
      functionName: "balanceOf",
      args: [managerAddress],
    }) as Promise<bigint>,
    getEthPriceUsdc(chainId),
  ]);

  const ethValueUsdc = (Number(ethBalance) / 1e18) * ethPriceUsdc;
  const usdcValueUsdc = Number(usdcBalance) / 1e6;

  return {
    ethBalance,
    usdcBalance,
    ethPriceUsdc,
    ethValueUsdc,
    usdcValueUsdc,
    totalValueUsdc: ethValueUsdc + usdcValueUsdc,
  };
}
