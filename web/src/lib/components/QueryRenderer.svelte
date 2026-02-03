<script lang="ts" generics="T">
import type { CreateQueryResult } from "@tanstack/svelte-query";
import type { Snippet } from "svelte";

interface Props {
  query: CreateQueryResult<T, Error>;
  children: Snippet<[T]>;
}

const { query, children }: Props = $props();
</script>

{#if query.isPending}
	<span class="inline-flex justify-center">
		<span class="loading loading-dots"></span>
	</span>
{:else if query.isError}
	<div class="alert alert-error" role="alert" data-testid="error">
		<span>Error: {query.error?.message ?? "Unknown error"}</span>
	</div>
{:else if query.data}
	{@render children(query.data)}
{/if}
