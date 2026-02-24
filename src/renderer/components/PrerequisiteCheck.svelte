<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';

  let checking = $state(true);
  let errors = $state<string[]>([]);

  onMount(() => {
    window.groveBench.checkPrerequisites().then((status) => {
      store.prerequisites = status;
      const errs: string[] = [];

      if (!status.git.available) {
        errs.push('Git is not installed. Download from https://git-scm.com');
      } else if (!status.git.meetsMinimum) {
        errs.push(`Git version too old (${status.git.version}). Need 2.17+.`);
      }

      if (!status.claudeCode.available) {
        errs.push('Claude Code not found. Install with: npm install -g @anthropic-ai/claude-code');
      }

      errors = errs;
      checking = false;
    });
  });

  const hasErrors = $derived(errors.length > 0);
</script>

{#if checking}
  <div class="fixed inset-0 bg-neutral-950 flex items-center justify-center z-50">
    <div class="text-center">
      <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
      <p class="text-neutral-400">Checking prerequisites...</p>
    </div>
  </div>
{:else if hasErrors}
  <div class="fixed inset-0 bg-neutral-950/95 flex items-center justify-center z-50">
    <div class="bg-neutral-900 border border-neutral-700 rounded-lg p-8 max-w-md">
      <h2 class="text-lg font-semibold text-red-400 mb-4">Prerequisites Missing</h2>
      <ul class="flex flex-col gap-3">
        {#each errors as err}
          <li class="text-sm text-neutral-300 flex gap-2">
            <span class="text-red-500 shrink-0">&#x2717;</span>
            {err}
          </li>
        {/each}
      </ul>
      <p class="text-xs text-neutral-500 mt-6">Fix the issues above and restart Grove Bench.</p>
    </div>
  </div>
{/if}
