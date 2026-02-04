<script lang="ts">
import ChainPrices from "$lib/components/chains/ChainPrices.svelte";
</script>

<div class="container mx-auto p-4">
	<div class="flex flex-col gap-4">
		<div>
			<h1 class="text-4xl font-bold">Chain Prices</h1>
			<p class="text-base-content/70 mt-2">
				Real-time ETH/USDC exchange rates and volatility across supported chains
			</p>
		</div>

		<ChainPrices />
	</div>
</div>
