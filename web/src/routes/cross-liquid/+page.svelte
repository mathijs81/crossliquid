<script lang="ts">
import WalletWarning from "$lib/components/WalletWarning.svelte";
import CrossLiquidVault from "$lib/components/cross-liquid/CrossLiquidVault.svelte";
</script>

<div class="container mx-auto p-4">
  <div class="flex flex-col gap-4">
    <div>
      <h1 class="text-4xl font-bold">Cross Liquid Vault</h1>
    </div>

    <WalletWarning />

    <CrossLiquidVault />
  </div>
</div>
