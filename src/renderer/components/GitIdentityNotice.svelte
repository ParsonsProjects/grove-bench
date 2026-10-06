<script lang="ts">
  import CopyButton from './CopyButton.svelte';

  /** Shown on the new conversation screen, before there is a conversation. */
  let { beforeStart = false }: { beforeStart?: boolean } = $props();

  // Placeholders: the user swaps in their own name and email before running.
  const commands = [
    'git config --global user.name "Your Name"',
    'git config --global user.email "you@example.com"',
  ];
</script>

<div class="my-1 px-3 py-2 text-xs border-l-4 border-yellow-500 bg-yellow-500/10" role="note">
  <p class="text-foreground/80">
    Git doesn't have your name and email for this project, so it will likely refuse the agent's commits.
    {#if beforeStart}
      Run these in a terminal with your own details, before or after you start.
    {:else}
      Run these in a terminal with your own details. There's no need to restart the thread.
    {/if}
  </p>
  <ul class="mt-1.5 space-y-0.5">
    {#each commands as command (command)}
      <li class="flex items-center gap-2">
        <code class="flex-1 min-w-0 truncate font-mono text-foreground">{command}</code>
        <CopyButton text={command} />
      </li>
    {/each}
  </ul>
  <p class="mt-1 text-muted-foreground">Leave out <code class="font-mono">--global</code> to set them for this project only.</p>
</div>
