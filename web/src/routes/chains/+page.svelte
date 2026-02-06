<script lang="ts">
import ChainPrices from "$lib/components/chains/ChainPrices.svelte";
</script>

<div class="container mx-auto p-4">
  <div class="flex flex-col gap-4">
    <div>
      <h1 class="text-4xl font-bold">Chain Prices</h1>
      <p class="text-base-content/70 mt-2">Real-time ETH/USDC exchange rates and volatility across supported chains</p>
    </div>

    <ChainPrices />

    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-xl">What is this?</h2>

        <p class="text-base-content/70">
          You can view real-time stats about 0.05% Univ4 pools across various chains.
          <br>
          The APR over the last 30m, 4h and 1day is calculated (on hover of the APR column) and we calculate a liquidity
          opportunity score (LOS) for each chain where we integrate that fee yield, volatility and gas costs.
          <br>
          The LOS leads to a target allocation rate.
        </p>
      </div>
    </div>
  </div>
</div>
