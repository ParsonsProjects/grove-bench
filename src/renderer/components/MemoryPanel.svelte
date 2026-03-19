<script lang="ts">
  import { memoryStore } from '../stores/memory.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  let editContent = $state('');
  let isEditing = $state(false);
  let showNewFile = $state(false);
  let newFilePath = $state('');
  let newFileFolder = $state('repo');
  let confirmDeletePath = $state<string | null>(null);

  const folders = ['repo', 'conventions', 'architecture', 'sessions'];

  $effect(() => {
    if (open && store.repos.length > 0) {
      if (!memoryStore.activeRepo || !store.repos.includes(memoryStore.activeRepo)) {
        memoryStore.loadForRepo(store.repos[0]);
      } else {
        memoryStore.loadForRepo(memoryStore.activeRepo);
      }
    }
  });

  function selectFile(path: string) {
    isEditing = false;
    memoryStore.readFile(path);
  }

  function startEdit() {
    if (memoryStore.selectedFile) {
      editContent = memoryStore.selectedFile.content;
      isEditing = true;
    }
  }

  async function saveEdit() {
    if (memoryStore.selectedFile) {
      await memoryStore.writeFile(memoryStore.selectedFile.path, editContent);
      isEditing = false;
    }
  }

  function cancelEdit() {
    isEditing = false;
  }

  function openNewFile() {
    newFilePath = '';
    newFileFolder = 'repo';
    showNewFile = true;
  }

  async function createNewFile() {
    const name = newFilePath.trim().replace(/\.md$/, '');
    if (!name) return;
    const fullPath = `${newFileFolder}/${name}.md`;
    const now = new Date().toISOString();
    const content = `---\ntitle: "${name}"\nupdatedAt: "${now}"\n---\n\n`;
    await memoryStore.writeFile(fullPath, content);
    showNewFile = false;
    selectFile(fullPath);
  }

  async function confirmDelete() {
    if (confirmDeletePath) {
      await memoryStore.deleteFile(confirmDeletePath);
      confirmDeletePath = null;
    }
  }

  function switchRepo(repoPath: string) {
    memoryStore.loadForRepo(repoPath);
  }
</script>

<Dialog.Root {open} onOpenChange={(o) => { if (!o) onclose(); }}>
  <Dialog.Content class="sm:max-w-4xl max-h-[90vh] flex flex-col">
    <Dialog.Header>
      <Dialog.Title>Project Memory</Dialog.Title>
      <Dialog.Description>
        Persistent notes about your project that the agent can read and write.
      </Dialog.Description>
    </Dialog.Header>

    <!-- Repo selector -->
    {#if store.repos.length > 1}
      <div class="mb-2">
        <Label class="mb-1 block">Repository</Label>
        <Select.Root type="single" value={memoryStore.activeRepo ?? ''} onValueChange={(v) => { if (v) switchRepo(v); }}>
          <Select.Trigger class="w-full">
            {memoryStore.activeRepo?.split(/[/\\]/).pop() ?? 'Select repo'}
          </Select.Trigger>
          <Select.Content>
            {#each store.repos as repo}
              <Select.Item value={repo} label={repo.split(/[/\\]/).pop() ?? repo} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {/if}

    <div class="flex gap-3 flex-1 min-h-0 overflow-hidden">
      <!-- File tree sidebar -->
      <div class="w-48 shrink-0 overflow-auto border-r border-border pr-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs text-muted-foreground uppercase tracking-wide">Files</span>
          <button
            onclick={openNewFile}
            class="text-xs text-muted-foreground hover:text-primary"
            title="New memory file"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          </button>
        </div>

        {#if memoryStore.loading && memoryStore.files.length === 0}
          <p class="text-xs text-muted-foreground/50">Loading...</p>
        {:else if memoryStore.files.length === 0}
          <p class="text-xs text-muted-foreground/50">No memory files yet. Click + to create one.</p>
        {:else}
          {#each memoryStore.folders as folder}
            <div class="mb-2">
              <span class="text-xs font-medium text-muted-foreground">{folder}/</span>
              {#each memoryStore.filesByFolder[folder] as file}
                <button
                  onclick={() => selectFile(file.relativePath)}
                  class="w-full text-left text-xs px-2 py-1 truncate transition-colors
                    {memoryStore.selectedFile?.path === file.relativePath ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/50'}"
                  title={file.relativePath}
                >
                  {file.title || file.relativePath.split('/').pop()?.replace('.md', '')}
                </button>
              {/each}
            </div>
          {/each}
        {/if}
      </div>

      <!-- File content area -->
      <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
        {#if memoryStore.selectedFile}
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-muted-foreground truncate" title={memoryStore.selectedFile.path}>
              {memoryStore.selectedFile.path}
            </span>
            <div class="flex items-center gap-1 shrink-0">
              {#if isEditing}
                <Button size="sm" variant="ghost" onclick={cancelEdit}>Cancel</Button>
                <Button size="sm" onclick={saveEdit} disabled={memoryStore.saving}>
                  {memoryStore.saving ? 'Saving...' : 'Save'}
                </Button>
              {:else}
                <Button size="sm" variant="ghost" onclick={startEdit}>Edit</Button>
                <Button size="sm" variant="ghost" class="text-destructive" onclick={() => confirmDeletePath = memoryStore.selectedFile!.path}>
                  Delete
                </Button>
              {/if}
            </div>
          </div>

          {#if isEditing}
            <textarea
              bind:value={editContent}
              class="flex-1 w-full text-sm bg-card border border-border p-2 text-foreground font-mono resize-none focus:outline-none focus:border-primary"
              spellcheck="false"
            ></textarea>
          {:else}
            <pre class="flex-1 overflow-auto text-sm text-foreground/80 whitespace-pre-wrap p-2 bg-card border border-border">{memoryStore.selectedFile.content}</pre>
          {/if}
        {:else}
          <div class="flex-1 flex items-center justify-center">
            <p class="text-sm text-muted-foreground/50">Select a memory file to view or edit</p>
          </div>
        {/if}
      </div>
    </div>

    {#if memoryStore.error}
      <p class="text-xs text-destructive mt-2">{memoryStore.error}</p>
    {/if}

    <Dialog.Footer>
      <Button variant="secondary" onclick={onclose}>Close</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- New file dialog -->
{#if showNewFile}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) showNewFile = false; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>New Memory File</Dialog.Title>
      </Dialog.Header>
      <div class="flex flex-col gap-3">
        <div>
          <Label class="mb-1 block">Folder</Label>
          <Select.Root type="single" value={newFileFolder} onValueChange={(v) => { if (v) newFileFolder = v; }}>
            <Select.Trigger class="w-full">
              {newFileFolder}/
            </Select.Trigger>
            <Select.Content>
              {#each folders as f}
                <Select.Item value={f} label="{f}/" />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div>
          <label class="text-xs text-muted-foreground block mb-1">File name</label>
          <input
            type="text"
            bind:value={newFilePath}
            placeholder="e.g. overview"
            class="w-full text-sm bg-card border border-border px-2 py-1.5 text-foreground focus:outline-none focus:border-primary"
            onkeydown={(e) => { if (e.key === 'Enter') createNewFile(); }}
            autofocus
          />
          <span class="text-xs text-muted-foreground mt-1">.md will be added automatically</span>
        </div>
      </div>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => showNewFile = false}>Cancel</Button>
        <Button onclick={createNewFile}>Create</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- Delete confirmation -->
{#if confirmDeletePath}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) confirmDeletePath = null; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>Delete Memory File?</Dialog.Title>
        <Dialog.Description>
          Delete <span class="text-foreground font-medium">{confirmDeletePath}</span>? This cannot be undone.
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmDeletePath = null}>Cancel</Button>
        <Button variant="destructive" onclick={confirmDelete}>Delete</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
