<script lang="ts">
import { page } from "$app/state";

const is404 = $derived(page.status === 404);
</script>

<div class="container mx-auto p-4">
    <div class="flex flex-col gap-4">
        {#if is404}
        <h1 class="text-4xl font-bold">
            Page not found
        </h1>
        <a href="/" class="btn btn-primary">Go back to home</a>
        {:else}
        <h1 class="text-4xl font-bold">
            Error
        </h1>
        <a href="/" class="btn btn-primary">Go back to home</a>
        {/if}
    </div>
</div>