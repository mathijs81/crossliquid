<script lang="ts">
import CodeIcon from "phosphor-svelte/lib/CodeIcon";
import GithubLogoIcon from "phosphor-svelte/lib/GithubLogoIcon";
import ShuffleAngularIcon from "phosphor-svelte/lib/ShuffleAngularIcon";
import { createConnection } from "$lib/web3/createConnection.svelte";

const connection = createConnection();
</script>

<div class="hero min-h-[calc(100vh-4rem)]">
  <div class="hero-content text-center">
    <div class="max-w-3xl">
      <h1 class="text-6xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent flex justify-center items-center gap-2">
        <ShuffleAngularIcon class="h-12 w-12 text-primary" /> CrossLiquid
      </h1>
      <p class="py-6 text-xl text-base-content/70">
        Agentic Crosschain LP. Manage liquidity from a single vault across Base, Optimism, Unichain & Mainnet.
      </p>

      <div class="flex flex-wrap gap-4 justify-center">
        <a href="/cross-liquid" class="btn btn-primary btn-lg">
          <CodeIcon class="h-6 w-6" />
          Deposit to Vault
        </a>
        <a href="https://github.com/mathijs81/crossliquid" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-lg">
          <GithubLogoIcon class="h-6 w-6" />
          View on GitHub
        </a>
      </div>

      <p class="py-4 text-sm text-base-content/50">
        Built for HackMoney 2026
      </p>

      {#if connection.isConnected}
        <div class="mt-8">
          <div class="stats shadow">
            <div class="stat">
              <div class="stat-title">Connected Address</div>
              <div class="stat-value text-lg font-mono">{connection.address?.slice(0, 10)}...{connection.address?.slice(-8)}</div>
              <div class="stat-desc">Chain ID: {connection.chainId}</div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>