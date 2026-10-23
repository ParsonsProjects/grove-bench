<script lang="ts">
  /**
   * A skill's card in the Skills drawer, the same on both tabs (This thread,
   * Scheduled): a square, green while the skill can run and grey when it is
   * turned off or its schedule is paused; the name and its tags, with an
   * aside on the right; lines under it; and its actions along the foot,
   * with any on the far right.
   */
  import type { Snippet } from 'svelte';

  let {
    name,
    active = true,
    struck = false,
    nameTitle,
    tags,
    aside,
    children,
    actions,
    end,
  }: {
    name: string;
    /** Can run: green square. Off or paused: grey. */
    active?: boolean;
    /** Turned off: the name is struck through. */
    struck?: boolean;
    /** The name's tooltip, e.g. its SKILL.md path. */
    nameTitle?: string;
    /** Next to the name, e.g. a source badge. */
    tags?: Snippet;
    /** On the right of the name, e.g. the agent. */
    aside?: Snippet;
    /** Lines under the name. Muted caption text unless a line says otherwise. */
    children?: Snippet;
    actions?: Snippet;
    /** Actions on the far right. */
    end?: Snippet;
  } = $props();
</script>

<div class="border border-border bg-card/80 px-3 py-2 min-w-0">
  <div class="flex items-center gap-1.5 min-w-0">
    <span class="w-1.5 h-1.5 shrink-0 {active ? 'bg-green-500' : 'bg-muted-foreground/40'}"></span>
    <span class="font-mono text-xs truncate {struck ? 'text-muted-foreground line-through' : 'text-foreground'}" title={nameTitle ?? name}>{name}</span>
    {@render tags?.()}
    {#if aside}
      <span class="ms-auto ps-2 shrink-0 text-caption text-muted-foreground">{@render aside()}</span>
    {/if}
  </div>
  {#if children}
    <div class="mt-0.5 text-caption text-muted-foreground">{@render children()}</div>
  {/if}
  {#if actions || end}
    <div class="flex items-center gap-1 mt-2">
      {@render actions?.()}
      <span class="flex-1"></span>
      {@render end?.()}
    </div>
  {/if}
</div>
