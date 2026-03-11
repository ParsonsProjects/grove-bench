<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';

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

  function approve() {
    messageStore.resolvePermission(sessionId, requestId, 'allow');
  }

  function deny() {
    messageStore.resolvePermission(sessionId, requestId, 'deny');
  }

  function formatInput(input: unknown): string {
    if (typeof input === 'string') return input;
    try { return JSON.stringify(input, null, 2); }
    catch { return String(input); }
  }

  function summarizeInput(input: unknown): string {
    if (typeof input !== 'object' || input === null) return '';
    const obj = input as Record<string, unknown>;
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
    <span class="text-muted-foreground truncate flex-1">{summarizeInput(toolInput)}</span>
  </div>

  <button
    onclick={() => expanded = !expanded}
    class="text-xs text-muted-foreground hover:text-foreground mt-1"
  >
    {expanded ? 'hide' : 'show'} details
  </button>

  {#if expanded}
    <pre class="text-xs text-muted-foreground bg-card p-2 overflow-x-auto max-h-40 overflow-y-auto mt-1">{formatInput(toolInput)}</pre>
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
      <Button variant="outline" size="sm" onclick={deny} class="text-destructive border-destructive hover:bg-destructive/10">
        Deny
      </Button>
    </div>
  {/if}
</div>
