<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  type Issue = { error: string } | { hint: string } | null;

  /** An editable list of short strings, such as permission rules. */
  let { setting, label, items, placeholder, removeLabel, tone = 'neutral', layout = 'chips', help, examples, check, onadd, onremove }: {
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
    /** Items to start from: clicking one puts it in the field to edit. */
    examples?: string[];
    /** Checked on Add. An error refuses the item; a hint shows once and the
     *  next Add adds it anyway. Saved items with an error are marked too. */
    check?: (value: string) => Issue;
    onadd: (value: string) => void;
    onremove: (index: number) => void;
  } = $props();

  const uid = $props.id();
  let value = $state('');
  let input = $state<HTMLInputElement | null>(null);
  /** What the last Add found, until the field changes. */
  let issue = $state<Issue>(null);
  const trimmed = $derived(value.trim());
  const duplicate = $derived(trimmed !== '' && items.includes(trimmed));
  const error = $derived(issue && 'error' in issue ? issue.error : null);
  const hint = $derived(issue && 'hint' in issue ? issue.hint : null);

  function add() {
    if (!trimmed || duplicate) return;
    const found = check?.(trimmed) ?? null;
    // A hint already shown for this text: the second Add means it.
    if (found && !(hint && 'hint' in found)) {
      issue = found;
      return;
    }
    onadd(trimmed);
    value = '';
    issue = null;
  }

  function useExample(example: string) {
    value = example;
    issue = null;
    input?.focus();
  }

  function brokenItem(item: string): string | null {
    const found = check?.(item);
    return found && 'error' in found ? found.error : null;
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
        {@const broken = brokenItem(item)}
        <li
          class="flex items-center gap-1 pl-2 text-xs min-w-0 {tone === 'destructive' ? 'bg-destructive/10' : 'bg-muted'} {layout === 'rows' ? 'justify-between' : ''} {broken ? 'outline outline-1 -outline-offset-1 outline-amber-500/70' : ''}"
          title={broken ?? undefined}
        >
          {#if broken}
            <span class="text-amber-500 font-semibold" aria-hidden="true">!</span>
          {/if}
          <code class="truncate">{item}</code>
          {#if broken}
            <span class="sr-only">(never matches)</span>
          {/if}
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
  <div class="flex items-center gap-2 max-w-xl">
    <Input
      id="{uid}-input"
      type="text"
      bind:value
      bind:ref={input}
      {placeholder}
      spellcheck={false}
      aria-invalid={error ? true : undefined}
      aria-describedby={[issue && `${uid}-issue`, help && `${uid}-help`].filter(Boolean).join(' ') || undefined}
      oninput={() => { issue = null; }}
      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') add(); }}
    />
    <Button variant="secondary" onclick={add} disabled={!trimmed || duplicate || error !== null}>
      {hint ? 'Add anyway' : 'Add'}
    </Button>
  </div>
  {#if duplicate}
    <p class="text-xs text-muted-foreground">Already in the list.</p>
  {:else if error}
    <p id="{uid}-issue" class="text-xs text-destructive" role="alert">{error}</p>
  {:else if hint}
    <p id="{uid}-issue" class="text-xs text-amber-500" role="status">{hint}</p>
  {/if}
  {#if examples?.length}
    <div class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span class="mr-0.5">Examples:</span>
      {#each examples as example (example)}
        <button
          type="button"
          onclick={() => useExample(example)}
          class="px-1.5 py-0.5 bg-muted text-foreground/80 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Start from this rule"
        ><code>{example}</code></button>
      {/each}
    </div>
  {/if}
</div>
