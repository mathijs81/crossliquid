<script lang="ts">
import { getGlobalClient } from "$lib/query/globalClient";
import type { ExchangeRate, PoolPrice } from "$lib/types/exchangeRate";
import {
  CHAIN_INFO,
  convertSqrtPriceX96ToPrice,
} from "$lib/types/exchangeRate";
import { createQuery } from "@tanstack/svelte-query";
import { groupBy } from "es-toolkit";
import { onMount } from "svelte";
import QueryRenderer from "../QueryRenderer.svelte";
import ChainPriceChart from "./ChainPriceChart.svelte";
import { formatUSD } from "$lib/utils/format";

const ratesQuery = createQuery(
  () => ({
    queryKey: ["exchangeRates"],
    queryFn: async (): Promise<ExchangeRate[]> => {
      const response = await fetch(`/api/rates?limit=360`);
      if (!response.ok) {
        throw new Error("Failed to fetch exchange rates");
      }
      return response.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  }),
  getGlobalClient(),
);

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

interface ChainStats {
  chainId: number;
  name: string;
  color: string;
  latestPrice: number;
  latestPoolPrice: number;
  data: ExchangeRate[];
  priceChange: number;
  priceChangePercent: number;
  minPrice: number;
  maxPrice: number;
  lastUpdated: Date;
  dataPoints: number;
  poolPrices: PoolPrice[];
  feeApr: number | null;
  liquidityUsd: number | null;
}

// Compute annualized fee APR from feeGrowthGlobal deltas.
// Uses the full-range liquidity approximation: capital per unit L = 2 * sqrt(P) / 10^6 USD.
// This is a fair cross-chain comparison basis (concentrated positions earn proportionally more).
function computeFeeAndLiquidity(
  poolPrices: PoolPrice[],
): { feeApr: number; liquidity: number } | null {
  if (poolPrices.length < 2) return null;

  const sorted = [...poolPrices]
    .filter((p) => p.feeGrowthGlobal0 !== "0" && p.feeGrowthGlobal1 !== "0")
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];

  const timeDeltaSeconds =
    (new Date(newest.timestamp).getTime() -
      new Date(oldest.timestamp).getTime()) /
    1000;
  if (timeDeltaSeconds < 60) return null;

  //console.log(`From ${new Date(oldest.timestamp).toISOString()} to ${new Date(newest.timestamp).toISOString()} -- ${timeDeltaSeconds} seconds`);

  const deltaFee0 =
    Number(BigInt(newest.feeGrowthGlobal0) - BigInt(oldest.feeGrowthGlobal0)) /
    2 ** 128;
  const deltaFee1 =
    Number(BigInt(newest.feeGrowthGlobal1) - BigInt(oldest.feeGrowthGlobal1)) /
    2 ** 128;
  if (deltaFee0 === 0 && deltaFee1 === 0) return null;

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

function calculateStats(
  data: ExchangeRate[],
  poolPrices: PoolPrice[],
): ChainStats[] {
  if (!data || !poolPrices) {
    return [];
  }
  const grouped = groupBy(data, (rate) => rate.chainId);
  const groupedPoolPrices = groupBy(poolPrices, (price) => price.chainId);

  const allKeys = new Set([
    ...Object.keys(grouped),
    ...Object.keys(groupedPoolPrices),
  ]);

  return Array.from(allKeys)
    .map((key) => {
      const chainIdStr = key;
      const chainId = Number(chainIdStr);
      const poolPrices = groupedPoolPrices[chainId] || [];
      const rates = grouped[chainId] || [];

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

      const sortedRates = rates.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      const priceValues = prices.map((x) => x.price);

      //   const latestRate = sortedRates[0];
      //   const oldestRate = sortedRates[sortedRates.length - 1];

      const latestPrice = priceValues[0] ?? 0;
      const oldestPrice = priceValues[priceValues.length - 1] ?? 0;
      const minPrice = prices.length > 0 ? Math.min(...priceValues) : 0;
      const maxPrice = prices.length > 0 ? Math.max(...priceValues) : 0;
      const priceChange = latestPrice - oldestPrice;
      const priceChangePercent =
        oldestPrice !== 0 ? (priceChange / oldestPrice) * 100 : 0;

      const { feeApr, liquidity: liquidityUsd } = computeFeeAndLiquidity(
        poolPrices,
      ) ?? { feeApr: null, liquidity: null };

      return {
        chainId,
        name: chainInfo.name,
        color: chainInfo.color,
        latestPrice,
        latestPoolPrice:
          poolPrices.length > 0
            ? convertSqrtPriceX96ToPrice(poolPrices[0].sqrtPriceX96)
            : 0,
        data: sortedRates.reverse(), // Reverse for chronological order
        poolPrices: poolPrices.reverse(),
        priceChange,
        priceChangePercent,
        minPrice,
        maxPrice,
        lastUpdated:
          prices.length > 0 ? new Date(prices[0].timestamp) : new Date(),
        dataPoints: rates.length,
        feeApr,
        liquidityUsd,
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
		<h2 class="card-title text-xl">Chain Prices & Volatility</h2>
		<p class="text-sm text-base-content/70">
			ETH/USDC prices across chains (status of 0.05% ETH/USDC v4 pools)
		</p>

		<QueryRenderer query={ratesQuery}>
			{#snippet children(data)}
				{@const chainStats = calculateStats(data as ExchangeRate[], poolPricesQuery.data as PoolPrice[])}

				{#if chainStats.length === 0}
					<div class="alert alert-info">
						<span>No exchange rate data available yet</span>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="table table-zebra">
							<thead>
								<tr>
									<th>Chain</th>
									<th class="text-right">Liquidity</th>
									<th class="text-right">Fee APR</th>
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
												<div
													class="w-3 h-3 rounded-full"
													style="background-color: {stat.color}"
												></div>
                        <div>
												  <span class="font-medium">{stat.name}</span><br/>
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
											{#if stat.feeApr !== null}
												<span class="text-accent">{(stat.feeApr * 100).toFixed(2)}%</span>
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
													<ChainPriceChart
														data={stat.data}
														poolPrices={stat.poolPrices}
														color={stat.color}
													/>
												</div>
											</div>
										</td>
                    <td>
                      
                      <span class="text-xs text-base-content/70">
                        <div
													class="w-2 h-2 rounded-full inline-block mr-1"
													class:bg-success={isFresh}
													class:bg-warning={!isFresh}
												></div>
                        {display} 
                        </span>
                    </td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<!-- Summary Stats -->
					<div
						class="stats stats-vertical sm:stats-horizontal shadow bg-base-200/50 w-full mt-4"
					>
						<div class="stat place-items-center sm:place-items-start">
							<div class="stat-title">Chains</div>
							<div class="stat-value text-2xl text-primary">
								{chainStats.length}
							</div>
						</div>
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
							<div class="stat-title">Lowest Price</div>
							<div class="stat-value text-2xl text-error">
								{formatPrice(Math.min(...chainStats.map((s) => s.latestPrice)))}
							</div>
							<div class="stat-desc">
								{chainStats.find(
									(s) =>
										s.latestPrice ===
										Math.min(...chainStats.map((s) => s.latestPrice)),
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
								).toFixed(2)}%
							</div>
							<div class="stat-desc">Arbitrage opportunity</div>
						</div>
					</div>
				{/if}
			{/snippet}
		</QueryRenderer>
	</div>
</div>
