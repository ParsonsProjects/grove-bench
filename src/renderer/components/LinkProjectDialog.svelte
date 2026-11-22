<script lang="ts">
  /**
   * Work in Another Project (docs/linked-projects-plan.md): pick a git
   * project the open thread also works in from now on. Main makes a
   * worktree of it on the thread's branch name and restarts the agent on
   * the same conversation to take the folder, so it is refused mid-turn.
   * Opened from the thread row's menu and the branch popup
   * (linkedStore.openLinkDialog); mounted in App.
   */
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { menuItem } from '$lib/components/ui/menu/index.js';
  import { store } from '../stores/sessions.svelte.js';
  import { linkedStore } from '../stores/linked.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { backgroundShells, describeShells } from '../lib/background-shells.js';
  import { stripIpcErrorPrefix } from '$lib/mcp-errors.js';
  import { errorMessage } from '../../shared/error-message.js';

  let { sessionId }: { sessionId: string } = $props();

  let thread = $derived(store.sessions.find((s) => s.id === sessionId));
  let options = $derived(linkedStore.linkableFor(sessionId));
  let picked = $state<string | null>(null);
  let linking = $state(false);
  let error = $state('');
  /** Main's word on something that didn't stop the link (the install). */
  let warning = $state('');
  let linkedName = $state('');

  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let agent = $derived(agentsStore.get(thread?.agentType));
  /** Claude Code's adapter is the one known to take folders outside the
   *  project; another agent may not say it can until it starts. */
  let mayNotTakeFolders = $derived(!!agent && agent.capabilities.additionalDirectoryInstructions !== true);
  let shells = $derived(thread ? describeShells(backgroundShells(thread)) : null);

  function close() {
    linkedStore.linkDialogFor = null;
  }

  async function link() {
    if (!picked || linking || isRunning) return;
    linking = true;
    error = '';
    try {
      const name = store.repoDisplayName(picked);
      const said = await linkedStore.link(sessionId, picked);
      if (said) {
        // Stays open to say it, with Close.
        linkedName = name;
        warning = said;
      } else {
        close();
      }
    } catch (e) {
      error = stripIpcErrorPrefix(errorMessage(e));
    } finally {
      linking = false;
    }
  }
</script>

<Dialog.Root open={true} onOpenChange={(o) => { if (!o && !linking) close(); }}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>Work in another project</Dialog.Title>
      <Dialog.Description>
        The agent also works in the project you pick, through a worktree made for this thread on its branch name,
        <span class="text-foreground font-medium">{thread?.branch ?? ''}</span>. It's told where the worktree is,
        and edits to the project's own folder are refused.
      </Dialog.Description>
    </Dialog.Header>

    {#if warning}
      <Notice tone="warning" class="px-2 py-1.5" data-testid="link-warning">
        <p>The thread now works in {linkedName}, but: {warning}</p>
      </Notice>
      <Dialog.Footer>
        <Button variant="secondary" onclick={close}>Close</Button>
      </Dialog.Footer>
    {:else}
      {#if options.length === 0}
        <p class="text-sm text-muted-foreground">There's no other git project to link. Add one to Grove Bench first.</p>
      {:else}
        <div class="flex flex-col max-h-56 overflow-y-auto border border-border" role="listbox" aria-label="Projects">
          {#each options as repo (repo)}
            <button
              type="button"
              role="option"
              aria-selected={picked === repo}
              onclick={() => (picked = repo)}
              class={menuItem({ selected: picked === repo })}
              title={repo}
              disabled={linking}
            >
              <span class="truncate">{store.repoDisplayName(repo)}</span>
            </button>
          {/each}
        </div>
      {/if}

      <ul class="text-xs text-muted-foreground space-y-1 mt-1">
        <li data-testid="link-restart-note">
          The agent restarts on this thread to take the new folder, and keeps the conversation{#if shells}. The {shells.summary} it left running may stop{/if}.
        </li>
        {#if mayNotTakeFolders}
          <li>{agent?.displayName ?? 'This agent'} is told where the worktree is, but may not be able to edit there.</li>
        {/if}
      </ul>

      {#if isRunning}
        <p class="text-xs text-amber-500" role="alert" data-testid="link-mid-turn">Link a project once the agent finishes this turn.</p>
      {/if}
      {#if error}
        <p class="text-xs text-destructive" role="alert">{error}</p>
      {/if}

      <Dialog.Footer>
        <Button variant="secondary" onclick={close} disabled={linking}>Cancel</Button>
        <Button onclick={link} disabled={!picked || linking || isRunning} class="disabled:cursor-not-allowed">
          {linking ? 'Linking…' : 'Link'}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
