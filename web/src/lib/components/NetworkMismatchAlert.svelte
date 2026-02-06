<script lang="ts">
import { switchChain } from "@wagmi/core";
import Alert from "./atoms/Alert.svelte";
import { config } from "$lib/wagmi/config";
import { createConnection } from "$lib/web3/createConnection.svelte";
import { vaultChain, vaultChainId } from "$lib/wagmi/chains";

const connection = createConnection();

let isSwitchingChain = $state(false);
let switchError = $state<string | null>(null);

async function handleSwitchChain() {
  if (isSwitchingChain) return;

  isSwitchingChain = true;
  switchError = null;
  try {
    await switchChain(config, { chainId: vaultChainId });
  } catch (error: unknown) {
    console.error("Failed to switch chain:", error);
    switchError = error instanceof Error ? error.message : "Failed to switch chain";
  } finally {
    isSwitchingChain = false;
  }
}
</script>

{#if connection.isWrongChain}
  <div class="mx-4 mt-2">
    <Alert variant="warning">
      <span> You are connected to the wrong network. Please switch to {vaultChain.name}. </span>
      <button class="btn btn-sm btn-primary" onclick={handleSwitchChain} disabled={isSwitchingChain}>
        {isSwitchingChain ? "Switching..." : "Switch Network"}
      </button>
    </Alert>
  </div>
  {#if switchError}
    <div class="mx-4 mt-2">
      <Alert variant="error"><span>{switchError}</span></Alert>
    </div>
  {/if}
{/if}
