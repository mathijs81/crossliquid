<script lang="ts">
import { dev } from "$app/environment";
import favicon from "$lib/assets/favicon.svg";
import Header from "$lib/components/Header.svelte";
import TransactionToastHandler from "$lib/components/TransactionToastHandler.svelte";
import { createBlockchainQueryClient } from "$lib/query/config";
import { setGlobalClient } from "$lib/query/globalClient";
import { QueryClientProvider } from "@tanstack/svelte-query";
import { type Component } from "svelte";
import { Toaster } from "svelte-sonner";
import "./layout.css";

let { children } = $props();

const queryClient = createBlockchainQueryClient();
setGlobalClient(queryClient);

// Lazy load devtools in development
let SvelteQueryDevtools = $state<Component | undefined>(undefined);
if (dev) {
  import("@tanstack/svelte-query-devtools").then((mod) => {
    SvelteQueryDevtools = mod.SvelteQueryDevtools;
  });
}

// function handleError(error: unknown) {
//   const message =
//     error instanceof Error ? error.message : `Unknown error (${String(error)})`;
//   console.error("received top level error", error, message);
//   toastError(message);
// }
// onMount(() => {
//   window.addEventListener("error", handleError);
//   window.addEventListener("unhandledrejection", handleError);
//   return () => {
//     window.removeEventListener("error", handleError);
//     window.removeEventListener("unhandledrejection", handleError);
//   };
// });
</script>

<QueryClientProvider client={queryClient}>
  <div class="min-h-screen bg-base-200">
    <Header />
    {@render children()}
  </div>
  <TransactionToastHandler />
  <Toaster position="top-right" richColors />

  {#if dev && SvelteQueryDevtools}
    <SvelteQueryDevtools />
  {/if}
</QueryClientProvider>

<svelte:head>
  <title>CrossLiquid - Agentic Crosschain LP</title>
  <link rel="icon" href={favicon}>
</svelte:head>
