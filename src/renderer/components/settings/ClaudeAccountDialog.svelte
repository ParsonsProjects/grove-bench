<script lang="ts">
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { agentsStore } from '../../stores/agents.svelte.js';
  import { prerequisitesStore } from '../../stores/prerequisites.svelte.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { stripIpcErrorPrefix } from '$lib/mcp-errors.js';
  import type { ClaudeAccountPreview } from '../../../shared/types.js';

  /** Add another Claude account as its own agent. Opened from the Claude
   *  agent's Add account button. The main process checks the name and folder
   *  and registers the agent; this saves the entry like any other setting. */
  let { onclose, onadded }: {
    onclose: () => void;
    /** The new agent's id, once it is registered and saved. */
    onadded: (adapterId: string) => void;
  } = $props();

  let open = $state(true);
  let nameInput = $state<HTMLInputElement | null>(null);
  let name = $state('');
  let folder = $state('');
  let preview = $state<ClaudeAccountPreview | null>(null);
  let adding = $state(false);
  let addError = $state<string | null>(null);

  // Ask main which folder the account would use, after a pause in typing.
  let previewRequest = 0;
  $effect(() => {
    const input = { name, configDir: folder };
    const request = ++previewRequest;
    addError = null;
    if (!input.name.trim()) {
      preview = null;
      return;
    }
    const timer = setTimeout(() => {
      window.groveBench.previewClaudeAccount(input)
        .then((p) => { if (request === previewRequest) preview = p; })
        .catch(() => { if (request === previewRequest) preview = null; });
    }, 150);
    return () => clearTimeout(timer);
  });

  const canAdd = $derived(!!name.trim() && preview?.ok === true && !adding);

  function close() {
    open = false;
    onclose();
  }

  async function add() {
    if (!canAdd) return;
    adding = true;
    addError = null;
    try {
      const { setting, adapterId } = await window.groveBench.addClaudeAccount({ name, configDir: folder });
      settingsStore.addClaudeAccount(setting);
      await settingsStore.save();
      if (settingsStore.error) throw new Error(settingsStore.error);
      await agentsStore.refresh();
      void prerequisitesStore.refresh();
      onadded(adapterId);
      close();
    } catch (e) {
      addError = stripIpcErrorPrefix(e instanceof Error ? e.message : String(e));
    } finally {
      adding = false;
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) close(); }}>
  <Dialog.Content
    class="sm:max-w-lg"
    onOpenAutoFocus={(e) => { e.preventDefault(); nameInput?.focus(); }}
  >
    <Dialog.Header>
      <Dialog.Title>Add a Claude account</Dialog.Title>
      <Dialog.Description>
        Use another Claude plan or API key next to your first one, such as work next to personal. It shows up as its own agent for new threads, with its own sign-in, thread history, MCP servers and plugins.
      </Dialog.Description>
    </Dialog.Header>

    <form class="flex flex-col gap-4" onsubmit={(e) => { e.preventDefault(); void add(); }}>
      <div class="flex flex-col gap-1.5">
        <Label for="claude-account-name">Name</Label>
        <Input id="claude-account-name" type="text" placeholder="e.g. Work" maxlength={40} bind:value={name} bind:ref={nameInput} />
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="claude-account-folder">Folder <span class="font-normal text-muted-foreground">(optional)</span></Label>
        <Input id="claude-account-folder" type="text" spellcheck={false} placeholder="Leave empty for .claude-<name> in your home folder" bind:value={folder} />
        <p class="text-xs text-muted-foreground" data-testid="claude-account-folder-help">
          {#if preview?.ok}
            Uses <code class="text-foreground break-all">{preview.configDir}</code>. If you already use this folder with Claude Code, its sign-in and history carry over.
          {:else if preview && !preview.ok}
            <span class="text-destructive" role="alert">{preview.error}</span>
          {:else}
            Claude Code keeps the account's sign-in, history and settings in this folder.
          {/if}
        </p>
      </div>
      {#if addError}
        <Notice tone="danger"><p class="whitespace-pre-wrap">{addError}</p></Notice>
      {/if}
      <Dialog.Footer>
        <Button type="button" variant="secondary" onclick={close}>Cancel</Button>
        <Button type="submit" disabled={!canAdd}>{adding ? 'Adding...' : 'Add account'}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
