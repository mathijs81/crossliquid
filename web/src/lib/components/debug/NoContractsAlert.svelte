<script lang="ts">
import { vaultChainId } from "$lib/wagmi/chains";
import Alert from "../atoms/Alert.svelte";

interface Props {
  chainId: number;
}

let { chainId }: Props = $props();
</script>

<Alert variant="info">
  <span>No contracts deployed on chain {chainId}. {#if chainId === vaultChainId}Run `pnpm -C foundry deploy:anvil` to deploy contracts.{/if}</span>
</Alert>