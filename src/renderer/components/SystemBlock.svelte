<script lang="ts">
  let { text, variant = 'info' }: { text: string; variant?: 'info' | 'warning' | 'error' } = $props();
</script>

{#if variant === 'error'}
  <div class="py-1 pl-3 border-l-4 border-destructive text-xs text-destructive">
    {text}
  </div>
{:else if variant === 'warning'}
  <div role="note" class="py-1 pl-3 border-l-4 border-amber-500 text-xs text-amber-500">
    {text}
  </div>
{:else}
  <div class="py-1 text-xs text-muted-foreground italic">
    {text}
  </div>
{/if}
