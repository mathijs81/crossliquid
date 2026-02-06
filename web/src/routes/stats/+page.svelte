<script lang="ts">
import WalletWarning from "$lib/components/WalletWarning.svelte";
import PositionStats from "$lib/components/stats/PositionStats.svelte";
</script>

<div class="container mx-auto p-4">
  <div class="flex flex-col gap-4">
    <div>
      <h1 class="text-4xl font-bold">Position Stats</h1>
      <p class="text-base-content/70 mt-2">View deployed liquidity positions and their current state</p>
    </div>

    <WalletWarning />

    <PositionStats />
  </div>
</div>
