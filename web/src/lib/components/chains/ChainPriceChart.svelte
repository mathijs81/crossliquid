<script lang="ts">
import type { ECharts } from "echarts";
import * as echarts from "echarts";
import { onMount } from "svelte";
import { convertSqrtPriceX96ToPrice, type ExchangeRate, type PoolPrice } from "$lib/types/exchangeRate";

interface Props {
  data: ExchangeRate[];
  poolPrices: PoolPrice[];
  color: string;
}

let { data, poolPrices, color }: Props = $props();

let chartContainer: HTMLDivElement;
let chart: ECharts | null = $state(null);

onMount(() => {
  chart = echarts.init(chartContainer, null, {
    renderer: "canvas",
    width: 200,
    height: 50,
  });

  return () => {
    chart?.dispose();
  };
});

$effect(() => {
  if (!chart || !data || data.length === 0) return;

  const sortedData = [...data].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  // ECharts time axis expects [timestamp, value] with numeric time (ms)
  const series = sortedData.map((d) => [new Date(d.timestamp).getTime(), parseFloat(d.usdcOutput)]);

  const sortedPoolPrices = [...poolPrices].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const poolPriceSeries = sortedPoolPrices.map((p) => [
    new Date(p.timestamp).getTime(),
    convertSqrtPriceX96ToPrice(p.sqrtPriceX96),
  ]);

  chart.setOption({
    grid: {
      left: 0,
      right: 0,
      top: 5,
      bottom: 5,
    },
    xAxis: {
      type: "time",
      show: false,
    },
    yAxis: {
      type: "value",
      show: false,
      scale: true,
    },
    series: [
      {
        type: "line",
        name: "Test exchange rate",
        data: series,
        smooth: false,
        symbol: "none",
        lineStyle: {
          color: "#888888",
          width: 2,
        },
        // areaStyle: {
        //   color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        //     { offset: 0, color: `${color}40` },
        //     { offset: 1, color: `${color}08` },
        //   ]),
        // },
      },
      {
        type: "line",
        name: "Pool Price",
        data: poolPriceSeries,
        smooth: false,
        symbol: "none",
        lineStyle: {
          color: color,
          width: 2,
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: `${color}40` },
            { offset: 1, color: `${color}08` },
          ]),
        },
      },
    ],
    tooltip: {
      trigger: "axis",
      // biome-ignore lint/suspicious/noExplicitAny: ECharts types are heavy, not worth importing
      formatter: (params: any) => {
        const point = params[0];
        const [time, _] = point.data as [number, number];
        const timeStr = new Date(time).toLocaleTimeString();
        const lines = params.map((p: { seriesName: string; data: [number, number] }) => {
          const val = p.data[1];
          const label = p.seriesName || "Rate";
          return `${label}: $${Number(val).toFixed(6)}`;
        });
        return `${timeStr}<br/>${lines.join("<br/>")}`;
      },
    },
  });
});
</script>

<div bind:this={chartContainer} class="w-full h-full"></div>
