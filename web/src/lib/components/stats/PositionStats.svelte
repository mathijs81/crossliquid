<script lang="ts">
import { createReadQuery } from "$lib/query/contractReads.svelte";
import { formatETH } from "$lib/utils/format";
import { vaultChain } from "$lib/wagmi/chains";
import QueryRenderer from "../QueryRenderer.svelte";
import Alert from "../atoms/Alert.svelte";
import Badge from "../atoms/Badge.svelte";

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

function formatTick(tick: number): string {
  return tick.toLocaleString();
}
</script>

<div class="space-y-6">
  <div class="card bg-base-100 shadow-xl">
    <div class="card-body">
      <h2 class="card-title text-xl">Deployed Positions</h2>

      <QueryRenderer query={positionsQuery}>
        {#snippet children(data)}
          {@const [ids, positions, currentTicks, inRangeList] = data as [
            readonly `0x${string}`[],
            readonly any[],
            readonly number[],
            readonly boolean[],
          ]}

          {#if ids.length === 0}
            <Alert variant="info">
              <span>No positions deployed yet</span>
            </Alert>
          {:else}
            <div class="overflow-x-auto">
              <table class="table table-zebra">
                <thead>
                  <tr>
                    <th>Position ID</th>
                    <th>Tick Range</th>
                    <th>Current Tick</th>
                    <th>Status</th>
                    <th>Liquidity</th>
                    <th>Amount0</th>
                    <th>Amount1</th>
                  </tr>
                </thead>
                <tbody>
                  {#each ids as id, idx}
                    {@const position = positions[idx]}
                    {@const currentTick = currentTicks[idx]}
                    {@const inRange = inRangeList[idx]}
                    <tr>
                      <td>
                        <div class="font-mono text-xs">
                          {formatPositionId(id)}
                        </div>
                      </td>
                      <td>
                        <div class="text-sm">
                          {formatTick(position.tickLower)} → {formatTick(
                            position.tickUpper,
                          )}
                        </div>
                      </td>
                      <td>
                        <div class="text-sm font-medium">
                          {formatTick(currentTick)}
                        </div>
                      </td>
                      <td>
                        {#if inRange}
                          <Badge variant="success">
                            In Range
                          </Badge>
                        {:else}
                          <Badge variant="warning">
                            Out of Range
                          </Badge>
                        {/if}
                      </td>
                      <td>
                        <div class="text-sm font-mono">
                          {position.liquidity.toString()}
                        </div>
                      </td>
                      <td>
                        <div class="text-sm">
                          {formatETH(position.amount0)}
                        </div>
                      </td>
                      <td>
                        <div class="text-sm">
                          {formatETH(position.amount1)}
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

            <div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200/50 w-full mt-4">
              <div class="stat place-items-center sm:place-items-start">
                <div class="stat-title">Total Positions</div>
                <div class="stat-value text-2xl text-primary">
                  {ids.length}
                </div>
              </div>
              <div class="stat place-items-center sm:place-items-start">
                <div class="stat-title">In Range</div>
                <div class="stat-value text-2xl text-success">
                  {inRangeList.filter((x) => x).length}
                </div>
              </div>
              <div class="stat place-items-center sm:place-items-start">
                <div class="stat-title">Out of Range</div>
                <div class="stat-value text-2xl text-warning">
                  {inRangeList.filter((x) => !x).length}
                </div>
              </div>
            </div>
          {/if}
        {/snippet}
      </QueryRenderer>
    </div>
  </div>
</div>
