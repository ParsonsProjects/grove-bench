<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { store } from '../stores/sessions.svelte.js';

  /**
   * A folder picked as a project that isn't a git repository. Git gives each
   * conversation its own copy and lets its edits be rewound, so setting it up
   * is offered first; using the folder as it is stays possible.
   */
  let busy = $state(false);
  let error = $state('');

  let pending = $derived(store.pendingFolder);

  function close() {
    store.pendingFolder = null;
    error = '';
    busy = false;
  }

  async function setUpGit() {
    if (!pending || busy) return;
    busy = true;
    error = '';
    try {
      const result = await window.groveBench.initGitRepo(pending.path);
      if (result.ok) {
        store.addRepo(pending.path, { folder: false });
        close();
      } else {
        error = result.error;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function useWithoutGit() {
    if (!pending) return;
    store.addRepo(pending.path, { folder: true });
    close();
  }
</script>

<Dialog.Root open={!!pending} onOpenChange={(o) => { if (!o) close(); }}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>This folder isn't a git repository</Dialog.Title>
      <Dialog.Description>
        <span class="font-mono text-foreground break-all">{pending?.path}</span>
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3 mt-2">
      <section class="border border-border p-3 flex flex-col gap-2" aria-label="Set up git here">
        <p class="text-sm text-foreground">Set up git here <span class="text-xs text-muted-foreground">(recommended)</span></p>
        <p class="text-xs text-muted-foreground">
          Runs <code class="text-foreground">git init</code> and commits the folder's files as a first commit. Each
          conversation then works on its own branch in a separate copy, and its edits can be rewound. Files listed in a
          .gitignore are left out, so check there's nothing here you wouldn't commit, such as passwords or keys.
        </p>
        {#if pending?.gitAvailable}
          <Button size="sm" class="self-start" onclick={setUpGit} disabled={busy}>
            {busy ? 'Setting up…' : 'Set up git'}
          </Button>
        {:else}
          <p class="text-xs text-yellow-500">Git isn't installed, so it can't be set up here yet.</p>
          <button
            type="button"
            class="self-start text-xs text-primary hover:underline"
            onclick={() => window.groveBench.openExternal('https://git-scm.com/downloads')}
          >
            Download Git
          </button>
        {/if}
      </section>

      <section class="border border-border p-3 flex flex-col gap-2" aria-label="Use without git">
        <p class="text-sm text-foreground">Use without git</p>
        <p class="text-xs text-muted-foreground">
          Conversations work in this folder directly: the agent edits your files in place, and its edits can't be
          rewound. The Changes and Checkpoints tabs aren't available.
        </p>
        <Button size="sm" variant="outline" class="self-start" onclick={useWithoutGit} disabled={busy}>
          Use without git
        </Button>
      </section>

      {#if error}
        <div class="p-2 text-xs border bg-destructive/10 border-destructive/50 text-destructive" role="alert">{error}</div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="secondary" onclick={close} disabled={busy}>Cancel</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
