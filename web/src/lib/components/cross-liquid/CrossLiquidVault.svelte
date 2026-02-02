<script lang="ts">
import { readCrossLiquidVaultCalcMintPrice } from "$lib/contracts/generated";
import { useContractRead } from "$lib/query/contractReads.svelte";
import { useContractWrite } from "$lib/query/contractWrites.svelte";
import { config } from "$lib/wagmi/config";
import { createConnection } from "$lib/web3/createConnection.svelte";
import { createQuery } from "@tanstack/svelte-query";
import { Debounced } from "runed";
import { formatEther, formatUnits, parseUnits } from "viem";
import TransactionStatus from "../TransactionStatus.svelte";
import { vaultChain } from "$lib/wagmi/chains";

// FIXME(mathijs): chain management is not good
// FIXME(mathijs): handle centrally when wallet is not connected

const connection = createConnection();

let amount = $state(0);
let amountWei = $derived(BigInt(parseUnits(amount.toString(), 18)));

const calcMintPrice = async (wei: bigint) => {
  const result = await readCrossLiquidVaultCalcMintPrice(config, {
    args: [wei],
  });
  return result;
};

let price = new Debounced(
  () =>
    createQuery(() => ({
      queryKey: ["crossLiquidVault", "calcMintPrice", amountWei],
      queryFn: async () => await calcMintPrice(amountWei),
      staleTime: 60_000,
    })),
  250,
);

let priceFormatted = $derived(formatUnits(price.current.data ?? 0n, 18));
let hash = $state<`0x${string}` | undefined>(undefined);

const balance = $derived(
  useContractRead({
    contract: "crossLiquidVault",
    functionName: "balanceOf",
    args: [connection.address],
    chainId: vaultChain.id,
    watch: true,
  }),
);
const conversionRate = $derived(
  useContractRead({
    contract: "crossLiquidVault",
    functionName: "conversionRate",
    chainId: vaultChain.id,
  }),
);

const mintMutation = useContractWrite({
  contract: "crossLiquidVault",
  functionName: "mint",
  chainId: vaultChain.id,
  onSent: (txHash) => {
    hash = txHash;
  },
});

const mint = async () => {
  const price = await calcMintPrice(amountWei);
  await mintMutation.mutate({
    args: [amountWei],
    value: price,
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
          <div class="stat-value text-2xl text-primary">
            {#if balance.data !== undefined}
              {formatEther(balance.data as bigint)}
            {:else}
              —
            {/if}
          </div>
          <div class="stat-desc">vault tokens</div>
        </div>
        <div class="stat place-items-center sm:place-items-start">
          <div class="stat-title">Conversion rate</div>
          <div class="stat-value text-2xl">
            {conversionRate.data?.toString() ?? "—"}
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
        Enter the amount; price in ETH updates automatically.
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
            {#if price.current.data !== 0n}
              <span class="font-medium">{priceFormatted}</span> ETH
            {:else}
              <span class="loading loading-dots loading-sm text-primary"></span>
            {/if}
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
