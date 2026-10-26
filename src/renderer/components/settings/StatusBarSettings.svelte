<script lang="ts">
  /**
   * The status bar's parts, in two lists, one per side of the bar. Drag a
   * part to reorder it or move it to the other side, and untick it to hide
   * it. From the keyboard, a part's handle moves it with the up and down
   * arrows (down from the end of Left goes to the top of Right).
   */
  import { tick } from 'svelte';
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
  import {
    ALWAYS_SHOWN_PART,
    defaultStatusBarLayout,
    isDefaultStatusBarLayout,
    moveStatusBarPart,
    setStatusBarPartShown,
    stepStatusBarPart,
    type StatusBarPart,
    type StatusBarPartId,
    type StatusBarSide,
  } from '../../../shared/status-bar-layout.js';
  import SettingsGroup from './SettingsGroup.svelte';

  const PARTS: Record<StatusBarPartId, { label: string; description: string }> = {
    agent: { label: 'Agent settings', description: 'Model, mode and the agent. Always shown.' },
    activity: { label: 'Activity', description: 'What the agent is doing, and its pending tools and background tasks.' },
    'thread-items': { label: 'Tasks and Files', description: "The agent's to-do list and the files it changed." },
    'last-turn': { label: 'Last turn', description: 'Its cost and how long it took. Wide windows only.' },
    capabilities: { label: 'MCP and Skills', description: 'Open the MCP servers and Skills drawers.' },
    branch: { label: 'Project and branch', description: 'The branch, its sync state and its PR.' },
    context: { label: 'Context', description: "How full the agent's context window is." },
    keys: { label: 'Keys', description: 'The keyboard shortcuts.' },
  };

  const SIDES: { side: StatusBarSide; label: string }[] = [
    { side: 'left', label: 'Left' },
    { side: 'right', label: 'Right' },
  ];

  const uid = $props.id();
  const layout = $derived(settingsStore.draft.statusBarLayout);
  const isDefault = $derived(isDefaultStatusBarLayout(layout));

  /** The part being dragged. */
  let dragging = $state<StatusBarPartId | null>(null);
  /** Where dropping it would put it: before `before`, or at the end of the
   *  side when that is null. */
  let dropAt = $state<{ side: StatusBarSide; before: StatusBarPartId | null } | null>(null);
  /** Read out after a move from the keyboard. */
  let announcement = $state('');

  function update(next: StatusBarPart[]) {
    settingsStore.draft.statusBarLayout = next;
  }

  function onDragStart(e: DragEvent, id: StatusBarPartId) {
    dragging = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    }
  }

  function endDrag() {
    dragging = null;
    dropAt = null;
  }

  /** The drop goes before the first row whose middle is below the pointer. */
  function onDragOver(e: DragEvent, side: StatusBarSide) {
    if (!dragging) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rows = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-part]');
    let before: StatusBarPartId | null = null;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        before = row.dataset.part as StatusBarPartId;
        break;
      }
    }
    if (dropAt?.side !== side || dropAt.before !== before) dropAt = { side, before };
  }

  function onDragLeave(e: DragEvent) {
    const list = e.currentTarget as HTMLElement;
    if (!(e.relatedTarget instanceof Node && list.contains(e.relatedTarget))) dropAt = null;
  }

  function onDrop(e: DragEvent, side: StatusBarSide) {
    e.preventDefault();
    if (dragging) update(moveStatusBarPart(layout, dragging, side, dropAt?.side === side ? dropAt.before : null));
    endDrag();
  }

  async function onHandleKeydown(e: KeyboardEvent, id: StatusBarPartId) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const next = stepStatusBarPart(layout, id, e.key === 'ArrowUp' ? -1 : 1);
    const part = next.find((p) => p.id === id)!;
    const onSide = next.filter((p) => p.side === part.side);
    const sideLabel = SIDES.find((s) => s.side === part.side)!.label;
    announcement = `${PARTS[id].label}: ${sideLabel}, ${onSide.indexOf(part) + 1} of ${onSide.length}`;
    update(next);
    // Moving to the other side rebuilds the row, which loses focus.
    await tick();
    document.getElementById(`${uid}-handle-${id}`)?.focus();
  }
</script>

<SettingsGroup
  title="Status bar"
  description="The bar above a thread's message box. Drag a part to change its place or move it to the other side, and untick it to hide it. Or focus a part's handle and press the up and down arrow keys."
>
  {#snippet actions()}
    <Button variant="subtle" size="xs" disabled={isDefault} onclick={() => update(defaultStatusBarLayout())}>
      Reset
    </Button>
  {/snippet}

  <div data-setting="status-bar-layout" class="grid grid-cols-2 gap-3 max-w-xl">
    {#each SIDES as { side, label: sideLabel } (side)}
      {@const parts = layout.filter((p) => p.side === side)}
      <div class="flex flex-col gap-1.5 min-w-0">
        <span id="{uid}-{side}" class="text-xs font-medium text-muted-foreground">{sideLabel}</span>
        <ul
          aria-labelledby="{uid}-{side}"
          data-testid="status-bar-{side}"
          class="relative flex flex-col gap-1 min-h-16 p-1 border border-dashed transition-colors {dropAt?.side === side ? 'border-primary bg-primary/5' : 'border-border'}"
          ondragover={(e) => onDragOver(e, side)}
          ondragleave={onDragLeave}
          ondrop={(e) => onDrop(e, side)}
        >
          {#each parts as part (part.id)}
            {@const info = PARTS[part.id]}
            <li
              data-part={part.id}
              draggable="true"
              ondragstart={(e) => onDragStart(e, part.id)}
              ondragend={endDrag}
              class="relative flex items-start gap-1.5 border border-border bg-background py-1.5 pr-2 pl-1 {dragging === part.id ? 'opacity-50' : ''}"
            >
              {#if dropAt?.side === side && dropAt.before === part.id}
                <span class="absolute inset-x-0 -top-[3px] h-0.5 bg-primary pointer-events-none" aria-hidden="true"></span>
              {/if}
              <button
                id="{uid}-handle-{part.id}"
                type="button"
                class="shrink-0 cursor-grab text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Move {info.label}"
                aria-describedby="{uid}-move-hint"
                onkeydown={(e) => onHandleKeydown(e, part.id)}
              >
                <GripVerticalIcon class="size-4" aria-hidden="true" />
              </button>
              <label class="flex items-start gap-2 min-w-0 flex-1 {part.id === ALWAYS_SHOWN_PART ? 'cursor-default' : 'cursor-pointer'}">
                <Checkbox
                  checked={part.shown}
                  disabled={part.id === ALWAYS_SHOWN_PART}
                  onCheckedChange={(checked: boolean) => update(setStatusBarPartShown(layout, part.id, checked))}
                  class="mt-0.5"
                  aria-describedby="{uid}-description-{part.id}"
                />
                <span class="flex flex-col min-w-0">
                  <span class="text-sm {part.shown ? 'text-foreground' : 'text-muted-foreground'}">{info.label}</span>
                  <span id="{uid}-description-{part.id}" class="text-xs text-muted-foreground leading-relaxed">{info.description}</span>
                </span>
              </label>
            </li>
          {:else}
            <li class="flex-1 flex items-center justify-center text-xs text-muted-foreground">Drag a part here</li>
          {/each}
          {#if dropAt?.side === side && dropAt.before === null && parts.length > 0}
            <li class="absolute inset-x-1 bottom-0.5 h-0.5 bg-primary pointer-events-none" aria-hidden="true"></li>
          {/if}
        </ul>
      </div>
    {/each}
  </div>
  <p id="{uid}-move-hint" class="sr-only">Up and down arrows move it. Down from the end of Left moves it to Right.</p>
  <p class="sr-only" aria-live="polite">{announcement}</p>
</SettingsGroup>
