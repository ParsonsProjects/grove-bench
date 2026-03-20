<script lang="ts" module>
  export interface DiffLine {
    type: 'add' | 'del' | 'context' | 'hunk' | 'header';
    text: string;
    lineNum?: number;
  }

  export interface SideBySideRow {
    type: 'context' | 'change' | 'hunk';
    left?: { lineNum?: number; text: string };
    right?: { lineNum?: number; text: string };
    hunkText?: string;
  }

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
      if (line.type === 'context') {
        rows.push({
          type: 'context',
          left: { lineNum: line.lineNum, text: line.text },
          right: { lineNum: line.lineNum, text: line.text },
        });
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < diffLines.length && diffLines[i].type === 'del') { dels.push(diffLines[i]); i++; }
      while (i < diffLines.length && diffLines[i].type === 'add') { adds.push(diffLines[i]); i++; }
      const maxLen = Math.max(dels.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          type: 'change',
          left: dels[j] ? { lineNum: dels[j].lineNum, text: dels[j].text } : undefined,
          right: adds[j] ? { lineNum: adds[j].lineNum, text: adds[j].text } : undefined,
        });
      }
    }
    return rows;
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
        const m1 = line.match(/@@ -(\d+)/);
        if (m1) oldLine = parseInt(m1[1], 10);
        const m2 = line.match(/\+(\d+)/);
        if (m2) newLine = parseInt(m2[1], 10);
        result.push({ type: 'hunk', text: line });
        continue;
      }
      if (line.startsWith('+')) {
        result.push({ type: 'add', text: line.slice(1), lineNum: newLine++ });
      } else if (line.startsWith('-')) {
        result.push({ type: 'del', text: line.slice(1), lineNum: oldLine++ });
      } else if (line.startsWith(' ')) {
        result.push({ type: 'context', text: line.slice(1), lineNum: newLine });
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
  let {
    lines,
    sideBySide = false,
    maxHeight = '400px',
  }: {
    lines: DiffLine[];
    sideBySide?: boolean;
    maxHeight?: string;
  } = $props();

  let rows = $derived(sideBySide ? buildSideBySideRows(lines) : []);
</script>

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
            {:else if row.type === 'context'}
              <tr>
                <td class="w-8 text-right text-muted-foreground/40 pr-2 select-none align-top">{row.left?.lineNum ?? ''}</td>
                <td class="text-muted-foreground px-2 border-r border-border/30 whitespace-pre">{row.left?.text ?? ''}</td>
                <td class="w-8 text-right text-muted-foreground/40 pr-2 select-none align-top">{row.right?.lineNum ?? ''}</td>
                <td class="text-muted-foreground px-2 whitespace-pre">{row.right?.text ?? ''}</td>
              </tr>
            {:else}
              <tr>
                <td class="w-8 text-right text-muted-foreground/40 pr-2 select-none align-top {row.left ? 'bg-red-950/30' : ''}">{row.left?.lineNum ?? ''}</td>
                <td class="px-2 border-r border-border/30 whitespace-pre {row.left ? 'bg-red-950/30 text-red-300' : ''}">{row.left?.text ?? ''}</td>
                <td class="w-8 text-right text-muted-foreground/40 pr-2 select-none align-top {row.right ? 'bg-green-950/30' : ''}">{row.right?.lineNum ?? ''}</td>
                <td class="px-2 whitespace-pre {row.right ? 'bg-green-950/30 text-green-300' : ''}">{row.right?.text ?? ''}</td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="overflow-x-auto overflow-y-auto text-xs font-mono" style:max-height={maxHeight}>
      {#each lines as line}
        {#if line.type === 'hunk'}
          <div class="text-cyan-400 bg-cyan-950/20 px-2 py-0.5">{line.text}</div>
        {:else if line.type === 'add'}
          <div class="bg-green-950/30 text-green-300 px-2 whitespace-pre">
            <span class="inline-block w-8 text-right text-muted-foreground/40 mr-2 select-none">{line.lineNum ?? ''}</span>
            <span class="text-green-500 select-none">+</span> {line.text}
          </div>
        {:else if line.type === 'del'}
          <div class="bg-red-950/30 text-red-300 px-2 whitespace-pre">
            <span class="inline-block w-8 text-right text-muted-foreground/40 mr-2 select-none">{line.lineNum ?? ''}</span>
            <span class="text-red-500 select-none">-</span> {line.text}
          </div>
        {:else}
          <div class="text-muted-foreground px-2 whitespace-pre">
            <span class="inline-block w-8 text-right text-muted-foreground/40 mr-2 select-none">{line.lineNum ?? ''}</span>
            <span class="select-none">&nbsp;</span> {line.text}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
{/if}
