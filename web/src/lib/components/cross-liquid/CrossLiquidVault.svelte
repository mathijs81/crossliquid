<script lang="ts">
import {
  createReadQuery,
  readVaultQuery,
} from "$lib/query/contractReads.svelte";
import { useContractWrite } from "$lib/query/contractWrites.svelte";
import { formatETH, formatPrice } from "$lib/utils/format";
import { toastError } from "$lib/utils/toast";
import { vaultChain } from "$lib/wagmi/chains";
import { createConnection } from "$lib/web3/createConnection.svelte";
import { Debounced } from "runed";
import { parseUnits } from "viem";
import QueryRenderer from "../QueryRenderer.svelte";
import TransactionStatus from "../TransactionStatus.svelte";

const connection = createConnection();

let amount = $state(0);
let amountWei = $derived(BigInt(parseUnits(amount?.toString() ?? "0", 18)));

const debouncedAmountWei = new Debounced(() => amountWei, 250);

let price = $derived(
  readVaultQuery("calcMintPrice", [debouncedAmountWei?.current ?? 0n]),
);
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
  while (debouncedAmountWei.pending || price.isLoading) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (price.isError) {
    toastError("Failed to calculate price");
    return;
  }
  const priceValue = price.data;
  await mintMutation.mutate({
    args: [amountWei],
    value: priceValue,
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
            {formatETH(balance.data as bigint | undefined)} {#if balance.isLoading}*{/if}
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
      <p class="text-base-content/70 text-sm">
        Enter how many $CLQ tokens you want to mint.
      </p>

      <div class="form-control w-full max-w-xs">
        <label class="label" for="mint-amount">
          <span class="label-text">Amount</span>
        </label>
        <input
          id="mint-amount"
          type="number"
          min="0"
          step="1"
          bind:value={amount}
          class="input input-bordered input-primary w-full"
        />
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <span class="text-base-content/80">
          {#if amount > 0}
            <QueryRenderer query={price}>
              {#snippet children(price)}
                Price in ETH: <span class="font-medium">{formatPrice(price, 18, 6)}</span>
              {/snippet}
            </QueryRenderer>
          {:else}
            —
          {/if}
        </span>
      </div>

      <div class="card-actions justify-start pt-2">
        <button
          type="button"
          class="btn btn-primary"
          onclick={() => mint()}
          disabled={amount <= 0 || mintMutation.isPending}
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
