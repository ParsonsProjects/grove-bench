<script lang="ts">
  let { name, input }: { name: string; input: string } = $props();

  let collapsed = $state(true);

  function formatInput(raw: string): string {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
</script>

<div class="border border-neutral-700 rounded-lg overflow-hidden my-2">
  <button
    onclick={() => collapsed = !collapsed}
    class="w-full flex items-center gap-2 px-3 py-2 text-sm bg-neutral-800/50 hover:bg-neutral-800 transition-colors text-left"
  >
    <span class="text-neutral-500 text-xs shrink-0">{collapsed ? '\u25B6' : '\u25BC'}</span>
    <span class="text-blue-400 font-mono text-xs truncate">{name}</span>
  </button>
  {#if !collapsed && input}
    <div class="px-3 py-2 bg-neutral-900 border-t border-neutral-700">
      <pre class="text-xs text-neutral-300 whitespace-pre-wrap font-mono overflow-x-auto">{formatInput(input)}</pre>
    </div>
  {/if}
</div>
