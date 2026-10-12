<script lang="ts">
  import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
  import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
  import type { CollapsiblePanel } from '../../shared/types.js';
  import { panelStore } from '../stores/panels.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';

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

<Button
  variant="quiet"
  size="icon-xs"
  onclick={() => panelStore.toggle(panel)}
  aria-expanded={!collapsed}
  aria-label={action}
  title={action}
  data-panel-toggle={panel}
  class={className}
>
  {#if collapsed}
    <PanelLeftOpenIcon aria-hidden="true" />
  {:else}
    <PanelLeftCloseIcon aria-hidden="true" />
  {/if}
</Button>
