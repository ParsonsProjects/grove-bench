<script lang="ts">
  import { onMount } from 'svelte';
  import type { SpellcheckMenuRequest } from '../../shared/types.js';
  import ContextMenu from './ContextMenu.svelte';

  // Suggestions for a right-clicked misspelled word. Main finds the word and
  // the suggestions; this draws them with the app's own menu instead of the
  // native OS one.

  let menu = $state<{ x: number; y: number; req: SpellcheckMenuRequest } | null>(null);

  // Where the right-click landed, in the page's own coordinates. The DOM
  // event always fires before main hears about the click, so this is the
  // click that opened the menu. Main's coordinates are only a fallback.
  let lastPointer: { x: number; y: number } | null = null;

  function rememberPointer(e: MouseEvent) {
    lastPointer = { x: e.clientX, y: e.clientY };
  }

  onMount(() => {
    window.addEventListener('contextmenu', rememberPointer, true);
    const off = window.groveBench.onSpellcheckMenu((req) => {
      const at = lastPointer ?? { x: req.x, y: req.y };
      lastPointer = null;
      menu = { ...at, req };
    });
    return () => {
      window.removeEventListener('contextmenu', rememberPointer, true);
      off();
    };
  });

  let items = $derived.by(() => {
    if (!menu) return [];
    const list: Array<{ label: string; icon?: string; action: () => void; separator?: boolean; disabled?: boolean }> =
      menu.req.suggestions.map((s) => ({ label: s, action: () => window.groveBench.spellcheckReplace(s) }));
    if (list.length === 0) list.push({ label: 'No suggestions', action: () => {}, disabled: true });
    list.push({ label: 'Add to Dictionary', icon: 'add', action: () => window.groveBench.spellcheckAddWord(), separator: true });
    return list;
  });
</script>

{#if menu}
  {#key menu}
    <ContextMenu x={menu.x} y={menu.y} {items} label="Spelling suggestions" onclose={() => menu = null} />
  {/key}
{/if}
