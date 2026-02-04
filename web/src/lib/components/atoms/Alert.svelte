<script lang="ts">
import type { Component, Snippet } from "svelte";
import InfoIcon from "phosphor-svelte/lib/InfoIcon";
import CheckCircleIcon from "phosphor-svelte/lib/CheckCircleIcon";
import WarningIcon from "phosphor-svelte/lib/WarningIcon";
import XCircleIcon from "phosphor-svelte/lib/XCircleIcon";

interface Props {
  variant?: "info" | "success" | "warning" | "error";
  icon?: Component;
  children?: Snippet;
}

let { variant = "info", icon, children }: Props = $props();

const defaultIcons = {
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: WarningIcon,
  error: XCircleIcon,
};

// svelte-ignore state_referenced_locally
const Icon = icon ?? defaultIcons[variant];
</script>

<div class="alert alert-{variant}">
  <Icon class="shrink-0 w-6 h-6" />
  {#if children}
    {@render children()}
  {/if}
</div>
