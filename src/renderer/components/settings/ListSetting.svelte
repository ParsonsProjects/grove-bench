<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  /** An editable list of short strings, such as permission rules. */
  let { setting, label, items, placeholder, removeLabel, tone = 'neutral', layout = 'chips', help, onadd, onremove }: {
    setting: string;
    label: string;
    items: string[];
    placeholder?: string;
    /** Start of each remove button's name; the item is appended. */
    removeLabel: string;
    tone?: 'neutral' | 'destructive';
    /** Chips for short items, rows for long ones such as paths. */
    layout?: 'chips' | 'rows';
    help?: Snippet;
    onadd: (value: string) => void;
    onremove: (index: number) => void;
  } = $props();

  const uid = $props.id();
  let value = $state('');
  const trimmed = $derived(value.trim());
  const duplicate = $derived(trimmed !== '' && items.includes(trimmed));

  function add() {
    if (!trimmed || duplicate) return;
    onadd(trimmed);
    value = '';
  }
</script>

<div data-setting={setting} class="flex flex-col gap-2">
  <Label for="{uid}-input">{label}</Label>
  {#if help}
    <div id="{uid}-help" class="text-xs text-muted-foreground leading-relaxed">{@render help()}</div>
  {/if}
  {#if items.length > 0}
    <ul class={layout === 'chips' ? 'flex flex-wrap gap-1' : 'flex flex-col gap-1'} aria-label={label}>
      {#each items as item, i (i)}
        <li class="flex items-center gap-1 pl-2 text-xs min-w-0 {tone === 'destructive' ? 'bg-destructive/10' : 'bg-muted'} {layout === 'rows' ? 'justify-between' : ''}">
          <code class="truncate">{item}</code>
          <button
            type="button"
            onclick={() => onremove(i)}
            class="size-6 shrink-0 inline-flex items-center justify-center text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="{removeLabel} {item}"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="flex items-center gap-2">
    <Input
      id="{uid}-input"
      type="text"
      bind:value
      {placeholder}
      spellcheck={false}
      aria-describedby={help ? `${uid}-help` : undefined}
      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') add(); }}
    />
    <Button variant="secondary" onclick={add} disabled={!trimmed || duplicate}>Add</Button>
  </div>
  {#if duplicate}
    <p class="text-xs text-muted-foreground">Already in the list.</p>
  {/if}
</div>
