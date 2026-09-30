<script lang="ts">
  import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
  import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
  import type { CollapsiblePanel } from '../../shared/types.js';
  import { panelStore } from '../stores/panels.svelte.js';

  /** Folds a sidebar down to its rail, or opens it again. */
  let { panel, label, class: className = '' }: {
    panel: CollapsiblePanel;
    /** What the panel is, for the tooltip: "Collapse {label}". */
    label: string;
    class?: string;
  } = $props();

  let collapsed = $derived(panelStore.isCollapsed(panel));
  let action = $derived(`${collapsed ? 'Expand' : 'Collapse'} ${label}`);
</script>

<button
  type="button"
  onclick={() => panelStore.toggle(panel)}
  aria-expanded={!collapsed}
  aria-label={action}
  title={action}
  data-panel-toggle={panel}
  class="shrink-0 p-1 text-muted-foreground/70 hover:text-foreground hover:bg-accent/40 transition-colors {className}"
>
  {#if collapsed}
    <PanelLeftOpenIcon class="w-3.5 h-3.5" aria-hidden="true" />
  {:else}
    <PanelLeftCloseIcon class="w-3.5 h-3.5" aria-hidden="true" />
  {/if}
</button>
