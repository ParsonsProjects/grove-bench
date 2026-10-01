<script lang="ts">
  import { untrack } from 'svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  /** A whole-number setting. It saves when you leave the field or press
   *  Enter, and only a valid number: a half-typed one never applies, and a
   *  cleared field doesn't fall back to the default unseen. Only what you
   *  type is checked, never the saved value. */
  let { setting, label, unit, value, min = 0, max, description, onchange }: {
    setting: string;
    label: string;
    /** Shown after the field, e.g. "minutes". */
    unit: string;
    value: number;
    min?: number;
    max?: number;
    description?: string;
    onchange: (value: number) => void;
  } = $props();

  const uid = $props.id();
  let text = $state(untrack(() => String(value)));
  let focused = $state(false);
  /** Typed in since it last showed the saved value. */
  let edited = $state(false);

  // Follow the saved value when it changes from elsewhere, unless mid-edit.
  $effect(() => {
    const saved = value;
    if (!untrack(() => focused)) untrack(() => { text = String(saved); edited = false; });
  });

  const range = $derived(max === undefined ? `${min} or more` : `from ${min} to ${max}`);
  const error = $derived.by(() => {
    const t = text.trim();
    if (!/^\d+$/.test(t)) return `Enter a whole number, ${range}.`;
    const n = Number(t);
    if (n < min || (max !== undefined && n > max)) return `Enter a number ${range}.`;
    return null;
  });
  // Not while the field is being cleared to type a new number.
  const showError = $derived(edited && error !== null && (!focused || text.trim() !== ''));
  const describedBy = $derived(
    [showError && `${uid}-error`, description && `${uid}-description`].filter(Boolean).join(' ') || undefined,
  );

  function commit() {
    if (!edited || error) return;
    const n = Number(text.trim());
    if (n !== value) onchange(n);
  }
</script>

<div data-setting={setting} class="flex flex-col gap-1.5">
  <Label for="{uid}-input">{label}</Label>
  <div class="flex items-center gap-2">
    <Input
      id="{uid}-input"
      type="text"
      inputmode="numeric"
      class="w-24"
      bind:value={text}
      aria-invalid={showError ? true : undefined}
      aria-describedby={describedBy}
      oninput={() => { edited = true; }}
      onfocus={() => { focused = true; }}
      onblur={() => { focused = false; commit(); }}
      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') commit(); }}
    />
    <span class="text-sm text-muted-foreground">{unit}</span>
  </div>
  {#if showError}
    <p id="{uid}-error" class="text-xs text-destructive">{error} Not saved.</p>
  {/if}
  {#if description}
    <p id="{uid}-description" class="text-xs text-muted-foreground leading-relaxed">{description}</p>
  {/if}
</div>
