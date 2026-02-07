<script lang="ts">
import { deployedContracts } from "$lib/contracts/deployedContracts";
import { createReadQuery } from "$lib/query/contractReads.svelte";
import {
  formatETH,
  formatTokenAmount,
  formatUSD,
  getTokenMeta,
  isFullRange,
  registerToken,
  tickToPrice,
} from "$lib/utils/format";
import { vaultChain } from "$lib/wagmi/chains";
import { erc20Abi, formatUnits } from "viem";
import QueryRenderer from "../QueryRenderer.svelte";
import Alert from "../atoms/Alert.svelte";
import Badge from "../atoms/Badge.svelte";
import { useBalance } from "$lib/query/networkInfo.svelte";
import { UNIV4_CONTRACTS } from "$lib/contracts/contract-addresses";

const positionsQuery = $derived(
  createReadQuery({
    contract: "positionManager",
    functionName: "getAllPositionsWithPoolState",
    args: [],
    chainId: vaultChain.id,
    watch: true,
  }),
);

function formatPositionId(positionId: `0x${string}`): string {
  return `${positionId.slice(0, 10)}...${positionId.slice(-8)}`;
}

const managerAddress = deployedContracts.positionManager.deployments[vaultChain.id];
const usdcAddress = UNIV4_CONTRACTS[vaultChain.id as keyof typeof UNIV4_CONTRACTS].usdc as `0x${string}`;

// Register known tokens so getTokenMeta can resolve them
registerToken(usdcAddress, "USDC", 6);

const usdBalanceQuery = createReadQuery({
  contract: usdcAddress,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [managerAddress],
  chainId: vaultChain.id,
  watch: true,
});

const ethBalanceQuery = useBalance(managerAddress);

function rangeBarPercent(tickLower: number, tickUpper: number, currentTick: number): number {
  if (tickUpper === tickLower) return 50;
  const clamped = Math.max(tickLower, Math.min(tickUpper, currentTick));
  return ((clamped - tickLower) / (tickUpper - tickLower)) * 100;
}

function formatFee(fee: number): string {
  if (fee === 0x800000) {
    return "Dynamic";
  }
  return `${fee / 10000}%`;
}
</script>

<div class="space-y-6">
  <div class="card bg-base-100 shadow-xl">
    <div class="card-body">
      <h2 class="card-title text-xl">Manager State</h2>
      <h3 class="card-subtitle text-lg">Manager Address: {managerAddress}</h3>
      <strong>Balances:</strong>
      ETH:
      <QueryRenderer query={ethBalanceQuery}>
        {#snippet children(data)}
          {formatETH(data.value)}
        {/snippet}
      </QueryRenderer>
      USDC:
      <QueryRenderer query={usdBalanceQuery}>
        {#snippet children(data)}
          $ {Number(formatUnits(data as bigint, 6)).toFixed(2)}
        {/snippet}
      </QueryRenderer>

      <h3 class="card-subtitle text-lg">Uniswap LP positions:</h3>

      <QueryRenderer query={positionsQuery}>
        {#snippet children(data)}
          {@const [ids, positions, currentTicks, inRangeList] = data as [
            readonly `0x${string}`[],
            readonly any[],
            readonly number[],
            readonly boolean[],
          ]}

          {#if ids.length === 0}
            <Alert variant="info"><span>No positions deployed yet</span></Alert>
          {:else}
            <div class="space-y-4">
              {#each ids as id, idx}
                {@const position = positions[idx]}
                {@const currentTick = currentTicks[idx]}
                {@const inRange = inRangeList[idx]}
                {@const meta0 = getTokenMeta(position.poolKey.currency0)}
                {@const meta1 = getTokenMeta(position.poolKey.currency1)}
                {@const fullRange = isFullRange(position.tickLower, position.tickUpper)}
                {@const priceLow = tickToPrice(position.tickLower, meta0.decimals, meta1.decimals)}
                {@const priceHigh = tickToPrice(position.tickUpper, meta0.decimals, meta1.decimals)}
                {@const priceCurrent = tickToPrice(currentTick, meta0.decimals, meta1.decimals)}
                {@const percent = rangeBarPercent(position.tickLower, position.tickUpper, currentTick)}

                <div class="card bg-base-200/50 shadow-sm">
                  <div class="card-body p-4 gap-3">
                    <!-- Header row -->
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-xs opacity-60">{formatPositionId(id)}</span>
                        <Badge variant={position.poolKey.fee === 500 ? "primary" : "neutral"}>
                          {formatFee(position.poolKey.fee)} fee
                        </Badge>
                      </div>
                      {#if inRange}
                        <Badge variant="success">In Range</Badge>
                      {:else}
                        <Badge variant="warning">Out of Range</Badge>
                      {/if}
                    </div>

                    <!-- Price range bar -->
                    <div class="space-y-1">
                      <div class="flex justify-between text-xs opacity-70">
                        <span>{meta1.symbol} per {meta0.symbol}</span>
                        <span>Current: {formatUSD(priceCurrent)}</span>
                      </div>

                      {#if fullRange}
                        <div class="flex items-center gap-2 h-8">
                          <div class="badge badge-ghost badge-sm">Full Range</div>
                        </div>
                      {:else}
                        <div class="relative h-6 flex items-center">
                          <!-- Track -->
                          <div class="w-full h-2 rounded-full bg-base-300 relative overflow-hidden">
                            <!-- Filled portion -->
                            <div
                              class="absolute inset-y-0 left-0 rounded-full transition-all"
                              class:bg-success={inRange}
                              class:bg-warning={!inRange}
                              style="width: {percent}%"
                            ></div>
                          </div>
                          <!-- Current price marker -->
                          <div
                            class="absolute w-3 h-3 rounded-full border-2 border-base-100 -translate-x-1/2 transition-all"
                            class:bg-success={inRange}
                            class:bg-warning={!inRange}
                            style="left: {percent}%"
                          ></div>
                        </div>
                        <div class="flex justify-between text-xs font-medium">
                          <span>{formatUSD(priceLow)}</span>
                          <span>{formatUSD(priceHigh)}</span>
                        </div>
                      {/if}
                    </div>

                    <!-- Amounts -->
                    <div class="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <div class="opacity-60 text-xs">{meta0.symbol}</div>
                        <div class="font-medium">{formatTokenAmount(position.amount0, meta0.decimals)}</div>
                      </div>
                      <div>
                        <div class="opacity-60 text-xs">{meta1.symbol}</div>
                        <div class="font-medium">{formatTokenAmount(position.amount1, meta1.decimals, 2)}</div>
                      </div>
                      <div>
                        <div class="opacity-60 text-xs">Liquidity</div>
                        <div class="font-mono text-xs">{position.liquidity.toString()}</div>
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>

            <div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200/50 w-full mt-4">
              <div class="stat place-items-center sm:place-items-start">
                <div class="stat-title">Total Positions</div>
                <div class="stat-value text-2xl text-primary">{ids.length}</div>
              </div>
              <div class="stat place-items-center sm:place-items-start">
                <div class="stat-title">In Range</div>
                <div class="stat-value text-2xl text-success">{inRangeList.filter((x) => x).length}</div>
              </div>
              <div class="stat place-items-center sm:place-items-start">
                <div class="stat-title">Out of Range</div>
                <div class="stat-value text-2xl text-warning">{inRangeList.filter((x) => !x).length}</div>
              </div>
            </div>
          {/if}
        {/snippet}
      </QueryRenderer>
    </div>
  </div>
</div>
