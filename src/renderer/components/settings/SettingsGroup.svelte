<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import { settingsStore } from '../../stores/settings.svelte.js';

  /** Related settings under a heading. `card` boxes them, for groups that
   *  repeat, such as one per agent. `titleAside` sits beside the title, for a
   *  label such as Alpha. `collapse` lets a titled group fold down to its
   *  heading: `key` names it, `open` is how it starts, and once toggled it
   *  stays as left (settingsStore.folds). Folded settings stay in the page,
   *  so Settings search can still find and unfold them. */
  let { title, description, card = false, collapse, titleAside, children }: {
    title?: string;
    description?: string;
    card?: boolean;
    collapse?: { key: string; open: boolean };
    titleAside?: Snippet;
    children: Snippet;
  } = $props();

  let open = $state(untrack(() => (collapse ? settingsStore.folds.get(collapse.key) ?? collapse.open : true)));
</script>

{#snippet heading()}
  <div class="min-w-0">
    <h4 class="{card ? 'text-base' : 'text-sm'} font-semibold text-foreground flex items-center gap-2">{title}{#if titleAside}{@render titleAside()}{/if}</h4>
    {#if description}
      <p class="text-xs text-muted-foreground leading-relaxed mt-1">{description}</p>
    {/if}
  </div>
{/snippet}

{#if collapse && title}
  <section class={card ? 'border border-border bg-card/40' : ''}>
    <details
      bind:open
      ontoggle={(e) => { if (collapse) settingsStore.folds.set(collapse.key, e.currentTarget.open); }}
      class="group/fold"
    >
      <summary
        class="flex items-start gap-2 cursor-pointer select-none hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {card ? 'p-4' : 'py-1'}"
      >
        <ChevronRightIcon class="size-4 mt-0.5 shrink-0 text-muted-foreground transition-transform group-open/fold:rotate-90" aria-hidden="true" />
        {@render heading()}
      </summary>
      <div class="flex flex-col gap-5 {card ? 'px-4 pb-4 pt-1' : 'pt-4'}">
        {@render children()}
      </div>
    </details>
  </section>
{:else}
  <section class="flex flex-col gap-5 {card ? 'border border-border bg-card/40 p-4' : ''}">
    {#if title}
      {@render heading()}
    {/if}
    {@render children()}
  </section>
{/if}
