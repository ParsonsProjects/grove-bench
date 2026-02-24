<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';

  let { requestId, toolName, input, resolved, allowed, sessionId }: {
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
    resolved: boolean;
    allowed?: boolean;
    sessionId: string;
  } = $props();

  function handleAllow() {
    window.groveBench.respondPermission(requestId, true);
    store.resolvePermission(sessionId, requestId, true);
  }

  function handleDeny() {
    window.groveBench.respondPermission(requestId, false);
    store.resolvePermission(sessionId, requestId, false);
  }

  function formatInput(obj: Record<string, unknown>): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }
</script>

<div class="border rounded-lg overflow-hidden my-2
  {resolved
    ? allowed ? 'border-green-700/50 bg-green-900/10' : 'border-red-700/50 bg-red-900/10'
    : 'border-yellow-600/50 bg-yellow-900/10'}">
  <div class="flex items-center justify-between px-3 py-2">
    <div class="flex items-center gap-2">
      <span class="text-yellow-500 text-xs">
        {#if resolved}
          {allowed ? 'Allowed' : 'Denied'}
        {:else}
          Permission Request
        {/if}
      </span>
      <span class="text-neutral-300 font-mono text-xs">{toolName}</span>
    </div>
    {#if !resolved}
      <div class="flex gap-2">
        <button
          onclick={handleAllow}
          class="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-xs transition-colors"
        >
          Allow
        </button>
        <button
          onclick={handleDeny}
          class="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-xs transition-colors"
        >
          Deny
        </button>
      </div>
    {/if}
  </div>
  {#if Object.keys(input).length > 0}
    <div class="px-3 py-2 border-t border-neutral-700/50">
      <pre class="text-xs text-neutral-400 whitespace-pre-wrap font-mono overflow-x-auto">{formatInput(input)}</pre>
    </div>
  {/if}
</div>
