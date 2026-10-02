<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Related settings under a heading. `card` boxes them, for groups that
   *  repeat, such as one per agent. `titleAside` sits beside the title, for a
   *  label such as Alpha. */
  let { title, description, card = false, titleAside, children }: {
    title?: string;
    description?: string;
    card?: boolean;
    titleAside?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="flex flex-col gap-5 {card ? 'border border-border bg-card/40 p-4' : ''}">
  {#if title}
    <div>
      <h4 class="{card ? 'text-base' : 'text-sm'} font-semibold text-foreground flex items-center gap-2">{title}{#if titleAside}{@render titleAside()}{/if}</h4>
      {#if description}
        <p class="text-xs text-muted-foreground leading-relaxed mt-1">{description}</p>
      {/if}
    </div>
  {/if}
  {@render children()}
</section>
