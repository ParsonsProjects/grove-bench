<script lang="ts">
  import { messageStore } from '../stores/messages.svelte.js';

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
      ? (decision === 'allow' ? 'border-green-400' : 'border-red-400')
      : 'border-yellow-400'
  );
</script>

<div class="py-1 my-1 border-l-4 {borderColor} pl-3">
  <div class="flex items-center gap-2 text-xs">
    <span class="text-yellow-400 font-bold">permission</span>
    <span class="text-neutral-200">{toolName}</span>
    <span class="text-neutral-500 truncate flex-1">{summarizeInput(toolInput)}</span>
  </div>

  <button
    onclick={() => expanded = !expanded}
    class="text-xs text-neutral-500 hover:text-neutral-300 mt-1"
  >
    {expanded ? 'hide' : 'show'} details
  </button>

  {#if expanded}
    <pre class="text-xs text-neutral-400 bg-neutral-900 p-2 overflow-x-auto max-h-40 overflow-y-auto mt-1">{formatInput(toolInput)}</pre>
  {/if}

  {#if resolved}
    <div class="text-xs mt-1 {decision === 'allow' ? 'text-green-400' : 'text-red-400'}">
      {decision === 'allow' ? 'allowed' : 'denied'}
    </div>
  {:else}
    <div class="flex gap-2 mt-2">
      <button
        onclick={approve}
        class="px-3 py-1 border border-green-600 hover:bg-green-900/30 text-xs text-green-400 transition-colors"
      >
        Allow
      </button>
      <button
        onclick={deny}
        class="px-3 py-1 border border-red-600 hover:bg-red-900/30 text-xs text-red-400 transition-colors"
      >
        Deny
      </button>
    </div>
  {/if}
</div>
