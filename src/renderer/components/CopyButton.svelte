<script lang="ts">
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

<button
  onclick={copy}
  class="inline-flex items-center justify-center size-6 p-1 transition-colors
    {copied ? 'text-green-400' : 'text-muted-foreground hover:text-foreground'}
    {className}"
  title={copied ? 'Copied!' : 'Copy'}
>
  {#if copied}
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
  {:else}
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
  {/if}
</button>
