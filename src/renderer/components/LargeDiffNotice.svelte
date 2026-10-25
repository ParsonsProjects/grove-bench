<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';

  /** Stands in for a diff or edit that isLargeDiff holds back, until the
   *  user asks to see it. */
  let {
    kind,
    size,
    label,
    onShow,
  }: {
    /** A file's diff, or one edit call's text (editSize). */
    kind: 'diff' | 'edit';
    size: { lines: number; chars: number };
    /** The button's accessible name, when a page shows several. */
    label?: string;
    onShow: () => void;
  } = $props();

  /** "2,500 lines, 15,000 characters" */
  function sizeText({ lines, chars }: { lines: number; chars: number }): string {
    return `${lines.toLocaleString()} ${lines === 1 ? 'line' : 'lines'}, ${chars.toLocaleString()} ${chars === 1 ? 'character' : 'characters'}`;
  }
  let text = $derived(kind === 'diff' ? `Large diff (${sizeText(size)}).` : `Large edit (${sizeText(size)} of text).`);
  let button = $derived(kind === 'diff' ? 'Show diff' : 'Show edit');
</script>

<Notice tone="neutral">
  <!-- Green, as an action (BRAND.md), as in OldThenNewNotice. -->
  {#snippet actions()}<Button size="2xs" variant="link" aria-label={label ?? button} onclick={onShow}>{button}</Button>{/snippet}
  <p>{text} Showing it can pause the app for a moment.</p>
</Notice>
