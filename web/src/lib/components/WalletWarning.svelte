<script lang="ts">
import Alert from "./atoms/Alert.svelte";
import { createConnection } from "$lib/web3/createConnection.svelte";

const connection = createConnection();
</script>

{#if !connection.isConnected}
  <Alert variant="warning">
    <span>Please connect your wallet to interact with contracts</span>
  </Alert>
{/if}