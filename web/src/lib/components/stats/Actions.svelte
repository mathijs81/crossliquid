<script lang="ts">
import { getGlobalClient } from "$lib/query/globalClient";
import { createQuery } from "@tanstack/svelte-query";
import QueryRenderer from "../QueryRenderer.svelte";
import Badge from "../atoms/Badge.svelte";
import Alert from "../atoms/Alert.svelte";

/** Matches agent TaskInfo from actionRunner / taskStore API response */
interface AgentTask {
  id: string;
  definitionName: string;
  status: string;
  startedAt: number;
  lastUpdatedAt: number;
  finishedAt: number | null;
  statusMessage: string;
  resourcesTaken: string[];
  taskData: unknown;
}

const actionsQuery = createQuery(
  () => ({
    queryKey: ["actions"],
    queryFn: async (): Promise<AgentTask[]> => {
      const response = await fetch(`/api/tasks?limit=50`);
      if (!response.ok) {
        throw new Error("Failed to fetch agent actions");
      }
      return response.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  }),
  getGlobalClient(),
);

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(task: AgentTask): string {
  const end = task.finishedAt ?? Date.now();
  const sec = (end - task.startedAt) / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (min < 60) return `${min}m ${s}s`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return "✓";
    case "failed":
    case "error":
      return "✗";
    case "running":
    case "pre-start":
      return "⟳";
    default:
      return "○";
  }
}

function statusClasses(status: string): string {
  const base = "inline-flex h-8 w-8 items-center justify-center rounded-full text-lg font-medium ";
  switch (status) {
    case "completed":
      return base + "bg-success/20 text-success";
    case "failed":
    case "error":
      return base + "bg-error/20 text-error";
    case "running":
    case "pre-start":
      return base + "bg-info/20 text-info";
    default:
      return base + "bg-base-300";
  }
}

import lifiIcon from "$lib/assets/lifi.svg";
import uniswapIcon from "$lib/assets/uniswap.svg";
import crossliquidIcon from "$lib/assets/favicon.svg";
import baseIcon from "$lib/assets/base.svg";
import optimismIcon from "$lib/assets/optimism.svg";
import ethereumIcon from "$lib/assets/ethereum.svg";
import unichainIcon from "$lib/assets/unichain.svg";
function getImgResource(taskName: string) {
  if (taskName.includes("liquidity")) return uniswapIcon;
  if (taskName.includes("swap")) return lifiIcon;
  if (taskName.includes("vault")) return crossliquidIcon;
}

function getChainIcon(definitionName: string) {
  // Ends with "-<chainId>"
  const chainId = definitionName.split("-").pop();
  if (chainId === "130") return unichainIcon;
  if (chainId === "8453") return baseIcon;
  if (chainId === "10") return optimismIcon;
  return ethereumIcon;
}
</script>

<div class="space-y-4">
  <div>
    <h2 class="text-2xl font-bold">Agent Actions</h2>
    <p class="text-base-content/70 mt-1">Recent tasks executed by the CrossLiquid agent.</p>
  </div>

  <QueryRenderer query={actionsQuery}>
    {#snippet children(tasks)}
      {#if tasks.length === 0}
        <Alert variant="info"><span>No agent actions recorded yet.</span></Alert>
      {:else}
        <div class="card bg-base-100 shadow-xl">
          <div class="card-body">
            <div class="overflow-x-auto">
              <table class="table table-zebra">
                <thead>
                  <tr>
                    <th class="w-8">Status</th>
                    <th>Action</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {#each tasks as task (task.id)}
                    <tr class="align-top">
                      <td>
                        <span class={statusClasses(task.status)} title={task.status}> {statusIcon(task.status)} </span>
                      </td>
                      <td class="flex items-center">
                        <img src={getImgResource(task.definitionName)} alt={task.definitionName} class="w-8 h-8">
                        <img src={getChainIcon(task.definitionName)} alt={task.definitionName} class="w-4 h-4 mt-4 mr-2">
                        <div><span class="font-medium">{task.definitionName}</span>
                        <!-- <div class="font-mono text-xs opacity-60 mt-0.5">
                              {task.id.slice(0, 24)}…
                            </div> --></div>
                      </td>
                      <td class="whitespace-nowrap text-sm">{formatTime(task.startedAt)}</td>
                      <td class="whitespace-nowrap text-sm font-mono">
                        {formatDuration(task)}
                        {#if !task.finishedAt}
                          <span class="ml-1"
                            ><Badge variant="info">live</Badge></span
                          >
                        {/if}
                      </td>
                      <td class="max-w-xs">
                        <span class="text-sm opacity-90 line-clamp-2" title={task.statusMessage}>
                          {task.statusMessage || "—"}
                        </span>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200/50 w-full mt-4">
              <div class="stat place-items-center sm:place-items-start">
                <div class="stat-title">Total</div>
                <div class="stat-value text-2xl">{tasks.length}</div>
              </div>
              <div class="stat place-items-center sm:place-items-start">
                <div class="stat-title">Completed</div>
                <div class="stat-value text-2xl text-success">
                  {tasks.filter((t) => t.status === "completed").length}
                </div>
              </div>
              <div class="stat place-items-center sm:place-items-start">
                <div class="stat-title">Failed / Error</div>
                <div class="stat-value text-2xl text-error">
                  {tasks.filter((t) => t.status === "failed" || t.status === "error").length}
                </div>
              </div>
              <div class="stat place-items-center sm:place-items-start">
                <div class="stat-title">Running</div>
                <div class="stat-value text-2xl text-info">
                  {tasks.filter((t) => t.status === "running" || t.status === "pre-start").length}
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}
    {/snippet}
  </QueryRenderer>
</div>
