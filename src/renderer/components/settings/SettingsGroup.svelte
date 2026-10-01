<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Related settings under a heading. `card` boxes them, for groups that
   *  repeat, such as one per agent. */
  let { title, description, card = false, children }: {
    title?: string;
    description?: string;
    card?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class="flex flex-col gap-5 {card ? 'border border-border bg-card/40 p-4' : ''}">
  {#if title}
    <div>
      <h4 class="{card ? 'text-base' : 'text-sm'} font-semibold text-foreground">{title}</h4>
      {#if description}
        <p class="text-xs text-muted-foreground leading-relaxed mt-1">{description}</p>
      {/if}
    </div>
  {/if}
  {@render children()}
</section>
