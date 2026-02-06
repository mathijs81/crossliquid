import type { PoolPriceRecord } from "./database.js";
import { db } from "./database.js";
import { logger } from "../logger.js";

export interface FeeMetrics {
  feeApr: number;
  liquidityUsd: number;
  timeDeltaSeconds: number;
}

export interface VolatilityMetrics {
  priceVolatility: number;
  minPrice: number;
  maxPrice: number;
  priceRange: number;
  standardDeviation: number;
}

export interface TimeWindowMetrics {
  apr30min: FeeMetrics | null;
  apr4hr: FeeMetrics | null;
  apr1day: FeeMetrics | null;
  volatility30min: VolatilityMetrics | null;
  volatility4hr: VolatilityMetrics | null;
  volatility1day: VolatilityMetrics | null;
}

export interface ChainMetrics extends TimeWindowMetrics {
  chainId: number;
  lastUpdated: string;
  dataPoints: number;
}

export class MetricsService {
  private static readonly SECONDS_PER_YEAR = 365 * 24 * 3600;

  static computeFeeAndLiquidity(
    poolPrices: PoolPriceRecord[],
  ): FeeMetrics | null {
    if (poolPrices.length < 2) return null;

    const sorted = [...poolPrices]
      .filter((p) => p.feeGrowthGlobal0 !== "0" && p.feeGrowthGlobal1 !== "0")
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

    if (sorted.length < 2) return null;

    const oldest = sorted[0];
    const newest = sorted[sorted.length - 1];

    const timeDeltaSeconds =
      (new Date(newest.timestamp).getTime() -
        new Date(oldest.timestamp).getTime()) /
      1000;
    if (timeDeltaSeconds < 60) return null;

    const deltaFee0 =
      Number(
        BigInt(newest.feeGrowthGlobal0) - BigInt(oldest.feeGrowthGlobal0),
      ) /
      2 ** 128;
    const deltaFee1 =
      Number(
        BigInt(newest.feeGrowthGlobal1) - BigInt(oldest.feeGrowthGlobal1),
      ) /
      2 ** 128;

    if (deltaFee0 === 0 && deltaFee1 === 0) return null;

    const price = (Number(newest.sqrtPriceX96) / 2 ** 96) ** 2;

    // Fee per unit L in microUSD (token0 is ETH with 18 decimals, token1 is USDC with 6 decimals)
    const fee0Usd = deltaFee0 * price;
    const totalFeeUsd = fee0Usd + deltaFee1;

    const liquidity = Number(newest.liquidity);
    // Capital per unit L in USD (full-range: both sides = sqrt(P)/10^6 each)
    const capitalUsd = 2 * Math.sqrt(price);

    if (capitalUsd === 0) return null;

    return {
      feeApr:
        (totalFeeUsd / capitalUsd / timeDeltaSeconds) *
        MetricsService.SECONDS_PER_YEAR,
      liquidityUsd: (liquidity * capitalUsd) / 1e6,
      timeDeltaSeconds,
    };
  }

  static computeVolatility(
    poolPrices: PoolPriceRecord[],
  ): VolatilityMetrics | null {
    if (poolPrices.length < 2) return null;

    const prices = poolPrices.map((p) => {
      const sqrtPrice = Number(p.sqrtPriceX96);
      return (sqrtPrice / 2 ** 96) ** 2 * 10 ** 12;
    });

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice;

    // Calculate standard deviation
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance =
      prices.reduce((sum, price) => sum + (price - mean) ** 2, 0) /
      prices.length;
    const standardDeviation = Math.sqrt(variance);

    // Normalized volatility as coefficient of variation (stddev / mean)
    const priceVolatility = mean > 0 ? standardDeviation / mean : 0;

    return {
      priceVolatility,
      minPrice,
      maxPrice,
      priceRange,
      standardDeviation,
    };
  }

  // TODO: we could just pre-sort all values and then get the right slices with binary search
  static getPoolPricesInWindow(
    allPrices: PoolPriceRecord[],
    windowSeconds: number,
  ): PoolPriceRecord[] {
    const now = Date.now();
    const cutoff = now - windowSeconds * 1000;

    return allPrices
      .filter((p) => new Date(p.timestamp).getTime() >= cutoff)
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
  }

  static async calculateMetricsForChain(
    chainId: number,
  ): Promise<ChainMetrics | null> {
    try {
      // Fetch enough data for last 24h
      const now = Date.now();
      const cutoff = now - 24 * 60 * 60 * 1000;
      const minTimestamp = new Date(cutoff).toISOString();

      const allPrices = db.getPoolPricesForChain(chainId, minTimestamp);
      allPrices.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      if (allPrices.length === 0) {
        return null;
      }

      // 30m, 4h, 1d
      const timeRanges = [30 * 60, 4 * 3600, 25 * 3600];

      const dataSets = timeRanges.map((range) =>
        MetricsService.getPoolPricesInWindow(allPrices, range),
      );

      return {
        chainId,
        apr30min: MetricsService.computeFeeAndLiquidity(dataSets[0]),
        apr4hr: MetricsService.computeFeeAndLiquidity(dataSets[1]),
        apr1day: MetricsService.computeFeeAndLiquidity(dataSets[2]),
        volatility30min: MetricsService.computeVolatility(dataSets[0]),
        volatility4hr: MetricsService.computeVolatility(dataSets[1]),
        volatility1day: MetricsService.computeVolatility(dataSets[2]),
        lastUpdated: allPrices[allPrices.length - 1].timestamp,
        dataPoints: allPrices.length,
      };
    } catch (error) {
      logger.error({ error, chainId }, "Error calculating metrics for chain");
      return null;
    }
  }

  static async calculateMetricsForAllChains(
    chainIds: number[],
  ): Promise<Map<number, ChainMetrics>> {
    const metrics = new Map<number, ChainMetrics>();

    for (const chainId of chainIds) {
      const chainMetrics =
        await MetricsService.calculateMetricsForChain(chainId);
      if (chainMetrics) {
        metrics.set(chainId, chainMetrics);
      }
    }

    return metrics;
  }
}
