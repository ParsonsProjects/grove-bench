<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils.js';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import CheckIcon from '@lucide/svelte/icons/check';

  let {
    text,
    class: className = '',
  }: {
    text: string;
    class?: string;
  } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { copied = false; }, 1500);
    } catch {
      // clipboard write failed silently
    }
  }
</script>

<Button
  variant="quiet"
  size="icon-xs"
  onclick={copy}
  class={cn(copied && 'text-green-400 hover:text-green-400', className)}
  title={copied ? 'Copied!' : 'Copy'}
>
  {#if copied}
    <CheckIcon />
  {:else}
    <CopyIcon />
  {/if}
</Button>
