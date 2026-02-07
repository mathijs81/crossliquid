<script lang="ts">
import { getGlobalClient } from "$lib/query/globalClient";
import type { ExchangeRate, PoolPrice } from "$lib/types/exchangeRate";
import { CHAIN_INFO, convertSqrtPriceX96ToPrice } from "$lib/types/exchangeRate";
import { createQuery } from "@tanstack/svelte-query";
import { groupBy } from "es-toolkit";
import { onMount } from "svelte";
import QueryRenderer from "../QueryRenderer.svelte";
import ChainPriceChart from "./ChainPriceChart.svelte";
import { formatUSD } from "$lib/utils/format";

const poolPricesQuery = createQuery(
  () => ({
    queryKey: ["poolPrices"],
    queryFn: async (): Promise<PoolPrice[]> => {
      const response = await fetch(`/api/pool-prices?limit=360`);
      if (!response.ok) {
        throw new Error("Failed to fetch pool prices");
      }
      return response.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  }),
  getGlobalClient(),
);

interface LOSScore {
  chainId: number;
  chainName: string;
  score: number;
  components: {
    feeYieldRate: number;
    volatility: number;
    gasFactor: number;
  };
  targetAllocation: number;
  lastUpdated: string;
}

interface MetricsResponse {
  timestamp: string;
  chains: Array<{
    chainId: number;
    chainName: string;
    metrics: {
      apr30min: { feeApr: number; liquidityUsd: number } | null;
      apr4hr: { feeApr: number; liquidityUsd: number } | null;
      apr1day: { feeApr: number; liquidityUsd: number } | null;
    };
    los: LOSScore | null;
  }>;
  poolPrices: PoolPrice[];
}

const metricsQuery = createQuery(
  () => ({
    queryKey: ["metrics"],
    queryFn: async (): Promise<MetricsResponse> => {
      const response = await fetch(`/api/metrics?limit=360`);
      if (!response.ok) {
        throw new Error("Failed to fetch metrics");
      }
      return response.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  }),
  getGlobalClient(),
);

interface ChainStats {
  chainId: number;
  name: string;
  color: string;
  latestPrice: number;
  latestPoolPrice: number;
  priceChange: number;
  priceChangePercent: number;
  minPrice: number;
  maxPrice: number;
  lastUpdated: Date;
  //dataPoints: number;
  poolPrices: PoolPrice[];
  feeApr: number | null;
  liquidityUsd: number | null;
  los: LOSScore | null;
  apr30min: number | null;
  apr4hr: number | null;
  apr1day: number | null;
}

// Compute annualized fee APR from feeGrowthGlobal deltas.
// Uses the full-range liquidity approximation: capital per unit L = 2 * sqrt(P) / 10^6 USD.
// This is a fair cross-chain comparison basis (concentrated positions earn proportionally more).
function computeFeeAndLiquidity(poolPrices: PoolPrice[]): { feeApr: number; liquidity: number } | null {
  if (poolPrices.length < 2) return null;

  const sorted = [...poolPrices]
    .filter((p) => p.feeGrowthGlobal0 !== "0" || p.feeGrowthGlobal1 !== "0")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];

  const timeDeltaSeconds = (new Date(newest.timestamp).getTime() - new Date(oldest.timestamp).getTime()) / 1000;
  if (timeDeltaSeconds < 60) return null;

  //console.log(`From ${new Date(oldest.timestamp).toISOString()} to ${new Date(newest.timestamp).toISOString()} -- ${timeDeltaSeconds} seconds`);

  const deltaFee0 = Number(BigInt(newest.feeGrowthGlobal0) - BigInt(oldest.feeGrowthGlobal0)) / 2 ** 128;
  const deltaFee1 = Number(BigInt(newest.feeGrowthGlobal1) - BigInt(oldest.feeGrowthGlobal1)) / 2 ** 128;

  const price = (Number(newest.sqrtPriceX96) / 2 ** 96) ** 2;

  // Fee per unit L in microUSD
  const fee0Usd = deltaFee0 * price;
  const totalFeeUsd = fee0Usd + deltaFee1;

  const liquidity = Number(newest.liquidity);
  // Capital per unit L in USD (full-range: both sides = sqrt(P)/10^6 each)
  const capitalUsd = 2 * Math.sqrt(price);
  //console.log(`liquidity: ${Math.round(liquidity * capitalUsd / 1e6 / 1e3)}K, winning ${totalFeeUsd / 1e6}`);

  if (capitalUsd === 0) return null;

  const secondsPerYear = 365.25 * 24 * 3600;
  return {
    feeApr: (totalFeeUsd / capitalUsd / timeDeltaSeconds) * secondsPerYear,
    liquidity: (liquidity * capitalUsd) / 1e6,
  };
}

function calculateStats(poolPrices: PoolPrice[], metricsData?: MetricsResponse): ChainStats[] {
  if (!poolPrices) {
    return [];
  }
  const groupedPoolPrices = groupBy(poolPrices, (price) => price.chainId);

  const allKeys = new Set(Object.keys(groupedPoolPrices));

  return Array.from(allKeys)
    .map((key) => {
      const chainIdStr = key;
      const chainId = Number(chainIdStr);
      const poolPrices = groupedPoolPrices[chainId] || [];

      const chainInfo = CHAIN_INFO[chainId] || {
        id: chainId,
        name: `Chain ${chainId}`,
        color: "#888888",
      };

      interface Price {
        timestamp: number;
        price: number;
      }
      const prices = poolPrices
        .map(
          (pp) =>
            ({
              timestamp: new Date(pp.timestamp).getTime(),
              price: convertSqrtPriceX96ToPrice(pp.sqrtPriceX96),
            }) as Price,
        )
        .sort((a, b) => b.timestamp - a.timestamp);

      const priceValues = prices.map((x) => x.price);

      const latestPrice = priceValues[0] ?? 0;
      const oldestPrice = priceValues[priceValues.length - 1] ?? 0;
      const minPrice = prices.length > 0 ? Math.min(...priceValues) : 0;
      const maxPrice = prices.length > 0 ? Math.max(...priceValues) : 0;
      const priceChange = latestPrice - oldestPrice;
      const priceChangePercent = oldestPrice !== 0 ? (priceChange / oldestPrice) * 100 : 0;

      const { feeApr, liquidity: liquidityUsd } = computeFeeAndLiquidity(poolPrices) ?? {
        feeApr: null,
        liquidity: null,
      };

      // Get metrics data for this chain if available
      const chainMetrics = metricsData?.chains.find((c) => c.chainId === chainId);
      const los = chainMetrics?.los || null;
      const apr30min = chainMetrics?.metrics.apr30min?.feeApr || null;
      const apr4hr = chainMetrics?.metrics.apr4hr?.feeApr || null;
      const apr1day = chainMetrics?.metrics.apr1day?.feeApr || null;

      return {
        chainId,
        name: chainInfo.name,
        color: chainInfo.color,
        latestPrice,
        latestPoolPrice: poolPrices.length > 0 ? convertSqrtPriceX96ToPrice(poolPrices[0].sqrtPriceX96) : 0,
        poolPrices: poolPrices.reverse(),
        priceChange,
        priceChangePercent,
        minPrice,
        maxPrice,
        lastUpdated: prices.length > 0 ? new Date(prices[0].timestamp) : new Date(),
        feeApr,
        liquidityUsd,
        los,
        apr30min,
        apr4hr,
        apr1day,
      };
    })
    .sort((a, b) => a.chainId - b.chainId);
}

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

function formatPriceChange(change: number, changePercent: number): string {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${changePercent.toFixed(2)}%`;
}

function getPriceChangeColor(change: number): string {
  if (change > 0) return "text-success";
  if (change < 0) return "text-error";
  return "text-base-content";
}

function getLOSColor(score: number): string {
  if (score > 7) return "text-success";
  if (score > 3) return "text-warning";
  return "text-error";
}

function getTargetAllocationColor(allocation: number): string {
  if (allocation > 30) return "text-success";
  if (allocation > 15) return "text-info";
  return "text-base-content/70";
}

let time = $state(Date.now());

onMount(() => {
  const interval = setInterval(() => {
    time = Date.now();
  }, 1000);

  return () => {
    clearInterval(interval);
  };
});

function getTimeSince(date: Date): { display: string; isFresh: boolean } {
  const seconds = Math.floor((time - date.getTime()) / 1000);
  if (seconds < 60) return { display: `${seconds}s ago`, isFresh: true };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { display: `${minutes}m ago`, isFresh: false };
  const hours = Math.floor(minutes / 60);
  return { display: `${hours}h ago`, isFresh: false };
}
</script>

<div class="card bg-base-100 shadow-xl">
  <div class="card-body">
    <h2 class="card-title text-xl">Chain Metrics & Liquidity Opportunity Score</h2>
    <p class="text-sm text-base-content/70">
      Real-time APR, LOS scores, and target allocations for 0.05% ETH/USDC v4 pools across chains
    </p>

    <QueryRenderer query={poolPricesQuery}>
      {#snippet children(data)}
        {@const chainStats = calculateStats(
          data,
          metricsQuery.data as MetricsResponse,
        )}

        {#if chainStats.length === 0}
          <div class="alert alert-info"><span>No exchange rate data available yet</span></div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-zebra">
              <thead>
                <tr>
                  <th>Chain</th>
                  <th class="text-right">Liquidity</th>
                  <th class="text-right">Fee APR</th>
                  <th class="text-right">LOS Score</th>
                  <th class="text-right">Target %</th>
                  <th class="text-right">Latest Price</th>
                  <th class="text-right">Range</th>
                  <th class="text-right">Change</th>
                  <th class="text-center">Trend</th>
                </tr>
              </thead>
              <tbody>
                {#each chainStats as stat}
                  {@const { display, isFresh } = getTimeSince(stat.lastUpdated)}
                  <tr>
                    <td>
                      <div class="flex items-center gap-2">
                        <div class="w-3 h-3 rounded-full" style="background-color: {stat.color}"></div>
                        <div>
                          <span class="font-medium">{stat.name}</span>
                          <br>
                        </div>
                      </div>
                    </td>
                    <td class="text-right font-mono text-lg">
                      {#if stat.liquidityUsd !== null}
                        {formatUSD(stat.liquidityUsd, 0)}
                      {:else}
                        <span class="text-base-content/50">-</span>
                      {/if}
                    </td>

                    <td class="text-right font-mono text-sm">
                      {#if stat.apr30min !== null || stat.apr4hr !== null || stat.apr1day !== null}
                        <div class="flex flex-col items-end gap-0.5">
                          <span
                            class="text-accent font-semibold"
                            title="4hr APR: {((stat.apr4hr ?? 0)*100).toFixed(1)}%, 30min APR: {((stat.apr30min ?? 0)*100).toFixed(1)}%, 1day APR: {((stat.apr1day ?? 0)*100).toFixed(1)}%"
                            >{((stat.apr4hr ?? 0)*100).toFixed(1)}%</span
                          >
                        </div>
                      {:else}
                        <span class="text-base-content/50">-</span>
                      {/if}
                    </td>

                    <td class="text-right font-mono">
                      {#if stat.los !== null}
                        <div class="flex flex-col items-end gap-0.5">
                          <span class="{getLOSColor(stat.los.score)} font-bold text-lg"
                            >{stat.los.score.toFixed(2)}</span
                          >
                        </div>
                      {:else}
                        <span class="text-base-content/50">-</span>
                      {/if}
                    </td>

                    <td class="text-right font-mono">
                      {#if stat.los !== null && stat.los.targetAllocation > 0}
                        <span class="{getTargetAllocationColor(stat.los.targetAllocation)} font-bold text-lg">
                          {stat.los.targetAllocation.toFixed(1)}%
                        </span>
                      {:else}
                        <span class="text-base-content/50">-</span>
                      {/if}
                    </td>

                    <td class="text-right font-mono text-lg">
                      {#if stat.latestPrice > 0}
                        {formatPrice(stat.latestPrice)}
                      {:else}
                        <span class="text-base-content/50">-</span>
                      {/if}
                    </td>
                    <td class="text-right text-sm text-base-content/70">
                      {formatPrice(stat.minPrice)} - {formatPrice(stat.maxPrice)}
                    </td>
                    <td
                      class="text-right font-mono {getPriceChangeColor(
												stat.priceChange,
											)}"
                    >
                      {formatPriceChange(
												stat.priceChange,
												stat.priceChangePercent,
											)}
                    </td>
                    <td>
                      <div class="flex justify-center">
                        <div class="w-[200px] h-[50px]">
                          <ChainPriceChart poolPrices={stat.poolPrices} color={stat.color} />
                        </div>
                      </div>
                    </td>
                    <td class="w-[100px]"><span class="text-xs text-base-content/70">
                      <div
                        class="w-2 h-2 rounded-full inline-block mr-1"
                        class:bg-success={isFresh}
                        class:bg-warning={!isFresh}
                      ></div>
                      {display}
                    </span></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          <!-- Summary Stats -->
          {#snippet statCards()}
            {@const chainsWithLOS = chainStats.filter((s) => s.los !== null)}
            {@const bestChain = chainsWithLOS.length > 0
              ? chainsWithLOS.reduce((best, current) =>
                  (current.los?.score || 0) > (best.los?.score || 0) ? current : best
                )
              : null}

            <div class="stat place-items-center sm:place-items-start">
              <div class="stat-title">Chains</div>
              <div class="stat-value text-2xl text-primary">{chainStats.length}</div>
            </div>

            {#if bestChain}
              <div class="stat place-items-center sm:place-items-start">
                <div class="stat-title">Best Opportunity</div>
                <div class="stat-value text-2xl text-success">{bestChain.name}</div>
                <div class="stat-desc">
                  LOS: {bestChain.los?.score.toFixed(2)} | Target: {bestChain.los?.targetAllocation.toFixed(1)}%
                </div>
              </div>
            {/if}

            <div class="stat place-items-center sm:place-items-start">
              <div class="stat-title">Highest Price</div>
              <div class="stat-value text-2xl text-success">
                {formatPrice(Math.max(...chainStats.map((s) => s.latestPrice)))}
              </div>
              <div class="stat-desc">
                {chainStats.find(
									(s) =>
										s.latestPrice ===
										Math.max(...chainStats.map((s) => s.latestPrice)),
								)?.name}
              </div>
            </div>

            <div class="stat place-items-center sm:place-items-start">
              <div class="stat-title">Price Spread</div>
              <div class="stat-value text-2xl text-info">
                {(
									((Math.max(...chainStats.map((s) => s.latestPrice)) -
										Math.min(...chainStats.map((s) => s.latestPrice))) /
										Math.min(...chainStats.map((s) => s.latestPrice))) *
									100
								).toFixed(2)}
                %
              </div>
              <div class="stat-desc">Arbitrage opportunity</div>
            </div>
          {/snippet}

          <div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200/50 w-full mt-4">
            {@render statCards()}
          </div>
        {/if}
      {/snippet}
    </QueryRenderer>
  </div>
</div>
