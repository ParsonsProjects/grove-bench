<script lang="ts">
  import { untrack } from 'svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  /** A whole-number setting. It saves when you leave the field or press
   *  Enter, and only a valid number: a half-typed one never applies, and a
   *  cleared field doesn't fall back to the default unseen. */
  let { setting, label, unit, value, min = 0, description, onchange }: {
    setting: string;
    label: string;
    /** Shown after the field, e.g. "minutes". */
    unit: string;
    value: number;
    min?: number;
    description?: string;
    onchange: (value: number) => void;
  } = $props();

  const uid = $props.id();
  let text = $state(untrack(() => String(value)));
  let focused = $state(false);

  // Follow the saved value when it changes from elsewhere, unless mid-edit.
  $effect(() => {
    const saved = value;
    if (!untrack(() => focused)) untrack(() => { text = String(saved); });
  });

  const error = $derived.by(() => {
    const t = text.trim();
    if (!/^\d+$/.test(t)) return `Enter a whole number, ${min} or more.`;
    if (Number(t) < min) return `Enter ${min} or more.`;
    return null;
  });
  // Not while the field is being cleared to type a new number.
  const showError = $derived(error !== null && (!focused || text.trim() !== ''));
  const describedBy = $derived(
    [showError && `${uid}-error`, description && `${uid}-description`].filter(Boolean).join(' ') || undefined,
  );

  function commit() {
    if (error) return;
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
