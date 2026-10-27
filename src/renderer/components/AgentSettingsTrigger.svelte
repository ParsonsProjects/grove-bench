<script lang="ts">
  /**
   * The Agent settings lozenge, in the status bar and the draft bar: the
   * model and mode, then any control off its default (so Alt+E and Alt+T
   * show what they changed). The mode sets what the agent may do without
   * asking, so it keeps its tone. The agent's name is in the tooltip and
   * the popup. A long model name is cut short; the tooltip has it whole.
   */
  import { toneText } from '../lib/control-tones.js';
  import { lozenge } from '../lib/lozenge.js';
  import type { ControlTone } from '../../shared/types.js';

  interface Setting { id: string; label: string; tone?: ControlTone }

  let {
    agentName,
    modelLabel,
    mode,
    details,
    open,
    onclick,
  }: {
    agentName: string;
    modelLabel: string;
    /** The mode, tinted by its tone. None when the agent has no modes. */
    mode?: Setting;
    /** Other controls, only those off their default. */
    details: Setting[];
    open: boolean;
    onclick: () => void;
  } = $props();

  let model = $derived(modelLabel || 'Provider default');
  /** Names the agent too, which the lozenge leaves to its tooltip. */
  let label = $derived(
    `Agent settings: ${[model, mode?.label, ...details.map((d) => d.label)].filter(Boolean).join(', ')} (${agentName})`,
  );
</script>

<button
  {onclick}
  class={lozenge({ open, class: 'pr-1' })}
  title="{label}. Click to change"
  aria-label={label}
  aria-haspopup="dialog"
  aria-expanded={open}
>
  <span class="flex items-center min-w-0 text-foreground font-medium" data-testid="agent-settings-headline">
    <span class="truncate max-w-24 @3xl:max-w-40">{model}</span>
    {#if mode}
      <!-- Its spaces stay in the text; as a flex item it needs padding to show them. -->
      <span class="shrink-0 px-1 text-muted-foreground/40 font-normal">{' · '}</span><span class="shrink-0 {mode.tone ? toneText(mode.tone) : ''}">{mode.label}</span>
    {/if}
  </span>
  {#if details.length > 0}
    <span class="truncate max-w-24 @3xl:max-w-40 -ml-1.5 text-muted-foreground" data-testid="agent-settings-detail">
      {#each details as item (item.id)}<span class="px-1 text-muted-foreground/40">{' · '}</span>{item.label}{/each}
    </span>
  {/if}
  <svg
    class="w-3 h-3 shrink-0 text-muted-foreground transition-transform {open ? 'rotate-180' : ''}"
    viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M4 6l4 4 4-4" />
  </svg>
</button>
