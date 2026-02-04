<script lang="ts">
import type { Component, Snippet } from "svelte";
import InfoIcon from "phosphor-svelte/lib/InfoIcon";
import CheckCircleIcon from "phosphor-svelte/lib/CheckCircleIcon";
import WarningIcon from "phosphor-svelte/lib/WarningIcon";
import XCircleIcon from "phosphor-svelte/lib/XCircleIcon";
import MinusCircleIcon from "phosphor-svelte/lib/MinusCircleIcon";

interface Props {
  variant?: "neutral" | "primary" | "success" | "warning" | "error" | "info";
  icon?: Component;
  children?: Snippet;
}

let { variant = "neutral", icon, children }: Props = $props();

const defaultIcons: Record<string, Component | null> = {
  neutral: null,
  primary: null,
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: WarningIcon,
  error: XCircleIcon,
};

// svelte-ignore state_referenced_locally
const Icon = icon ?? defaultIcons[variant];
</script>

<div class="badge badge-{variant} gap-2">
  {#if Icon}
    <Icon class="inline-block h-4 w-4 stroke-current" />
  {/if}
  {#if children}
    {@render children()}
  {/if}
</div>
