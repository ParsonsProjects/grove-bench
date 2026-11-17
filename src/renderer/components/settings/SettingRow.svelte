<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Label } from '$lib/components/ui/label/index.js';

  /** One setting: its label, its control and a short description. `setting`
   *  names the row for Settings search (SETTINGS_INDEX). */
  let { setting, label, for: forId, description, help, actions, children }: {
    setting: string;
    label: string;
    /** Id of the control, so the label names it and clicking it focuses it. */
    for?: string;
    description?: string;
    /** A description with markup, in place of `description`. */
    help?: Snippet;
    /** Small controls on the label's line, at its end (a view switch). */
    actions?: Snippet;
    children: Snippet;
  } = $props();
</script>

<div data-setting={setting} class="flex flex-col gap-1.5">
  {#if actions}
    <div class="flex items-center justify-between gap-2">
      <Label for={forId}>{label}</Label>
      <div class="flex items-center gap-1">{@render actions()}</div>
    </div>
  {:else}
    <Label for={forId}>{label}</Label>
  {/if}
  {@render children()}
  {#if help}
    <div class="text-xs text-muted-foreground leading-relaxed">{@render help()}</div>
  {:else if description}
    <p class="text-xs text-muted-foreground leading-relaxed">{description}</p>
  {/if}
</div>
