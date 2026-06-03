<script lang="ts">
  import type { ImageDiffContent } from '../../shared/types.js';

  let { sessionId, filePath }: { sessionId: string; filePath: string } = $props();

  let content = $state<ImageDiffContent | null>(null);
  let loading = $state(true);

  $effect(() => {
    const sid = sessionId;
    const fp = filePath;
    let stale = false;
    loading = true;
    content = null;
    window.groveBench
      .getImageDiffContent(sid, fp)
      .then(c => { if (!stale) content = c; })
      .catch(() => { if (!stale) content = { working: null, head: null }; })
      .finally(() => { if (!stale) loading = false; });
    return () => { stale = true; };
  });
</script>

{#if loading}
  <div class="text-xs text-muted-foreground py-3 px-2">Loading image preview…</div>
{:else if content && (content.working || content.head)}
  <div class="flex flex-wrap gap-4 py-2">
    {#if content.head}
      <div class="flex flex-col gap-1">
        <span class="text-[10px] uppercase tracking-wide text-red-400">Before</span>
        <img src={content.head} alt="previous version" class="max-w-xs max-h-80 border border-red-900/40 bg-[repeating-conic-gradient(#222_0_25%,#1a1a1a_0_50%)] bg-[length:16px_16px]" />
      </div>
    {/if}
    {#if content.working}
      <div class="flex flex-col gap-1">
        <span class="text-[10px] uppercase tracking-wide text-green-400">{content.head ? 'After' : 'Added'}</span>
        <img src={content.working} alt="current version" class="max-w-xs max-h-80 border border-green-900/40 bg-[repeating-conic-gradient(#222_0_25%,#1a1a1a_0_50%)] bg-[length:16px_16px]" />
      </div>
    {:else if content.head}
      <div class="flex flex-col gap-1">
        <span class="text-[10px] uppercase tracking-wide text-muted-foreground">Deleted</span>
        <div class="max-w-xs max-h-80 px-4 py-8 text-xs text-muted-foreground border border-border/50">File removed</div>
      </div>
    {/if}
  </div>
{:else}
  <div class="text-xs text-muted-foreground py-3 px-2">Image preview unavailable.</div>
{/if}
