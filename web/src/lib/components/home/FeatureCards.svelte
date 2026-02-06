<script lang="ts">
import ShieldCheckIcon from "phosphor-svelte/lib/ShieldCheckIcon";
import HeadCircuitIcon from "phosphor-svelte/lib/HeadCircuitIcon";
import PiggyBankIcon from "phosphor-svelte/lib/PiggyBankIcon";
</script>

<div class="container mx-auto px-4 py-12">
  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <h2 class="card-title justify-center">
          <PiggyBankIcon class="h-10 w-10 text-primary p-1" /> Crosschain Vault
        </h2>
        <p>Single vault on Base manages liquidity across multiple chains</p>
      </div>
    </div>
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <h2 class="card-title justify-center">
          <HeadCircuitIcon class="h-10 w-10 text-primary p-1" /> Agentic LP
        </h2>
        <p>Off-chain agent optimizes distribution based on Liquidity Opportunity Score</p>
      </div>
    </div>
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <h2 class="card-title justify-center">
          <ShieldCheckIcon class="h-10 w-10 text-primary p-1" /> Hook Protection
        </h2>
        <p>Uniswap v4 hooks guard against toxic flow and extract dynamic fees</p>
      </div>
    </div>
  </div>
</div>
