<script lang="ts">
  import { memoryStore } from '../stores/memory.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
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
  let showBackups = $state(false);
  let confirmRestoreId = $state<string | null>(null);
  let showPrune = $state(false);
  let pruneDays = $state('30');
  let pruneSelection = $state<Record<string, boolean>>({});
  let confirmPrune = $state(false);

  const pruneDayPresets = [7, 30, 90, 180];

  const compactStageLabels: Record<string, string> = {
    pruning: 'Pruning old session notes',
    generating: 'Asking the agent to consolidate memory',
    validating: 'Validating the result',
    applying: 'Applying changes',
  };
  let compactStageLabel = $derived(
    compactStageLabels[memoryStore.compactStage ?? ''] ?? `Compacting ${memoryStore.stats?.fileCount ?? ''} memory files`
  );
  let compactTimeoutSeconds = $derived(Math.max(30, settingsStore.current.memoryCompactTimeoutSeconds || 300));

  function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const folders = ['repo', 'conventions', 'architecture', 'sessions'];

  $effect(() => {
    if (open && store.repos.length > 0) {
      // Default to the repo of the currently active session
      const currentRepo = store.activeSession?.repoPath;
      const targetRepo = currentRepo && store.repos.includes(currentRepo)
        ? currentRepo
        : store.repos[0];
      memoryStore.loadForRepo(targetRepo);
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

  function openBackups() {
    memoryStore.loadBackups();
    showBackups = true;
  }

  async function confirmRestore() {
    if (confirmRestoreId) {
      await memoryStore.restoreBackup(confirmRestoreId);
      confirmRestoreId = null;
      showBackups = false;
    }
  }

  function formatBackupDate(iso: string): string {
    if (!iso) return 'unknown';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleString();
  }

  const pruneDaysNum = $derived(Math.max(0, Math.floor(Number(pruneDays)) || 0));
  const prunableNotes = $derived(memoryStore.sessionNotesOlderThan(pruneDaysNum));
  const pruneSelectedPaths = $derived(prunableNotes.map(n => n.relativePath).filter(p => pruneSelection[p]));

  // ─── Budget meter ───
  const budgetPct = $derived(memoryStore.stats
    ? Math.min(100, Math.round((memoryStore.stats.totalBytes / memoryStore.stats.budgetBytes) * 100))
    : 0);
  const budgetWarn = $derived(budgetPct >= 75);

  function formatKb(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function relativeTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const ms = Date.now() - Date.parse(iso);
    if (Number.isNaN(ms) || ms < 0) return '';
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  // Re-select all matches whenever the dialog opens or the cutoff changes
  $effect(() => {
    if (showPrune) {
      const sel: Record<string, boolean> = {};
      for (const note of prunableNotes) sel[note.relativePath] = true;
      pruneSelection = sel;
    }
  });

  async function deletePruned() {
    const paths = pruneSelectedPaths;
    confirmPrune = false;
    showPrune = false;
    await memoryStore.deleteFiles(paths);
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

    <!-- Budget meter: how much of the agent's system-prompt budget memory uses -->
    {#if memoryStore.stats}
      <div class="mb-2">
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="text-muted-foreground">
            Agent prompt budget:
            <span class={budgetWarn ? 'text-amber-500 font-medium' : 'text-foreground/80'}>
              {formatKb(memoryStore.stats.totalBytes)} / {formatKb(memoryStore.stats.budgetBytes)}
            </span>
            {#if memoryStore.stats.skippedFiles.length > 0}
              <span class="text-destructive font-medium" title={memoryStore.stats.skippedFiles.join(', ')}>
                · {memoryStore.stats.skippedFiles.length} {memoryStore.stats.skippedFiles.length === 1 ? 'file' : 'files'} not reaching the agent
              </span>
            {/if}
          </span>
          {#if memoryStore.stats.lastCompactedAt}
            <span class="text-muted-foreground/70">
              Last compacted {relativeTime(memoryStore.stats.lastCompactedAt)}{memoryStore.stats.lastAuto ? ' (auto)' : ''}
            </span>
          {/if}
        </div>
        <div class="h-1.5 w-full bg-border overflow-hidden rounded-full">
          <div
            class="h-full rounded-full transition-all {budgetPct >= 100 ? 'bg-destructive' : budgetWarn ? 'bg-amber-500' : 'bg-primary'}"
            style="width: {budgetPct}%"
          ></div>
        </div>
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
    {:else if memoryStore.compacting}
      <div class="mt-2 flex items-center gap-3">
        <span class="w-1.5 h-1.5 bg-primary animate-pulse shrink-0"></span>
        <p class="text-xs text-muted-foreground flex-1">
          {compactStageLabel} — {formatElapsed(memoryStore.compactElapsedSeconds)} elapsed
          <span class="text-muted-foreground/60">(times out at {formatElapsed(compactTimeoutSeconds)})</span>
        </p>
        <button
          onclick={() => memoryStore.cancelCompact()}
          class="text-xs text-destructive hover:underline underline-offset-2 shrink-0"
          title="Abort this compaction pass — nothing has been changed yet"
        >
          Cancel
        </button>
      </div>
      <p class="text-xs text-muted-foreground/60 mt-1 ml-4.5">
        You can close this panel — compaction continues in the background and the summary will appear when it finishes.
      </p>
    {:else if memoryStore.compactMessage}
      <p class="text-xs text-muted-foreground mt-2">{memoryStore.compactMessage}</p>
    {/if}

    <Dialog.Footer class="sm:justify-between">
      <div class="flex items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          onclick={() => memoryStore.compact()}
          disabled={memoryStore.compacting || memoryStore.files.length === 0}
          title="Merge duplicate notes, resolve contradictions, and drop stale details. Shows a summary you can undo."
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          {memoryStore.compacting ? 'Compacting…' : 'Compact'}
        </Button>
        <Button size="sm" variant="ghost" onclick={openBackups} title="View and restore snapshots taken before each compaction">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
          Backups
        </Button>
        <Button size="sm" variant="ghost" onclick={() => showPrune = true} title="Review and delete old session notes (memory files only — never your actual sessions)">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 11 9-9"/><path d="M14.6 12.6c.8.8.9 2.1.2 3L10 22l-8-8 6.4-4.8c.9-.7 2.2-.6 3 .2Z"/><path d="m6.8 10.4 6.8 6.8"/><path d="m5 17 1.4-1.4"/></svg>
          Clean up notes
        </Button>
      </div>
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

<!-- Compaction result: what changed, with one-click Undo -->
{#if memoryStore.lastCompaction}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) memoryStore.lastCompaction = null; }}>
    <Dialog.Content class="max-w-md">
      <Dialog.Header>
        <Dialog.Title>Memory Compacted</Dialog.Title>
        <Dialog.Description>
          {memoryStore.lastCompaction.filesChanged.length} {memoryStore.lastCompaction.filesChanged.length === 1 ? 'file' : 'files'} changed. A snapshot of the previous state was saved — Undo restores it.
        </Dialog.Description>
      </Dialog.Header>

      {#if memoryStore.lastCompaction.changes?.length}
        <div class="flex flex-col gap-1 max-h-64 overflow-auto">
          {#each memoryStore.lastCompaction.changes as change (change.path)}
            <div class="px-2 py-1.5 bg-card border border-border">
              <div class="flex items-center gap-2 text-sm">
                <span class="text-xs uppercase tracking-wide shrink-0 {change.action === 'delete' ? 'text-destructive' : 'text-primary'}">
                  {change.action === 'delete' ? 'removed' : 'rewritten'}
                </span>
                <span class="text-foreground truncate" title={change.path}>{change.path}</span>
              </div>
              {#if change.reason}
                <p class="text-xs text-muted-foreground mt-0.5">{change.reason}</p>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <Dialog.Footer>
        <Button
          variant="secondary"
          onclick={() => memoryStore.undoCompaction()}
          disabled={memoryStore.undoing || !memoryStore.lastCompaction.backupId}
        >
          {memoryStore.undoing ? 'Undoing…' : 'Undo'}
        </Button>
        <Button onclick={() => memoryStore.lastCompaction = null}>Keep changes</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- Backups dialog -->
{#if showBackups}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) showBackups = false; }}>
    <Dialog.Content class="max-w-md">
      <Dialog.Header>
        <Dialog.Title>Memory Backups</Dialog.Title>
        <Dialog.Description>
          Snapshots taken before each compaction or restore. Restoring replaces the current repo, conventions and architecture notes (a snapshot of the current state is taken first).
        </Dialog.Description>
      </Dialog.Header>
      {#if memoryStore.backups.length === 0}
        <p class="text-sm text-muted-foreground/50 py-2">No backups yet. One is created automatically before each compaction.</p>
      {:else}
        <div class="flex flex-col gap-1 max-h-72 overflow-auto">
          {#each memoryStore.backups as backup (backup.id)}
            <div class="bg-card border border-border">
              <div class="flex items-center justify-between gap-2 px-2 py-1.5">
                <div class="min-w-0">
                  <div class="text-sm text-foreground truncate">{formatBackupDate(backup.createdAt)}</div>
                  <div class="text-xs text-muted-foreground">{backup.fileCount} {backup.fileCount === 1 ? 'file' : 'files'}</div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onclick={() => memoryStore.previewBackup(backup.id)}>
                    {memoryStore.backupPreviewId === backup.id ? 'Hide' : 'View'}
                  </Button>
                  <Button size="sm" variant="ghost" onclick={() => confirmRestoreId = backup.id}>
                    Restore
                  </Button>
                </div>
              </div>
              {#if memoryStore.backupPreviewId === backup.id}
                <div class="border-t border-border px-2 py-1.5">
                  {#each memoryStore.backupPreviewFiles as file (file.path)}
                    <button
                      onclick={() => memoryStore.readBackupFile(backup.id, file.path)}
                      class="w-full flex items-center justify-between text-xs px-1 py-0.5 transition-colors
                        {memoryStore.backupPreviewFile?.path === file.path ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}"
                    >
                      <span class="truncate">{file.path}</span>
                      <span class="shrink-0 ml-2 text-muted-foreground/60">{(file.bytes / 1024).toFixed(1)} KB</span>
                    </button>
                  {/each}
                  {#if memoryStore.backupPreviewFile}
                    <pre class="mt-1 max-h-40 overflow-auto text-xs text-foreground/80 whitespace-pre-wrap p-1.5 bg-background border border-border">{memoryStore.backupPreviewFile.content}</pre>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => showBackups = false}>Close</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- Prune sessions dialog -->
{#if showPrune}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) showPrune = false; }}>
    <Dialog.Content class="max-w-md">
      <Dialog.Header>
        <Dialog.Title>Clean Up Session Notes</Dialog.Title>
        <Dialog.Description>
          Delete old session notes — the agent's memory files about past work. Your actual sessions in the sidebar are never touched. Deletion is permanent; session notes are not included in compaction backups.
        </Dialog.Description>
      </Dialog.Header>

      <div class="flex items-center gap-2">
        <Label class="shrink-0">Older than</Label>
        <input
          type="number"
          min="0"
          bind:value={pruneDays}
          class="w-16 text-sm bg-card border border-border px-2 py-1 text-foreground focus:outline-none focus:border-primary"
        />
        <span class="text-xs text-muted-foreground">days</span>
        <div class="flex gap-1 ml-1">
          {#each pruneDayPresets as d}
            <button
              onclick={() => pruneDays = String(d)}
              class="text-xs px-1.5 py-0.5 border transition-colors
                {pruneDaysNum === d ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}"
            >
              {d}
            </button>
          {/each}
        </div>
      </div>

      {#if prunableNotes.length === 0}
        <p class="text-sm text-muted-foreground/50 py-2">No session notes older than {pruneDays} days.</p>
      {:else}
        <div class="flex flex-col gap-1 max-h-64 overflow-auto">
          {#each prunableNotes as note (note.relativePath)}
            <label class="flex items-center gap-2 px-2 py-1.5 bg-card border border-border cursor-pointer">
              <input
                type="checkbox"
                checked={pruneSelection[note.relativePath] ?? false}
                onchange={(e) => pruneSelection[note.relativePath] = e.currentTarget.checked}
              />
              <div class="min-w-0 flex-1">
                <div class="text-sm text-foreground truncate" title={note.relativePath}>
                  {note.title || note.relativePath.split('/').pop()?.replace('.md', '')}
                </div>
                <div class="text-xs text-muted-foreground">
                  {note.ts > 0 ? formatBackupDate(note.updatedAt) : 'unknown date'}
                </div>
              </div>
            </label>
          {/each}
        </div>
      {/if}

      <Dialog.Footer>
        <Button variant="secondary" onclick={() => showPrune = false}>Cancel</Button>
        <Button
          variant="destructive"
          disabled={pruneSelectedPaths.length === 0}
          onclick={() => confirmPrune = true}
        >
          Delete {pruneSelectedPaths.length} {pruneSelectedPaths.length === 1 ? 'note' : 'notes'}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- Prune confirmation -->
{#if confirmPrune}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) confirmPrune = false; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>Delete Session Notes?</Dialog.Title>
        <Dialog.Description>
          Permanently delete {pruneSelectedPaths.length} session {pruneSelectedPaths.length === 1 ? 'note' : 'notes'}? This cannot be undone.
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmPrune = false}>Cancel</Button>
        <Button variant="destructive" onclick={deletePruned}>Delete</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- Restore confirmation -->
{#if confirmRestoreId}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) confirmRestoreId = null; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>Restore Backup?</Dialog.Title>
        <Dialog.Description>
          The current repo, conventions and architecture notes will be replaced by this snapshot. The current state is backed up first, so you can undo this.
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => confirmRestoreId = null}>Cancel</Button>
        <Button onclick={confirmRestore}>Restore</Button>
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
