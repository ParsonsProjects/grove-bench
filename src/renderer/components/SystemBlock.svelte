<script lang="ts">
  let { text, variant = 'info' }: { text: string; variant?: 'info' | 'error' } = $props();
</script>

{#if variant === 'error'}
  <div class="py-1 pl-3 border-l-4 border-red-400 text-xs text-red-400">
    {text}
  </div>
{:else}
  <div class="py-1 text-xs text-neutral-500 italic">
    {text}
  </div>
{/if}
