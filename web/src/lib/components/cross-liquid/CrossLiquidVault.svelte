<script lang="ts">
import { createReadQuery, readVaultQuery } from "$lib/query/contractReads.svelte";
import { useContractWrite } from "$lib/query/contractWrites.svelte";
import { formatETH, formatPrice } from "$lib/utils/format";
import { vaultChain } from "$lib/wagmi/chains";
import { createConnection } from "$lib/web3/createConnection.svelte";
import { Debounced } from "runed";
import { parseUnits } from "viem";
import QueryRenderer from "../QueryRenderer.svelte";
import TransactionStatus from "../TransactionStatus.svelte";

const connection = createConnection();

let ethAmount = $state(0);
let ethAmountWei = $derived(BigInt(parseUnits(ethAmount?.toString() ?? "0", 18)));

const debouncedEthAmountWei = new Debounced(() => ethAmountWei, 250);

let tokensToReceive = $derived(readVaultQuery("calcTokensFromValue", [debouncedEthAmountWei?.current ?? 0n]));
let hash = $state<`0x${string}` | undefined>(undefined);

const balance = $derived(
  createReadQuery({
    contract: "crossLiquidVault",
    functionName: "balanceOf",
    args: [connection.address],
    chainId: vaultChain.id,
    watch: true,
  }),
);
const conversionRate = $derived(readVaultQuery("conversionRate"));

const mintMutation = useContractWrite({
  contract: "crossLiquidVault",
  functionName: "mint",
  chainId: vaultChain.id,
  onSent: (txHash) => {
    hash = txHash;
  },
});

const mint = async () => {
  await mintMutation.mutate({
    args: [],
    value: ethAmountWei,
  });
};
</script>

<div class="space-y-6">
  <!-- Balance & rate card -->
  <div class="card bg-base-100 shadow-xl">
    <div class="card-body">
      <h2 class="card-title text-xl">Your position</h2>
      <div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200/50 w-full">
        <div class="stat place-items-center sm:place-items-start">
          <div class="stat-title">Balance</div>
          <div class="stat-value text-2xl text-primary" data-testid="balance">
            {formatETH(balance.data as bigint | undefined)}
            {#if balance.isLoading}
              *
            {/if}
          </div>
          <div class="stat-desc">vault tokens</div>
        </div>
        <div class="stat place-items-center sm:place-items-start">
          <div class="stat-title">Conversion rate</div>
          <div class="stat-value text-2xl">
            <QueryRenderer query={conversionRate}>
              {#snippet children(conversionRate)}
                1 $CLQ = <span class="font-medium">{formatPrice(conversionRate, 9, 2)}</span> ETH
              {/snippet}
            </QueryRenderer>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Mint card -->
  <div class="card bg-base-100 shadow-xl">
    <div class="card-body">
      <h2 class="card-title text-xl">Mint new tokens</h2>
      <p class="text-base-content/70 text-sm">Enter how much ETH you want to spend.</p>

      <div class="form-control w-full max-w-xs">
        <label class="label" for="mint-amount"><span class="label-text">ETH Amount</span></label>
        <input
          id="mint-amount"
          type="number"
          min="0"
          step="0.001"
          bind:value={ethAmount}
          class="input input-bordered input-primary w-full"
        >
      </div>

      <div class="flex flex-wrap items-center gap-3"><span class="text-base-content/80">
        {#if ethAmount > 0}
          <QueryRenderer query={tokensToReceive}>
            {#snippet children(tokens)}
              You'll receive: <span class="font-medium">{formatPrice(tokens, 18, 6)}</span> $CLQ
            {/snippet}
          </QueryRenderer>
        {:else}
          —
        {/if}
      </span></div>

      <div class="card-actions justify-start pt-2">
        <button
          type="button"
          class="btn btn-primary"
          onclick={() => mint()}
          disabled={ethAmount <= 0 || mintMutation.isPending}
        >
          {#if mintMutation.isPending}
            <span class="loading loading-spinner loading-sm"></span>
            Minting…
          {:else}
            Mint
          {/if}
        </button>
      </div>

      {#if hash}
        <div class="mt-4">
          <TransactionStatus {hash} chainId={vaultChain.id} />
        </div>
      {/if}
    </div>
  </div>
</div>
