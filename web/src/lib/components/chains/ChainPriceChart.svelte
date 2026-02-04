<script lang="ts">
import type { ECharts } from "echarts";
import * as echarts from "echarts";
import { onMount } from "svelte";
import type { ExchangeRate } from "$lib/types/exchangeRate";

interface Props {
  data: ExchangeRate[];
  color: string;
}

let { data, color }: Props = $props();

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

  const sortedData = [...data].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const values = sortedData.map((d) => parseFloat(d.usdcOutput));
  const timestamps = sortedData.map((d) =>
    new Date(d.timestamp).toLocaleTimeString(),
  );

  chart.setOption({
    grid: {
      left: 0,
      right: 0,
      top: 5,
      bottom: 5,
    },
    xAxis: {
      type: "category",
      data: timestamps,
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
        data: values,
        smooth: true,
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
        return `${point.name}<br/>$${point.value.toFixed(6)}`;
      },
    },
  });
});
</script>

<div bind:this={chartContainer} class="w-full h-full"></div>
