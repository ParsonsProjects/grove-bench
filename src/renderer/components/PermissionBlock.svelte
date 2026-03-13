<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import DiffView, { computeDiffLines } from './DiffView.svelte';

  let {
    sessionId,
    requestId,
    toolName,
    toolInput,
    resolved,
    decision,
  }: {
    sessionId: string;
    requestId: string;
    toolName: string;
    toolInput: unknown;
    resolved: boolean;
    decision?: 'allow' | 'deny';
  } = $props();

  let expanded = $state(false);
  let sideBySide = $state(false);

  let input = $derived(toolInput as Record<string, unknown>);
  let isEditTool = $derived(toolName === 'Edit' || toolName === 'Write');
  let isBashTool = $derived(toolName === 'Bash');
  let filePath = $derived(isEditTool ? String(input?.file_path ?? input?.filePath ?? '') : '');
  let bashCommand = $derived(isBashTool ? String(input?.command ?? '') : '');
  let diffLines = $derived(isEditTool ? computeDiffLines(toolName, input, filePath) : []);

  function approve() {
    messageStore.resolvePermission(sessionId, requestId, 'allow');
  }

  function approveAlways() {
    messageStore.resolvePermission(sessionId, requestId, 'allowAlways');
  }

  function deny() {
    messageStore.resolvePermission(sessionId, requestId, 'deny');
  }

  function openInEditor() {
    if (filePath) {
      window.groveBench.openInEditor(sessionId, filePath).catch(() => {});
    }
  }

  function formatInput(inp: unknown): string {
    if (typeof inp === 'string') return inp;
    try { return JSON.stringify(inp, null, 2); }
    catch { return String(inp); }
  }

  function summarizeInput(inp: unknown): string {
    if (typeof inp !== 'object' || inp === null) return '';
    const obj = inp as Record<string, unknown>;
    if (obj.file_path) return String(obj.file_path);
    if (obj.command) return String(obj.command).slice(0, 80);
    return '';
  }

  let borderColor = $derived(
    resolved
      ? (decision === 'allow' ? 'border-green-400' : 'border-destructive')
      : 'border-yellow-400'
  );
</script>

<div class="py-1 my-1 border-l-4 {borderColor} pl-3">
  <div class="flex items-center gap-2 text-xs">
    <span class="text-yellow-400 font-bold">permission</span>
    <span class="text-foreground">{toolName}</span>
    {#if filePath}
      <button
        onclick={openInEditor}
        class="text-muted-foreground hover:text-primary hover:underline cursor-pointer truncate flex-1 text-left"
        title="Open in editor"
      >{filePath}</button>
    {:else if !isBashTool}
      <span class="text-muted-foreground truncate flex-1">{summarizeInput(toolInput)}</span>
    {/if}
    {#if !resolved && isEditTool && diffLines.length > 0 && toolName === 'Edit'}
      <button
        onclick={() => sideBySide = !sideBySide}
        class="text-xs text-muted-foreground hover:text-foreground select-none shrink-0"
      >
        {sideBySide ? 'unified' : 'side-by-side'}
      </button>
    {/if}
  </div>

  <!-- Command preview for Bash -->
  {#if isBashTool && bashCommand}
    <pre class="text-xs text-foreground bg-card/80 border border-border px-3 py-2 mt-1 overflow-x-auto max-h-32 overflow-y-auto font-mono whitespace-pre-wrap break-all">{bashCommand}</pre>
  {/if}

  <!-- Inline diff preview for Edit/Write (only while awaiting approval) -->
  {#if !resolved && isEditTool && diffLines.length > 0}
    <div class="mt-1">
      <DiffView lines={diffLines} {sideBySide} maxHeight="200px" />
    </div>
  {/if}

  {#if !isEditTool && !isBashTool}
    <button
      onclick={() => expanded = !expanded}
      class="text-xs text-muted-foreground hover:text-foreground mt-1"
    >
      {expanded ? 'hide' : 'show'} details
    </button>

    {#if expanded}
      <pre class="text-xs text-muted-foreground bg-card p-2 overflow-x-auto max-h-40 overflow-y-auto mt-1">{formatInput(toolInput)}</pre>
    {/if}
  {/if}

  {#if resolved}
    <div class="text-xs mt-1 {decision === 'allow' ? 'text-green-400' : 'text-destructive'}">
      {decision === 'allow' ? 'allowed' : 'denied'}
    </div>
  {:else}
    <div class="flex gap-2 mt-2">
      <Button variant="outline" size="sm" onclick={approve} class="text-green-400 border-green-600 hover:bg-green-900/30">
        Allow
      </Button>
      <Button variant="outline" size="sm" onclick={approveAlways} class="text-green-400 border-green-600 hover:bg-green-900/30">
        Always Allow
      </Button>
      <Button variant="outline" size="sm" onclick={deny} class="text-destructive border-destructive hover:bg-destructive/10">
        Deny
      </Button>
    </div>
  {/if}
</div>
