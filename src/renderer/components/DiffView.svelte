<script lang="ts" module>
  import type { DiffLine, SideBySideRow, ContextGap, ReviewComment } from '../lib/diff-types.js';
  import { intralineRanges } from '../lib/diff-highlight.js';
  // Re-export so existing component consumers can keep importing from here.
  export type { DiffLine, SideBySideRow, ContextGap, ReviewComment };

  /** Where a new comment is being written: the anchored line range on one side. */
  export interface CommentAnchor { side: 'old' | 'new'; startLine: number; endLine: number }

  export function buildSideBySideRows(diffLines: DiffLine[]): SideBySideRow[] {
    const rows: SideBySideRow[] = [];
    let i = 0;
    while (i < diffLines.length) {
      const line = diffLines[i];
      if (line.type === 'hunk') {
        rows.push({ type: 'hunk', hunkText: line.text });
        i++;
        continue;
      }
      if (line.type === 'expander') {
        rows.push({ type: 'expander', gap: line.gap });
        i++;
        continue;
      }
      if (line.type === 'context') {
        rows.push({
          type: 'context',
          left: { lineNum: line.oldLineNum ?? line.lineNum, text: line.text },
          right: { lineNum: line.newLineNum ?? line.lineNum, text: line.text },
        });
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < diffLines.length && diffLines[i].type === 'del') { dels.push(diffLines[i]); i++; }
      while (i < diffLines.length && diffLines[i].type === 'add') { adds.push(diffLines[i]); i++; }
      const paired = dels.length === adds.length;
      const maxLen = Math.max(dels.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        const ranges = paired ? intralineRanges(dels[j].text, adds[j].text) : null;
        rows.push({
          type: 'change',
          left: dels[j] ? { lineNum: dels[j].oldLineNum ?? dels[j].lineNum, text: dels[j].text } : undefined,
          right: adds[j] ? { lineNum: adds[j].newLineNum ?? adds[j].lineNum, text: adds[j].text } : undefined,
          leftRanges: ranges?.del,
          rightRanges: ranges?.add,
        });
      }
    }
    return rows;
  }

  /** Intraline change ranges for unified rendering: a run of N deletions
   *  followed by N additions is paired line-by-line (git's diff-highlight rule). */
  export function unifiedIntralineRanges(diffLines: DiffLine[]): Map<number, [number, number][]> {
    const out = new Map<number, [number, number][]>();
    let i = 0;
    while (i < diffLines.length) {
      if (diffLines[i].type !== 'del') { i++; continue; }
      const delStart = i;
      while (i < diffLines.length && diffLines[i].type === 'del') i++;
      const addStart = i;
      while (i < diffLines.length && diffLines[i].type === 'add') i++;
      const nDel = addStart - delStart;
      const nAdd = i - addStart;
      if (nDel !== nAdd) continue;
      for (let j = 0; j < nDel; j++) {
        const r = intralineRanges(diffLines[delStart + j].text, diffLines[addStart + j].text);
        if (!r) continue;
        if (r.del.length) out.set(delStart + j, r.del);
        if (r.add.length) out.set(addStart + j, r.add);
      }
    }
    return out;
  }

  import { createPatch } from 'diff';

  export function parseDiffLines(patch: string): DiffLine[] {
    const lines = patch.split('\n');
    const result: DiffLine[] = [];
    let oldLine = 0;
    let newLine = 0;
    for (const line of lines) {
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:') || line.startsWith('====')) continue;
      if (line.startsWith('@@')) {
        const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (m) {
          oldLine = parseInt(m[1], 10);
          newLine = parseInt(m[3], 10);
          result.push({
            type: 'hunk',
            text: line,
            hunk: {
              oldStart: oldLine,
              oldCount: m[2] === undefined ? 1 : parseInt(m[2], 10),
              newStart: newLine,
              newCount: m[4] === undefined ? 1 : parseInt(m[4], 10),
            },
          });
        } else {
          result.push({ type: 'hunk', text: line });
        }
        continue;
      }
      if (line.startsWith('+')) {
        result.push({ type: 'add', text: line.slice(1), lineNum: newLine, newLineNum: newLine });
        newLine++;
      } else if (line.startsWith('-')) {
        result.push({ type: 'del', text: line.slice(1), lineNum: oldLine, oldLineNum: oldLine });
        oldLine++;
      } else if (line.startsWith(' ')) {
        result.push({ type: 'context', text: line.slice(1), lineNum: newLine, oldLineNum: oldLine, newLineNum: newLine });
        oldLine++;
        newLine++;
      }
    }
    return result;
  }

  export function computeDiffLines(toolName: string, input: Record<string, unknown>, filePath: string): DiffLine[] {
    if (toolName === 'Edit') {
      const oldStr = String(input?.old_string ?? '');
      const newStr = String(input?.new_string ?? '');
      if (!oldStr && !newStr) return [];
      const patch = createPatch(filePath || 'file', oldStr, newStr, '', '', { context: 3 });
      return parseDiffLines(patch);
    }
    if (toolName === 'Write') {
      const content = String(input?.content ?? '');
      if (!content) return [];
      return content.split('\n').map((line, i) => ({
        type: 'add' as const,
        text: line,
        lineNum: i + 1,
      }));
    }
    return [];
  }
</script>

<script lang="ts">
  import { languageForPath, highlightLine, markRanges } from '../lib/diff-highlight.js';
  import { EXPAND_STEP } from '../lib/diff-context.js';

  let {
    lines,
    sideBySide = false,
    maxHeight = '400px',
    filePath = '',
    onExpand,
    comments = [],
    composer = null,
    onAddComment,
    onSaveComment,
    onCancelComment,
    onUpdateComment,
    onRemoveComment,
  }: {
    lines: DiffLine[];
    sideBySide?: boolean;
    maxHeight?: string;
    filePath?: string;
    /** Reveal hidden context for a gap; when absent, expander rows are not rendered. */
    onExpand?: (gap: ContextGap, dir: 'up' | 'down' | 'all') => void;
    /** Review comments for this file, rendered under their anchored line. */
    comments?: ReviewComment[];
    /** Open comment composer (rendered under `composer.endLine`). */
    composer?: CommentAnchor | null;
    /** Called from the line gutter "+" button; `shiftKey` asks to extend the open composer's range. */
    onAddComment?: (anchor: { side: 'old' | 'new'; lineNum: number; text: string; shiftKey: boolean }) => void;
    onSaveComment?: (body: string) => void;
    onCancelComment?: () => void;
    onUpdateComment?: (id: string, body: string) => void;
    onRemoveComment?: (id: string) => void;
  } = $props();

  let rows = $derived(sideBySide ? buildSideBySideRows(lines) : []);
  let intraline = $derived(sideBySide ? new Map<number, [number, number][]>() : unifiedIntralineRanges(lines));
  let lang = $derived(filePath ? languageForPath(filePath) : null);
  const hl = (text: string, ranges?: [number, number][]) => {
    const html = highlightLine(text, lang);
    return ranges && ranges.length ? markRanges(html, ranges) : html;
  };

  const canComment = $derived(!!onAddComment);

  function commentsAt(side: 'old' | 'new', lineNum: number | undefined): ReviewComment[] {
    if (lineNum === undefined || comments.length === 0) return [];
    return comments.filter(c => c.side === side && c.endLine === lineNum);
  }
  function composerAt(side: 'old' | 'new', lineNum: number | undefined): boolean {
    return !!composer && lineNum !== undefined && composer.side === side && composer.endLine === lineNum;
  }
  function inComposerRange(side: 'old' | 'new', lineNum: number | undefined): boolean {
    return !!composer && lineNum !== undefined && composer.side === side && lineNum >= composer.startLine && lineNum <= composer.endLine;
  }

  // Composer draft lives here so the textarea keeps its text across re-renders
  // of the surrounding diff (which happens on every live status refresh).
  let draft = $state('');
  let editingId = $state<string | null>(null);
  let editDraft = $state('');
  $effect(() => {
    // Reset the draft when the composer moves to a different anchor.
    composer;
    draft = '';
  });

  function submitDraft() {
    const body = draft.trim();
    if (!body) return;
    onSaveComment?.(body);
    draft = '';
  }
  function draftKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitDraft(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancelComment?.(); }
  }
  function startEdit(c: ReviewComment) { editingId = c.id; editDraft = c.body; }
  function commitEdit() {
    if (editingId && editDraft.trim()) onUpdateComment?.(editingId, editDraft.trim());
    editingId = null;
  }
  function editKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); editingId = null; }
  }

  function gapLabel(gap: ContextGap): string {
    const n = gap.toNew - gap.fromNew + 1;
    return `${n} hidden line${n === 1 ? '' : 's'}`;
  }
</script>

{#snippet expander(gap: ContextGap)}
  {@const n = gap.toNew - gap.fromNew + 1}
  <div data-expander class="flex items-center gap-1 text-[10px] text-cyan-300/80 bg-cyan-950/10 border-y border-cyan-900/20 px-2 py-0.5 select-none">
    {#if n <= EXPAND_STEP}
      <button onclick={() => onExpand?.(gap, 'all')} class="flex items-center gap-1 hover:text-cyan-200 px-1" title="Show {n} hidden lines">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4"/></svg>
        {gapLabel(gap)}
      </button>
    {:else}
      <button onclick={() => onExpand?.(gap, 'down')} class="hover:text-cyan-200 px-1" title="Show {EXPAND_STEP} more lines below the previous hunk" aria-label="Expand down">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
      </button>
      <button onclick={() => onExpand?.(gap, 'up')} class="hover:text-cyan-200 px-1" title="Show {EXPAND_STEP} more lines above the next hunk" aria-label="Expand up">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
      </button>
      <span class="text-cyan-300/50 ml-1">{gapLabel(gap)}</span>
      <button onclick={() => onExpand?.(gap, 'all')} class="hover:text-cyan-200 px-1 ml-1" title="Show all hidden lines">all</button>
    {/if}
  </div>
{/snippet}

{#snippet addButton(side: 'old' | 'new', lineNum: number | undefined, text: string)}
  {#if canComment && lineNum !== undefined}
    <button
      onclick={(e) => onAddComment?.({ side, lineNum, text, shiftKey: e.shiftKey })}
      data-side={side}
      class="diff-add-comment absolute left-0 top-0 h-full w-4 flex items-center justify-center bg-primary text-primary-foreground text-[11px] leading-none opacity-0 group-hover/line:opacity-100 focus:opacity-100"
      title="Add a review comment on this line (shift-click to extend the open comment's range)"
      aria-label="Add comment on line {lineNum}"
    >+</button>
  {/if}
{/snippet}

{#snippet commentCards(side: 'old' | 'new', lineNum: number | undefined)}
  {#each commentsAt(side, lineNum) as c (c.id)}
    <div data-review-comment class="my-1 mx-2 border border-primary/30 bg-card/80 text-xs font-sans">
      <div class="flex items-center gap-2 px-2 py-1 border-b border-border/40 text-[10px] text-muted-foreground">
        <span>Line {c.startLine === c.endLine ? c.startLine : `${c.startLine}–${c.endLine}`}{c.side === 'old' ? ' (removed)' : ''}</span>
        <span class="ml-auto flex items-center gap-2">
          <button onclick={() => startEdit(c)} class="hover:text-foreground">edit</button>
          <button onclick={() => onRemoveComment?.(c.id)} class="hover:text-destructive">delete</button>
        </span>
      </div>
      {#if editingId === c.id}
        <div class="p-2 space-y-1">
          <textarea bind:value={editDraft} onkeydown={editKeydown} rows="2" class="w-full text-xs bg-background/60 border border-border/50 px-2 py-1 focus:outline-none focus:border-primary/50 resize-y"></textarea>
          <div class="flex gap-1 justify-end">
            <button onclick={() => editingId = null} class="px-2 py-0.5 border border-border text-muted-foreground hover:text-foreground">Cancel</button>
            <button onclick={commitEdit} class="px-2 py-0.5 bg-primary/90 text-primary-foreground hover:bg-primary">Save</button>
          </div>
        </div>
      {:else}
        <div class="px-2 py-1.5 whitespace-pre-wrap text-foreground/90">{c.body}</div>
      {/if}
    </div>
  {/each}
{/snippet}

{#snippet composerBox(side: 'old' | 'new', lineNum: number | undefined)}
  {#if composerAt(side, lineNum) && composer}
    <div data-review-composer class="my-1 mx-2 border border-primary/50 bg-card text-xs font-sans p-2 space-y-1">
      <div class="text-[10px] text-muted-foreground">
        Comment on line {composer.startLine === composer.endLine ? composer.startLine : `${composer.startLine}–${composer.endLine}`}
        <span class="text-muted-foreground/60">· shift-click another line's + to extend</span>
      </div>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        bind:value={draft}
        onkeydown={draftKeydown}
        rows="2"
        autofocus
        placeholder="What should the agent change here?"
        class="w-full text-xs bg-background/60 border border-border/50 px-2 py-1 placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 resize-y"
      ></textarea>
      <div class="flex items-center gap-1 justify-end">
        <span class="text-[10px] text-muted-foreground/60 mr-auto">Ctrl+Enter to add</span>
        <button onclick={() => onCancelComment?.()} class="px-2 py-0.5 border border-border text-muted-foreground hover:text-foreground">Cancel</button>
        <button onclick={submitDraft} disabled={!draft.trim()} class="px-2 py-0.5 bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40">Add comment</button>
      </div>
    </div>
  {/if}
{/snippet}

{#if lines.length > 0}
  {#if sideBySide}
    <div class="overflow-x-auto overflow-y-auto text-xs font-mono" style:max-height={maxHeight}>
      <table class="w-full border-collapse table-fixed">
        <colgroup>
          <col class="w-8" />
          <col class="w-[calc(50%-1rem)]" />
          <col class="w-8" />
          <col class="w-[calc(50%-1rem)]" />
        </colgroup>
        <tbody>
          {#each rows as row}
            {#if row.type === 'hunk'}
              <tr>
                <td colspan="4" class="text-cyan-400 bg-cyan-950/20 px-2 py-0.5">{row.hunkText}</td>
              </tr>
            {:else if row.type === 'expander'}
              {#if onExpand && row.gap}
                <tr><td colspan="4" class="p-0">{@render expander(row.gap)}</td></tr>
              {/if}
            {:else}
              {@const side: 'old' | 'new' = row.right ? 'new' : 'old'}
              {@const anchorNum = row.right ? row.right.lineNum : row.left?.lineNum}
              {@const anchorText = row.right ? row.right.text : row.left?.text ?? ''}
              {@const inRange = inComposerRange(side, anchorNum)}
              {#if row.type === 'context'}
                <tr class="group/line {inRange ? 'outline outline-1 outline-primary/60' : ''}">
                  <td class="w-8 text-right text-muted-foreground/40 pr-2 select-none align-top relative">{@render addButton(side, anchorNum, anchorText)}{row.left?.lineNum ?? ''}</td>
                  <td class="text-muted-foreground px-2 border-r border-border/30 whitespace-pre-wrap break-all align-top">{#if row.left}{@html hl(row.left.text)}{/if}</td>
                  <td class="w-8 text-right text-muted-foreground/40 pr-2 select-none align-top">{row.right?.lineNum ?? ''}</td>
                  <td class="text-muted-foreground px-2 whitespace-pre-wrap break-all align-top">{#if row.right}{@html hl(row.right.text)}{/if}</td>
                </tr>
              {:else}
                <tr class="group/line {inRange ? 'outline outline-1 outline-primary/60' : ''}">
                  <td class="w-8 text-right text-muted-foreground/40 pr-2 select-none align-top relative {row.left ? 'bg-red-950/30' : ''}">{@render addButton(side, anchorNum, anchorText)}{row.left?.lineNum ?? ''}</td>
                  <td class="diff-del px-2 border-r border-border/30 whitespace-pre-wrap break-all align-top {row.left ? 'bg-red-950/30 text-red-300' : ''}">{#if row.left}{@html hl(row.left.text, row.leftRanges)}{/if}</td>
                  <td class="w-8 text-right text-muted-foreground/40 pr-2 select-none align-top {row.right ? 'bg-green-950/30' : ''}">{row.right?.lineNum ?? ''}</td>
                  <td class="diff-add px-2 whitespace-pre-wrap break-all align-top {row.right ? 'bg-green-950/30 text-green-300' : ''}">{#if row.right}{@html hl(row.right.text, row.rightRanges)}{/if}</td>
                </tr>
              {/if}
              {#if commentsAt(side, anchorNum).length > 0 || composerAt(side, anchorNum)}
                <tr><td colspan="4" class="p-0">{@render commentCards(side, anchorNum)}{@render composerBox(side, anchorNum)}</td></tr>
              {/if}
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="overflow-x-auto overflow-y-auto text-xs font-mono" style:max-height={maxHeight}>
      {#each lines as line, idx}
        {#if line.type === 'hunk'}
          <div data-hunk="true" class="text-cyan-400 bg-cyan-950/20 px-2 py-0.5">{line.text}</div>
        {:else if line.type === 'expander'}
          {#if onExpand && line.gap}{@render expander(line.gap)}{/if}
        {:else if line.type === 'add' || line.type === 'del' || line.type === 'context'}
          {@const side: 'old' | 'new' = line.type === 'del' ? 'old' : 'new'}
          {@const num = line.type === 'del' ? (line.oldLineNum ?? line.lineNum) : (line.newLineNum ?? line.lineNum)}
          {@const inRange = inComposerRange(side, num)}
          {#if line.type === 'add'}
            <div class="group/line relative flex bg-green-950/30 text-green-300 px-2 diff-add {inRange ? 'outline outline-1 outline-primary/60' : ''}">
              {@render addButton(side, num, line.text)}
              <span class="shrink-0 w-8 text-right text-muted-foreground/40 mr-2 select-none">{num ?? ''}</span>
              <span class="shrink-0 text-green-500 select-none mr-1">+</span>
              <span class="flex-1 min-w-0 whitespace-pre-wrap break-all">{@html hl(line.text, intraline.get(idx))}</span>
            </div>
          {:else if line.type === 'del'}
            <div class="group/line relative flex bg-red-950/30 text-red-300 px-2 diff-del {inRange ? 'outline outline-1 outline-primary/60' : ''}">
              {@render addButton(side, num, line.text)}
              <span class="shrink-0 w-8 text-right text-muted-foreground/40 mr-2 select-none">{num ?? ''}</span>
              <span class="shrink-0 text-red-500 select-none mr-1">-</span>
              <span class="flex-1 min-w-0 whitespace-pre-wrap break-all">{@html hl(line.text, intraline.get(idx))}</span>
            </div>
          {:else}
            <div class="group/line relative flex text-muted-foreground px-2 {inRange ? 'outline outline-1 outline-primary/60' : ''}">
              {@render addButton(side, num, line.text)}
              <span class="shrink-0 w-8 text-right text-muted-foreground/40 mr-2 select-none">{num ?? ''}</span>
              <span class="shrink-0 select-none mr-1">&nbsp;</span>
              <span class="flex-1 min-w-0 whitespace-pre-wrap break-all">{@html hl(line.text)}</span>
            </div>
          {/if}
          {@render commentCards(side, num)}
          {@render composerBox(side, num)}
        {/if}
      {/each}
    </div>
  {/if}
{/if}

<style>
  /* Intraline marks: stronger tint of the line colour, no text colour change. */
  .diff-add :global(mark.diff-mark) { background-color: rgb(34 197 94 / 0.32); color: inherit; border-radius: 2px; }
  .diff-del :global(mark.diff-mark) { background-color: rgb(239 68 68 / 0.32); color: inherit; border-radius: 2px; }
</style>
