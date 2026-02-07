<script lang="ts">
import { page } from "$app/state";
import { useBalance, useBlockNumber } from "$lib/query/networkInfo.svelte";
import { config } from "$lib/wagmi/config";
import { createConnection } from "$lib/web3/createConnection.svelte";
import { connect, disconnect } from "@wagmi/core";
import XCircleIcon from "phosphor-svelte/lib/XCircleIcon";
import NetworkMismatchAlert from "./NetworkMismatchAlert.svelte";
import ShuffleAngularIcon from "phosphor-svelte/lib/ShuffleAngularIcon";
import PiggyBankIcon from "phosphor-svelte/lib/PiggyBankIcon";
import BugIcon from "phosphor-svelte/lib/BugIcon";
import ChartLineIcon from "phosphor-svelte/lib/ChartLineIcon";
import SpeedometerIcon from "phosphor-svelte/lib/SpeedometerIcon";
import type { Component } from "svelte";

const connection = createConnection();

const balance = $derived(
  useBalance(connection.address as `0x${string}` | undefined, {
    watch: true,
  }),
);
const blockNumber = useBlockNumber({ watch: true });

const chainName = $derived(config.chains.find((chain) => chain.id === connection.chainId)?.name ?? "Unsupported chain");

let connectError = $state<string | null>(null);
let isConnecting = $state(false);

async function connectWallet() {
  if (isConnecting) return;

  connectError = null;
  isConnecting = true;
  try {
    // TODO: implement modal to choose connector in case of multiple connectors?
    await connect(config, { connector: config.connectors[0] });
  } catch (error: unknown) {
    console.error("Failed to connect wallet:", error);
    connectError = error instanceof Error ? error.message : "Failed to connect wallet";
  } finally {
    isConnecting = false;
  }
}

async function disconnectWallet() {
  connectError = null;
  await disconnect(config);
}

const baseDestinations = [
  [SpeedometerIcon, "Crosschain Liquidity", "/chains"],
  [PiggyBankIcon, "Deposit to Vault", "/cross-liquid"],
  [ChartLineIcon, "Position Stats", "/stats"],
  ...(import.meta.env.DEV ? [[BugIcon, "Debug", "/debug"]] : []),
] as const;

const destinations = $derived(
  baseDestinations.map(([Icon, name, href]) => [Icon, name, href, page.url.pathname?.startsWith(href) ?? false]),
) as [Component, string, string, boolean][];
</script>

<div class="navbar bg-base-100 shadow-sm">
  <div class="navbar-start">
    <div class="dropdown">
      <div tabindex="0" role="button" class="btn btn-ghost btn-circle lg:hidden">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7" />
        </svg>
      </div>
      <ul tabindex="-1" class="menu menu-sm dropdown-content bg-base-100 rounded-box z-1 mt-3 w-52 p-2 shadow">
        {#each destinations as [Icon, name, href, active] (name)}
          <li><a href={href} class:menu-active={active}>
            <Icon class="h-5 w-5" />
            {name}
          </a></li>
        {/each}
      </ul>
    </div>
    <a href="/" class="btn btn-ghost text-xl text-primary"
      ><ShuffleAngularIcon class="h-6 w-6" /> CrossLiquid</a
    >
  </div>
  <div class="navbar-center hidden lg:flex">
    <ul class="menu menu-horizontal px-1 gap-1">
      {#each destinations as [Icon, name, href, active] (name)}
        <li><a href={href} class="btn btn-ghost gap-2" class:btn-active={active}>
          <Icon class="h-5 w-5" />
          <span>{name}</span>
        </a></li>
      {/each}
    </ul>
  </div>
  <div class="navbar-end gap-2 me-2">
    {#if chainName}
      <div class="hidden sm:flex items-baseline gap-1.5 text-sm">
        <span class="opacity-70">{chainName}</span>
        <span class="font-mono text-xs opacity-50">
          #{blockNumber.data ? blockNumber.data.toLocaleString() : '...'}
        </span>
      </div>
    {/if}
    {#if connection.isConnected}
      <div class="dropdown dropdown-end">
        <button type="button" tabindex="0" class="btn btn-sm bg-base-200 hover:bg-base-300 h-fit py-1">
          {#if balance.data}
            <span class="opacity-70 text-xs">
              {(Number(balance.data.value) / 10 ** balance.data.decimals).toFixed(3)}
              {balance.data.symbol}
            </span>
          {/if}
          <span class="font-mono">{connection.address?.slice(0, 6)}...{connection.address?.slice(-4)}</span>
        </button>
        <ul class="mt-3 z-[1] p-2 shadow menu menu-sm dropdown-content bg-base-100 rounded-box w-52">
          <li>
            <button onclick={disconnectWallet}>Disconnect</button>
          </li>
        </ul>
      </div>
    {:else}
      <button class="btn btn-primary" onclick={connectWallet} disabled={isConnecting}>
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
    {/if}
  </div>
</div>

<NetworkMismatchAlert />

{#if connectError}
  <div class="alert alert-error mx-4 mt-2">
    <XCircleIcon class="shrink-0 h-6 w-6" />
    <span>{connectError}</span>
  </div>
{/if}
