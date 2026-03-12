<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';

  let checking = $state(true);
  let errors = $state<string[]>([]);

  async function runCheck() {
    checking = true;
    errors = [];
    const status = await window.groveBench.checkPrerequisites();
    store.prerequisites = status;
    const errs: string[] = [];

    if (!status.git.available) {
      errs.push('Git is not installed. Download from https://git-scm.com');
    } else if (!status.git.meetsMinimum) {
      errs.push(`Git version too old (${status.git.version}). Need 2.17+.`);
    }

    if (!status.claudeCode.available) {
      errs.push('Claude Code not found. Install with: npm install -g @anthropic-ai/claude-code');
    } else if (!status.claudeCode.authenticated) {
      errs.push('Claude Code is not authenticated. Run "claude auth login" in your terminal to sign in.');
    }

    errors = errs;
    checking = false;
  }

  onMount(() => {
    runCheck();
  });

  const hasErrors = $derived(errors.length > 0);
</script>

{#if checking}
  <div class="fixed inset-0 bg-background flex items-center justify-center z-50">
    <div class="text-center">
      <div class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
      <p class="text-muted-foreground">Checking prerequisites...</p>
    </div>
  </div>
{:else if hasErrors}
  <div class="fixed inset-0 bg-background/95 flex items-center justify-center z-50">
    <div class="bg-card border border-border p-8 max-w-md">
      <h2 class="text-lg font-semibold text-destructive mb-4">Prerequisites Missing</h2>
      <ul class="flex flex-col gap-3">
        {#each errors as err}
          <li class="text-sm text-foreground/80 flex gap-2">
            <span class="text-destructive shrink-0">&#x2717;</span>
            {err}
          </li>
        {/each}
      </ul>
      <p class="text-xs text-muted-foreground mt-6 mb-4">Fix the issues above, then re-check.</p>
      <button
        class="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded transition-colors"
        onclick={runCheck}
      >
        Re-check
      </button>
    </div>
  </div>
{/if}
