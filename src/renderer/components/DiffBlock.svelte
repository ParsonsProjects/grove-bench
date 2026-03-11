<script lang="ts">
  import { createPatch } from 'diff';

  let {
    toolName,
    toolInput,
    result,
    pending,
    isError,
  }: {
    toolName: string;
    toolInput: unknown;
    result?: string;
    pending: boolean;
    isError?: boolean;
  } = $props();

  let input = $derived(toolInput as Record<string, unknown>);
  let filePath = $derived(String(input?.file_path ?? input?.filePath ?? 'file'));

  let diffLines = $derived.by(() => {
    if (pending) return [];

    if (toolName === 'Edit') {
      const oldStr = String(input?.old_string ?? '');
      const newStr = String(input?.new_string ?? '');
      if (!oldStr && !newStr) return [];
      const patch = createPatch(filePath, oldStr, newStr, '', '', { context: 3 });
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
  });

  interface DiffLine {
    type: 'add' | 'del' | 'context' | 'hunk' | 'header';
    text: string;
    lineNum?: number;
  }

  function parseDiffLines(patch: string): DiffLine[] {
    const lines = patch.split('\n');
    const result: DiffLine[] = [];
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:') || line.startsWith('====')) {
        continue;
      }
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)/);
        if (match) oldLine = parseInt(match[1], 10);
        const match2 = line.match(/\+(\d+)/);
        if (match2) newLine = parseInt(match2[1], 10);
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
</script>

<div class="py-1 my-1 border-l-4 border-primary pl-3">
  <!-- Header -->
  <div class="flex items-center gap-2 text-xs mb-1">
    <span class="text-primary font-bold">{toolName === 'Write' ? '+ new file' : 'edit'}</span>
    <span class="text-foreground/80">{filePath}</span>
    {#if pending}
      <span class="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0"></span>
    {:else if isError}
      <span class="text-destructive">error</span>
    {/if}
  </div>

  <!-- Diff lines -->
  {#if diffLines.length > 0}
    <div class="overflow-x-auto max-h-[400px] overflow-y-auto text-xs font-mono">
      {#each diffLines as line}
        {#if line.type === 'hunk'}
          <div class="text-cyan-400 bg-cyan-950/20 px-2 py-0.5">{line.text}</div>
        {:else if line.type === 'add'}
          <div class="bg-green-950/30 text-green-300 px-2">
            <span class="inline-block w-8 text-right text-muted-foreground/40 mr-2 select-none">{line.lineNum ?? ''}</span>
            <span class="text-green-500 select-none">+</span> {line.text}
          </div>
        {:else if line.type === 'del'}
          <div class="bg-red-950/30 text-red-300 px-2">
            <span class="inline-block w-8 text-right text-muted-foreground/40 mr-2 select-none">{line.lineNum ?? ''}</span>
            <span class="text-red-500 select-none">-</span> {line.text}
          </div>
        {:else}
          <div class="text-muted-foreground px-2">
            <span class="inline-block w-8 text-right text-muted-foreground/40 mr-2 select-none">{line.lineNum ?? ''}</span>
            <span class="select-none">&nbsp;</span> {line.text}
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if isError && result}
    <div class="text-xs text-destructive mt-1">{result}</div>
  {/if}
</div>
