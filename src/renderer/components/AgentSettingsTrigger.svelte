<script lang="ts">
  /**
   * The Agent settings button, in the status bar and the draft bar. The
   * model and mode lead: they are what changes, and the mode sets what the
   * agent may do without asking. The agent and any control off its default
   * sit underneath. A long model name is cut short; the tooltip has it whole.
   */
  import { toneText } from '../lib/control-tones.js';
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
  let title = $derived(
    `Agent settings: ${[model, mode?.label, ...details.map((d) => d.label)].filter(Boolean).join(', ')} (${agentName}). Click to change`,
  );
</script>

<button
  {onclick}
  class="flex items-center gap-2 pl-1.5 pr-1 py-0.5 border border-border whitespace-nowrap text-left transition-colors hover:bg-accent {open ? 'bg-accent' : ''}"
  {title}
  aria-haspopup="dialog"
  aria-expanded={open}
>
  <span class="w-1.5 h-1.5 shrink-0 bg-primary" aria-hidden="true"></span>
  <span class="flex flex-col gap-px leading-snug min-w-0">
    <span class="flex items-center min-w-0 text-foreground font-medium" data-testid="agent-settings-headline">
      <span class="truncate max-w-32 @3xl:max-w-48">{model}</span>
      {#if mode}
        <!-- Its spaces stay in the text; as a flex item it needs padding to show them. -->
        <span class="shrink-0 px-1 text-muted-foreground/40 font-normal">{' · '}</span><span class="shrink-0 {mode.tone ? toneText(mode.tone) : ''}">{mode.label}</span>
      {/if}
    </span>
    <span class="truncate max-w-40 @3xl:max-w-56 text-muted-foreground/80 text-[11px]" data-testid="agent-settings-detail">
      {agentName}{#each details as item (item.id)}<span class="text-muted-foreground/40">{' · '}</span>{item.label}{/each}
    </span>
  </span>
  <svg
    class="w-3 h-3 shrink-0 text-muted-foreground/60 transition-transform {open ? 'rotate-180' : ''}"
    viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M4 6l4 4 4-4" />
  </svg>
</button>
