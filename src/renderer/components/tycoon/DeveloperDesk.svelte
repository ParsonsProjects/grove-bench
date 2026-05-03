<script lang="ts">
  import type { SessionStatus } from '../../../shared/types.js';
  import { getDeveloperAppearance } from '../../lib/developer-appearance.js';

  interface DeskSession {
    id: string;
    branch: string;
    repoPath: string;
    status: SessionStatus;
    displayName?: string | null;
  }

  interface Props {
    session: DeskSession;
    repoLabel?: string | null;
    label: string;
    isActive: boolean;
    running: boolean;
    pending: boolean;
    needsAttention: boolean;
    accentColor: string;
    isDragging: boolean;
    isDragOver: boolean;
    onActivate: () => void;
    onClose: () => void;
    onContextMenu: (e: MouseEvent) => void;
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: () => void;
    onDragLeave: () => void;
    elBind?: (el: HTMLElement | null) => void;
  }

  let {
    session,
    repoLabel,
    label,
    isActive,
    running,
    pending,
    needsAttention,
    accentColor,
    isDragging,
    isDragOver,
    onActivate,
    onClose,
    onContextMenu,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onDragLeave,
    elBind,
  }: Props = $props();

  const appearance = $derived(getDeveloperAppearance(session.id));

  const status = $derived.by<'idle' | 'running' | 'starting' | 'installing' | 'error' | 'permission' | 'needs-attention'>(() => {
    if (session.status === 'error') return 'error';
    if (session.status === 'starting') return 'starting';
    if (session.status === 'installing') return 'installing';
    if (pending) return 'permission';
    if (needsAttention) return 'needs-attention';
    if (running) return 'running';
    return 'idle';
  });

  const bubble = $derived.by<{ kind: string; glyph: string } | null>(() => {
    switch (status) {
      case 'error':           return { kind: 'error',           glyph: '!' };
      case 'permission':      return { kind: 'permission',      glyph: '?' };
      case 'starting':        return { kind: 'starting',        glyph: 'Zz' };
      case 'installing':      return { kind: 'installing',      glyph: '…' };
      case 'needs-attention': return { kind: 'needs-attention', glyph: '!' };
      default:                return null;
    }
  });

  let rootEl = $state<HTMLElement | null>(null);
  $effect(() => {
    elBind?.(rootEl);
  });

  function handleAuxClick(e: MouseEvent) {
    if (e.button === 1) {
      e.preventDefault();
      onClose();
    }
  }

  function handleCloseClick(e: MouseEvent) {
    e.stopPropagation();
    onClose();
  }
</script>

<div
  bind:this={rootEl}
  class="tycoon-desk"
  data-active={isActive}
  data-running={running}
  data-dragging={isDragging}
  data-drag-over={isDragOver}
  style="--tycoon-accent: {accentColor}; --skin: {appearance.skinTone}; --hair: {appearance.hairColor}; --shirt: {appearance.shirtColor}; --monitor-tint: {appearance.monitorTint};"
  draggable="true"
  ondragstart={onDragStart}
  ondragover={onDragOver}
  ondrop={onDrop}
  ondragend={onDragEnd}
  ondragleave={onDragLeave}
  onclick={onActivate}
  onauxclick={handleAuxClick}
  oncontextmenu={onContextMenu}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}
  role="button"
  tabindex="0"
  aria-label={`Developer ${label}`}
>
  <span
    class="tycoon-desk-close"
    role="button"
    tabindex="-1"
    aria-label="Close session"
    onclick={handleCloseClick}
    onkeydown={(e) => { if (e.key === 'Enter') handleCloseClick(e as unknown as MouseEvent); }}
  >
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
  </span>

  <div class="tycoon-dev" data-status={status}>
    {#if bubble}
      <div class="tycoon-status-bubble" data-kind={bubble.kind}>{bubble.glyph}</div>
    {/if}
    <div class="tycoon-dev-hair"></div>
    <div class="tycoon-dev-head"></div>
    <div class="tycoon-dev-eye left"></div>
    <div class="tycoon-dev-eye right"></div>
    {#if appearance.accessory === 'glasses'}
      <div class="tycoon-dev-glasses"></div>
    {:else if appearance.accessory === 'headphones'}
      <div class="tycoon-dev-headphones"></div>
    {:else if appearance.accessory === 'hat'}
      <div class="tycoon-dev-hat"></div>
    {/if}
    <div class="tycoon-dev-body"></div>
    <div class="tycoon-dev-arm left"></div>
    <div class="tycoon-dev-arm right"></div>
  </div>

  <div class="tycoon-desk-furniture">
    <div class="tycoon-monitor">
      <div class="tycoon-monitor-screen"></div>
    </div>
    <div class="tycoon-monitor-stand"></div>
    <div class="tycoon-monitor-base"></div>
    <div class="tycoon-desk-surface"></div>
  </div>

  <div class="tycoon-nameplate">
    {#if repoLabel}
      <span class="tycoon-nameplate-repo" title={repoLabel}>{repoLabel}</span>
    {/if}
    <span class="tycoon-nameplate-name" title={label}>{label}</span>
  </div>
</div>
