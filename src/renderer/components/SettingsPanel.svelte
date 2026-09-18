<script lang="ts">
  import { settingsStore } from '../stores/settings.svelte.js';
  import { pluginStore } from '../stores/plugins.svelte.js';
  import { mcpConfigStore } from '../stores/mcpConfig.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { DEFAULT_REPO_COLORS } from '../lib/repo-colors.js';
  import PluginCard from './PluginCard.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { VIEW_MODE_DESCRIPTIONS, VIEW_MODE_LABELS } from '$lib/message-view.js';
  import { ACTIVITY_VIEW_MODES, type ActivityViewMode } from '../../shared/types.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
  import type { SettingsPermissionMode, CavemanMode, McpConfigScope, ControlDescriptor } from '../../shared/types.js';
  import { CONTROL_IDS } from '../../shared/types.js';
  import Fuse from 'fuse.js';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  type Tab = 'permissions' | 'agent' | 'general' | 'mcp' | 'plugins';
  let tab = $state<Tab>('permissions');

  // Temp input values for adding list items
  let newAllowRule = $state('');
  let newDenyRule = $state('');
  let newWorkingDir = $state('');

  // Plugin search
  let pluginSearch = $state('');
  let pluginTab = $state<'installed' | 'discover'>('installed');

  const filteredInstalled = $derived.by(() => {
    if (!pluginSearch.trim()) return pluginStore.installed;
    const fuse = new Fuse(pluginStore.installed, { keys: ['id'], threshold: 0.4 });
    return fuse.search(pluginSearch).map((r) => r.item);
  });

  const filteredAvailable = $derived.by(() => {
    const notInstalled = pluginStore.available.filter(
      (a) => !pluginStore.isInstalled(a.pluginId)
    );
    if (!pluginSearch.trim()) return notInstalled;
    const fuse = new Fuse(notInstalled, { keys: ['name', 'description'], threshold: 0.4 });
    return fuse.search(pluginSearch).map((r) => r.item);
  });

  const pluginBusy = $derived(pluginStore.actionInProgress !== null);

  function findAvailable(installedId: string) {
    return pluginStore.available.find((a) => a.pluginId === installedId);
  }

  $effect(() => {
    if (open) {
      settingsStore.load();
      pluginStore.refresh();
    }
  });

  // ─── MCP servers tab ───

  // `claude mcp list` health-checks every server (slow), so load lazily on
  // first visit to the MCP tab rather than on every settings open.
  $effect(() => {
    if (open && tab === 'mcp' && !mcpConfigStore.loaded && !mcpConfigStore.loading) {
      mcpConfigStore.refresh();
    }
  });

  let mcpRepos = $derived(store.repos);
  let mcpName = $state('');
  let mcpTransport = $state<'stdio' | 'http' | 'sse'>('stdio');
  let mcpCommand = $state('');
  let mcpArgs = $state('');
  let mcpEnv = $state('');
  let mcpHeaders = $state('');
  let mcpScope = $state<McpConfigScope>('user');
  let mcpRepo = $state('');
  let mcpAdded = $state<string | null>(null);

  const mcpTransports: { value: 'stdio' | 'http' | 'sse'; label: string }[] = [
    { value: 'stdio', label: 'stdio (local command)' },
    { value: 'http', label: 'HTTP' },
    { value: 'sse', label: 'SSE' },
  ];

  const mcpScopes: { value: McpConfigScope; label: string; description: string }[] = [
    { value: 'user', label: 'User', description: 'Available in all projects on this machine' },
    { value: 'project', label: 'Project', description: 'Shared with the team via .mcp.json in the project repository' },
    { value: 'local', label: 'Local', description: 'Only this machine, only the chosen project' },
  ];

  const mcpCanAdd = $derived(
    mcpName.trim() !== '' && mcpCommand.trim() !== ''
      && (mcpScope === 'user' || mcpRepo !== ''),
  );

  async function addMcpServer() {
    if (!mcpCanAdd || mcpConfigStore.actionInProgress) return;
    const env: Record<string, string> = {};
    for (const line of mcpEnv.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) {
        mcpConfigStore.error = `Environment variables must be KEY=value (got "${trimmed}")`;
        return;
      }
      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    const headers = mcpHeaders.split('\n').map((h) => h.trim()).filter(Boolean);

    const name = mcpName.trim();
    const ok = await mcpConfigStore.add({
      name,
      transport: mcpTransport,
      commandOrUrl: mcpCommand.trim(),
      args: mcpTransport === 'stdio'
        ? mcpArgs.trim().split(/\s+/).filter(Boolean)
        : undefined,
      env: mcpTransport === 'stdio' && Object.keys(env).length > 0 ? env : undefined,
      headers: mcpTransport !== 'stdio' && headers.length > 0 ? headers : undefined,
      scope: mcpScope,
      cwd: mcpScope !== 'user' ? mcpRepo : undefined,
    });
    if (ok) {
      mcpName = ''; mcpCommand = ''; mcpArgs = ''; mcpEnv = ''; mcpHeaders = '';
      mcpAdded = name;
      setTimeout(() => { if (mcpAdded === name) mcpAdded = null; }, 8000);
    }
  }

  function mcpStatusDot(status: string): string {
    return status === 'connected' ? 'bg-green-500'
      : status === 'pending' ? 'bg-yellow-400 animate-pulse'
      : status === 'needs-auth' ? 'bg-yellow-500'
      : status === 'disabled' ? 'bg-muted-foreground/40'
      : 'bg-red-500';
  }

  function handleSave() {
    settingsStore.save();
  }

  function handleCancel() {
    try { settingsStore.reset(); } catch { /* ignore */ }
    onclose();
  }

  function addAllowRule() {
    const v = newAllowRule.trim();
    if (!v) return;
    settingsStore.addToolAllowRule(v);
    newAllowRule = '';
  }

  function addDenyRule() {
    const v = newDenyRule.trim();
    if (!v) return;
    settingsStore.addToolDenyRule(v);
    newDenyRule = '';
  }

  function addWorkingDir() {
    const v = newWorkingDir.trim();
    if (!v) return;
    settingsStore.addWorkingDirectory(v);
    newWorkingDir = '';
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'permissions', label: 'Permissions' },
    { id: 'agent', label: 'Agent' },
    { id: 'general', label: 'General' },
    { id: 'mcp', label: 'MCP' },
    { id: 'plugins', label: 'Plugins' },
  ];

  // Claude's own modes first; Grove's app-level modes sit under a divider
  // with their own heading so they don't read as CLI options.
  const permissionModes: { value: SettingsPermissionMode; label: string; group?: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'acceptEdits', label: 'Accept Edits' },
    { value: 'plan', label: 'Plan (read-only)' },
    { value: 'auto', label: 'Auto (Claude classifier approves actions)' },
    { value: 'bypassPermissions', label: 'Bypass Permissions' },
    { value: 'readSafe', label: 'Read-safe (edits + read-only commands)', group: 'Grove Bench' },
  ];
  const claudeModes = $derived(permissionModes.filter((m) => !m.group && (!settingsStore.draft.disableBypassMode || m.value !== 'bypassPermissions')));
  const groveModes = $derived(permissionModes.filter((m) => m.group));

  const cavemanModes: { value: CavemanMode; label: string; description: string }[] = [
    { value: 'off', label: 'Off', description: 'Normal verbose output' },
    { value: 'lite', label: 'Lite', description: 'Drop filler/hedging, keep articles' },
    { value: 'full', label: 'Full', description: 'Drop articles, fragments OK' },
    { value: 'ultra', label: 'Ultra', description: 'Max compression, abbreviations' },
  ];

  // ── Per-adapter defaults ──
  // Each registered adapter declares its own session controls (thinking,
  // speed, ...) per model; the Agent tab renders those descriptors instead of
  // a hand-written list, so a new adapter needs no Settings changes.
  interface AdapterControls { id: string; displayName: string; controls: ControlDescriptor[] }
  let adapterControls = $state<AdapterControls[]>([]);
  let adapterControlsLoading = $state(false);
  let adapterControlsRequest = 0;

  async function loadAdapterControls(model: string) {
    const request = ++adapterControlsRequest;
    adapterControlsLoading = true;
    try {
      const adapters = await window.groveBench.listAdapters();
      const withControls = await Promise.all(adapters.map(async (a) => {
        let controls: ControlDescriptor[] = [];
        try { controls = await window.groveBench.getAdapterControls(a.id, model || null); } catch { /* adapter unavailable */ }
        return { id: a.id, displayName: a.displayName, controls: controls.filter((c) => c.id !== CONTROL_IDS.permissionMode) };
      }));
      if (request === adapterControlsRequest) adapterControls = withControls;
    } catch {
      if (request === adapterControlsRequest) adapterControls = [];
    } finally {
      if (request === adapterControlsRequest) adapterControlsLoading = false;
    }
  }

  // Descriptors depend on the model (e.g. adaptive thinking, fast mode), so
  // reload when the default model changes while the panel is open.
  $effect(() => {
    const model = settingsStore.draft.defaultModel;
    if (open && tab === 'agent') loadAdapterControls(model);
  });

  function controlValue(adapterId: string, control: ControlDescriptor): string {
    const saved = settingsStore.adapterDefault(adapterId, control.id);
    return saved && control.options.some((o) => o.value === saved) ? saved : control.default;
  }

  const themes: { value: 'system' | 'dark' | 'light'; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ];
</script>

<Dialog.Root {open} onOpenChange={(o) => { if (!o) onclose(); }}>
  <Dialog.Content class="sm:max-w-7xl w-[95vw] max-h-[90vh] h-[80vh] flex flex-col" onInteractOutside={(e) => e.preventDefault()}>
    <Dialog.Header>
      <Dialog.Title>Settings</Dialog.Title>
      <Dialog.Description>
        Configure defaults for conversations, permissions, plugins, and more.
      </Dialog.Description>
    </Dialog.Header>

    <!-- Tabs -->
    <div class="flex items-center gap-1 border-b border-border mt-2 overflow-x-auto overflow-y-hidden shrink-0">
      {#each tabs as t (t.id)}
        <button
          onclick={() => tab = t.id}
          class="px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px whitespace-nowrap
            {tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
        >
          {t.label}
          {#if t.id === 'plugins' && pluginStore.installed.length > 0}
            <span class="text-muted-foreground/60 ml-0.5">({pluginStore.installed.length})</span>
          {/if}
        </button>
      {/each}
    </div>

    <!-- Error -->
    {#if settingsStore.error}
      <div class="mt-2 text-xs text-destructive bg-destructive/10 px-3 py-2">
        {settingsStore.error}
      </div>
    {/if}
    {#if tab === 'plugins' && pluginStore.error}
      <div class="mt-2 text-xs text-destructive bg-destructive/10 px-3 py-2">
        {pluginStore.error}
      </div>
    {/if}
    {#if tab === 'mcp' && mcpConfigStore.error}
      <div class="mt-2 text-xs text-destructive bg-destructive/10 px-3 py-2 whitespace-pre-wrap">
        {mcpConfigStore.error}
      </div>
    {/if}

    <!-- Content -->
    <div class="flex-1 overflow-auto mt-3 min-h-0 px-2">
      {#if settingsStore.loading && tab !== 'plugins' && tab !== 'mcp'}
        <div class="flex items-center justify-center py-8 text-muted-foreground">
          <span class="w-3 h-3 bg-primary animate-pulse mr-2"></span>
          <span class="text-sm">Loading settings...</span>
        </div>

      {:else if tab === 'permissions'}
        <div class="flex flex-col gap-4">
          <!-- Default Permission Mode -->
          <div>
            <Label class="mb-1 block">Default Permission Mode</Label>
            <Select.Root type="single" value={settingsStore.draft.defaultPermissionMode} onValueChange={(v) => { if (v) settingsStore.draft.defaultPermissionMode = v as SettingsPermissionMode; }}>
              <Select.Trigger class="w-full">
                {permissionModes.find(m => m.value === settingsStore.draft.defaultPermissionMode)?.label ?? 'Default'}
              </Select.Trigger>
              <Select.Content>
                {#each claudeModes as mode (mode.value)}
                  <Select.Item value={mode.value} label={mode.label} />
                {/each}
                <Select.Separator />
                <Select.Group>
                  <Select.GroupHeading>{groveModes[0]?.group}</Select.GroupHeading>
                  {#each groveModes as mode (mode.value)}
                    <Select.Item value={mode.value} label={mode.label} />
                  {/each}
                </Select.Group>
              </Select.Content>
            </Select.Root>
            <p class="text-xs text-muted-foreground mt-1">Controls how tools are approved in new conversations.</p>
          </div>

          <!-- Disable Bypass Mode -->
          <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox bind:checked={settingsStore.draft.disableBypassMode} />
            Disable bypass permissions mode
          </label>

          <Separator />

          <!-- Tool Allow Rules -->
          <div>
            <Label class="mb-1 block">Tool Allow Rules</Label>
            <p class="text-xs text-muted-foreground mb-2">
              Rules work for any agent: <code>shell(npm run *)</code>, <code>edit(src/**)</code>, <code>read(**/.env*)</code>,
              <code>web(*github.com*)</code>, <code>mcp(github__*)</code>, <code>agent</code>, <code>question</code>.
              A provider's own tool name also works, e.g. <code>Bash(git push *)</code>.
            </p>
            {#if settingsStore.draft.toolAllowRules.length > 0}
              <div class="flex flex-wrap gap-1 mb-2">
                {#each settingsStore.draft.toolAllowRules as rule, i (i)}
                  <span class="inline-flex items-center gap-1 bg-muted px-2 py-0.5 text-xs">
                    <code>{rule.pattern}</code>
                    <button onclick={() => settingsStore.removeToolAllowRule(i)} class="text-muted-foreground hover:text-destructive" aria-label="Remove rule">
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  </span>
                {/each}
              </div>
            {/if}
            <div class="flex items-center gap-2">
              <input
                type="text"
                bind:value={newAllowRule}
                placeholder="shell(npm run *)"
                onkeydown={(e) => { if (e.key === 'Enter') addAllowRule(); }}
                class="flex-1 bg-background border border-input px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button variant="secondary" class="h-[34px] px-3 text-sm" onclick={addAllowRule}>Add</Button>
            </div>
          </div>

          <!-- Tool Deny Rules -->
          <div>
            <Label class="mb-1 block">Tool Deny Rules</Label>
            <p class="text-xs text-muted-foreground mb-2">Deny rules take precedence over allow rules.</p>
            {#if settingsStore.draft.toolDenyRules.length > 0}
              <div class="flex flex-wrap gap-1 mb-2">
                {#each settingsStore.draft.toolDenyRules as rule, i (i)}
                  <span class="inline-flex items-center gap-1 bg-destructive/10 px-2 py-0.5 text-xs">
                    <code>{rule.pattern}</code>
                    <button onclick={() => settingsStore.removeToolDenyRule(i)} class="text-muted-foreground hover:text-destructive" aria-label="Remove rule">
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  </span>
                {/each}
              </div>
            {/if}
            <div class="flex items-center gap-2">
              <input
                type="text"
                bind:value={newDenyRule}
                placeholder="shell(git push *)"
                onkeydown={(e) => { if (e.key === 'Enter') addDenyRule(); }}
                class="flex-1 bg-background border border-input px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button variant="secondary" class="h-[34px] px-3 text-sm" onclick={addDenyRule}>Add</Button>
            </div>
          </div>
        </div>

      {:else if tab === 'agent'}
        <div class="flex flex-col gap-4">
          <!-- Default Model -->
          <div>
            <Label for="settings-model" class="mb-1 block">Default Model</Label>
            <input
              id="settings-model"
              type="text"
              bind:value={settingsStore.draft.defaultModel}
              placeholder="e.g. model-id"
              class="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p class="text-xs text-muted-foreground mt-1">Leave empty to use the SDK default.</p>
          </div>

          <!-- Per-adapter session control defaults (from each adapter's descriptors) -->
          {#if adapterControls.length === 0}
            <p class="text-xs text-muted-foreground">
              {adapterControlsLoading ? 'Loading agent controls…' : 'No agent adapters registered.'}
            </p>
          {/if}
          {#each adapterControls as adapter (adapter.id)}
            <div>
              <div class="text-sm font-medium text-foreground mb-2">{adapter.displayName} defaults</div>
              {#if adapter.controls.length === 0}
                <p class="text-xs text-muted-foreground">This agent declares no adjustable conversation controls.</p>
              {:else}
                <div class="flex flex-col gap-3">
                  {#each adapter.controls as control (control.id)}
                    {@const value = controlValue(adapter.id, control)}
                    {@const selected = control.options.find((o) => o.value === value)}
                    <div>
                      <Label class="mb-1 block">Default {control.label}</Label>
                      <Select.Root type="single" {value} onValueChange={(v) => { if (v) settingsStore.setAdapterDefault(adapter.id, control.id, v === control.default ? null : v); }}>
                        <Select.Trigger class="w-48">
                          {selected?.label ?? value}
                        </Select.Trigger>
                        <Select.Content>
                          {#each control.options as option (option.value)}
                            <Select.Item value={option.value} label={option.label} />
                          {/each}
                        </Select.Content>
                      </Select.Root>
                      <p class="text-xs text-muted-foreground mt-1">
                        {selected?.description ? selected.description.replace(/[.\s]*$/, '') + '.' : ''}
                        {#if control.id === CONTROL_IDS.thinking}
                          Adjustable per conversation from the status bar (Alt+T).
                        {/if}
                      </p>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
          <p class="text-xs text-muted-foreground -mt-2">Options depend on the default model above. Applied to new conversations only.</p>

          <Separator />

          <!-- Caveman Mode -->
          <div>
            <Label class="mb-1 block">Caveman Mode</Label>
            <Select.Root type="single" value={settingsStore.draft.cavemanMode} onValueChange={(v) => { if (v) settingsStore.draft.cavemanMode = v as CavemanMode; }}>
              <Select.Trigger class="w-48">
                {cavemanModes.find(m => m.value === settingsStore.draft.cavemanMode)?.label ?? 'Off'}
              </Select.Trigger>
              <Select.Content>
                {#each cavemanModes as mode (mode.value)}
                  <Select.Item value={mode.value} label={mode.label} />
                {/each}
              </Select.Content>
            </Select.Root>
            <p class="text-xs text-muted-foreground mt-1">
              {cavemanModes.find(m => m.value === settingsStore.draft.cavemanMode)?.description ?? ''}
              {#if settingsStore.draft.cavemanMode !== 'off'}
                — reduces output tokens ~65-75%. Code blocks stay normal.
              {/if}
            </p>
          </div>

          <Separator />

          <!-- System Prompt Append -->
          <div>
            <Label for="settings-prompt" class="mb-1 block">System Prompt Append</Label>
            <textarea
              id="settings-prompt"
              bind:value={settingsStore.draft.defaultSystemPromptAppend}
              placeholder="Additional instructions appended to every conversation..."
              class="w-full bg-background border border-input px-3 py-2 text-sm min-h-[80px] max-h-[200px] resize-y focus:outline-none focus:ring-1 focus:ring-ring"
            ></textarea>
          </div>

          <Separator />

          <!-- Working Directories -->
          <div>
            <Label class="mb-1 block">Additional Working Directories</Label>
            <p class="text-xs text-muted-foreground mb-2">Extra directories agents can access beyond the project root.</p>
            {#if settingsStore.draft.workingDirectories.length > 0}
              <div class="flex flex-col gap-1 mb-2">
                {#each settingsStore.draft.workingDirectories as dir, i (i)}
                  <div class="flex items-center justify-between bg-muted px-2 py-1 text-xs">
                    <code class="truncate">{dir}</code>
                    <button onclick={() => settingsStore.removeWorkingDirectory(i)} class="text-muted-foreground hover:text-destructive ml-2 shrink-0" aria-label="Remove directory">
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
            <div class="flex items-center gap-2">
              <input
                type="text"
                bind:value={newWorkingDir}
                placeholder="/path/to/directory"
                onkeydown={(e) => { if (e.key === 'Enter') addWorkingDir(); }}
                class="flex-1 bg-background border border-input px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button variant="secondary" class="h-[34px] px-3 text-sm" onclick={addWorkingDir}>Add</Button>
            </div>
          </div>
        </div>

      {:else if tab === 'general'}
        <div class="flex flex-col gap-4">
          <!-- Default Base Branch -->
          <div>
            <Label for="settings-base" class="mb-1 block">Default Base Branch</Label>
            <input
              id="settings-base"
              type="text"
              bind:value={settingsStore.draft.defaultBaseBranch}
              placeholder="auto (repository default branch)"
              class="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p class="text-xs text-muted-foreground mt-1">
              Leave empty to use each project's default branch (e.g. main or master).
            </p>
          </div>

          <Separator />

          <!-- Theme -->
          <div>
            <Label class="mb-1 block">Theme</Label>
            <Select.Root type="single" value={settingsStore.draft.theme} onValueChange={(v) => { if (v) settingsStore.draft.theme = v as 'system' | 'dark' | 'light'; }}>
              <Select.Trigger class="w-48">
                {themes.find(t => t.value === settingsStore.draft.theme)?.label ?? 'System'}
              </Select.Trigger>
              <Select.Content>
                {#each themes as theme (theme.value)}
                  <Select.Item value={theme.value} label={theme.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>

          <Separator />

          <!-- Repository Accent Colors -->
          {#if store.repos.length > 0}
            <div>
              <Label class="mb-1 block">Project Colors</Label>
              <p class="text-xs text-muted-foreground mb-2">Accent colors help identify which tabs belong to each project.</p>
              <div class="flex flex-col gap-2">
                {#each store.repos as repo, i (repo)}
                  {@const currentColor = settingsStore.draft.repoColors[repo] || DEFAULT_REPO_COLORS[i % DEFAULT_REPO_COLORS.length]}
                  <div class="flex items-center gap-2">
                    <label class="relative w-6 h-6 shrink-0 cursor-pointer border border-border hover:border-foreground/30 transition-colors" style="background-color: {currentColor}">
                      <input
                        type="color"
                        value={currentColor}
                        oninput={(e) => {
                          const target = e.target as HTMLInputElement;
                          settingsStore.draft.repoColors = { ...settingsStore.draft.repoColors, [repo]: target.value };
                        }}
                        class="absolute inset-0 opacity-0 cursor-pointer"
                      />
                    </label>
                    <span class="text-sm text-muted-foreground truncate">{store.repoDisplayName(repo)}</span>
                    {#if settingsStore.draft.repoColors[repo]}
                      <button
                        onclick={() => {
                          const { [repo]: _, ...rest } = settingsStore.draft.repoColors;
                          settingsStore.draft.repoColors = rest;
                        }}
                        class="text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
                        title="Reset to default"
                      >
                        reset
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>

            <Separator />
          {/if}

          <!-- Always on Top -->
          <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox bind:checked={settingsStore.draft.alwaysOnTop} />
            Always on top
          </label>

          <Separator />

          <!-- Spell Check -->
          <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox bind:checked={settingsStore.draft.spellcheck} />
            Enable spell checking
          </label>

          <Separator />

          <!-- Desktop Notifications -->
          <div>
            <Label class="mb-1 block">Desktop Notifications</Label>
            <p class="text-xs text-muted-foreground mb-2">Shown only while the Grove Bench window is unfocused. Clicking a notification jumps to the conversation.</p>
            <div class="space-y-2">
              <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Checkbox bind:checked={settingsStore.draft.notifyOnTurnComplete} />
                Agent finishes a turn
              </label>
              <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Checkbox bind:checked={settingsStore.draft.notifyOnPermission} />
                Agent is waiting on a permission or question
              </label>
              <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Checkbox bind:checked={settingsStore.draft.notifyOnPrAlert} />
                PR activity (new CI failures, review comments)
              </label>
              <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Checkbox bind:checked={settingsStore.draft.notifyTaskbarFlash} />
                Flash the taskbar button
              </label>
              <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Checkbox bind:checked={settingsStore.draft.notifyTaskbarBadge} />
                Badge the taskbar icon with the number of conversations needing attention
              </label>
            </div>
          </div>

          <Separator />

          <!-- Default Activity View -->
          <div>
            <Label class="mb-1 block">Default Activity View</Label>
            <Select.Root type="single" value={settingsStore.draft.defaultActivityView} onValueChange={(v) => { if (v) settingsStore.draft.defaultActivityView = v as ActivityViewMode; }}>
              <Select.Trigger class="w-48">
                {VIEW_MODE_LABELS[settingsStore.draft.defaultActivityView] ?? 'Summary'}
              </Select.Trigger>
              <Select.Content>
                {#each ACTIVITY_VIEW_MODES as mode (mode)}
                  <Select.Item value={mode} label={VIEW_MODE_LABELS[mode]} />
                {/each}
              </Select.Content>
            </Select.Root>
            <p class="text-xs text-muted-foreground mt-1">
              {VIEW_MODE_DESCRIPTIONS[settingsStore.draft.defaultActivityView] ?? VIEW_MODE_DESCRIPTIONS.summary}.
              New conversations start in this view. Each conversation can still switch from the toggle in its status bar.
            </p>
          </div>

          <Separator />

          <!-- Diff View Mode -->
          <div>
            <Label class="mb-1 block">Default Diff View</Label>
            <Select.Root type="single" value={settingsStore.draft.diffViewMode} onValueChange={(v) => { if (v) settingsStore.draft.diffViewMode = v as 'unified' | 'side-by-side'; }}>
              <Select.Trigger class="w-48">
                {settingsStore.draft.diffViewMode === 'side-by-side' ? 'Side-by-side' : 'Unified'}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="unified" label="Unified" />
                <Select.Item value="side-by-side" label="Side-by-side" />
              </Select.Content>
            </Select.Root>
          </div>

          <Separator />

          <!-- Auto Install Dependencies -->
          <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox bind:checked={settingsStore.draft.autoInstallDeps} />
            Auto-install dependencies in new worktrees
          </label>
          <p class="text-xs text-muted-foreground -mt-2 ml-6">Run npm install automatically when creating a worktree. Off by default.</p>

          <Separator />

          <!-- Project Memory -->
          <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox bind:checked={settingsStore.draft.memoryAutoSave} />
            Auto-save project memory
          </label>
          <p class="text-xs text-muted-foreground -mt-2 ml-6">After substantial conversations, extract project knowledge and conversation notes into memory automatically. On by default.</p>

          <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox bind:checked={settingsStore.draft.memoryAutoCompact} />
            Auto-compact project memory
          </label>
          <p class="text-xs text-muted-foreground -mt-2 ml-6">When memory outgrows the agent's prompt budget, merge duplicates, resolve contradictions, and prune old conversation notes in the background. A backup is taken first. Costs an extra model call, so off by default.</p>

          <div class="ml-6">
            <Label class="mb-1 block">Compaction timeout</Label>
            <div class="flex items-center gap-2">
              <input
                type="number"
                min="30"
                step="30"
                bind:value={settingsStore.draft.memoryCompactTimeoutSeconds}
                class="w-20 text-sm bg-card border border-border px-2 py-1.5 text-foreground focus:outline-none focus:border-primary"
              />
              <span class="text-sm text-muted-foreground">seconds</span>
            </div>
            <p class="text-xs text-muted-foreground mt-1">Abort a compaction pass (manual or automatic) that runs longer than this. Minimum 30. Default 300 (5 minutes).</p>
          </div>

          <div class="ml-6">
            <Label for="settings-memory-model" class="mb-1 block">Memory model</Label>
            <input
              id="settings-memory-model"
              type="text"
              bind:value={settingsStore.draft.memoryModel}
              placeholder="e.g. claude-haiku-4-5"
              class="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p class="text-xs text-muted-foreground mt-1">Model used for background memory auto-save and compaction calls. Defaults to Haiku to keep these cheap. Leave empty to use the provider default.</p>
          </div>

          <Separator />

          <!-- Skill Suggestions -->
          <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox bind:checked={settingsStore.draft.autoSkillSuggestions} />
            Automatically suggest skills from conversation patterns
          </label>
          <p class="text-xs text-muted-foreground -mt-2 ml-6">After each finished turn, mine conversation history for recurring requests and commands and refresh skill suggestions — a background model call per run. Off by default; the "Suggest" button in the status bar's Skills popover runs the same analysis on demand.</p>

          <Separator />

          <!-- Idle Auto-Stop -->
          <div>
            <Label class="mb-1 block">Auto-stop idle conversations</Label>
            <div class="flex items-center gap-2">
              <input
                type="number"
                min="0"
                bind:value={settingsStore.draft.idleAutoStopMinutes}
                class="w-20 text-sm bg-card border border-border px-2 py-1.5 text-foreground focus:outline-none focus:border-primary"
              />
              <span class="text-sm text-muted-foreground">minutes</span>
            </div>
            <p class="text-xs text-muted-foreground mt-1">Disconnect a conversation after it's been idle this long (it auto-resumes when you click it). Set to 0 to disable. Default 30.</p>
          </div>

          <Separator />

          <!-- Analytics -->
          <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox bind:checked={settingsStore.draft.analyticsEnabled} />
            Help improve Grove Bench by sending anonymous usage data
          </label>
          <p class="text-xs text-muted-foreground -mt-2 ml-6">No personal information or code content is collected.</p>
          <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer {settingsStore.draft.analyticsEnabled ? '' : 'opacity-50'}">
            <Checkbox bind:checked={settingsStore.draft.crashReportsEnabled} disabled={!settingsStore.draft.analyticsEnabled} />
            Send crash reports
          </label>
          <p class="text-xs text-muted-foreground -mt-2 ml-6">When something goes wrong, send the error message and stack trace along with the usage data. Requires usage data to be on. Never includes prompts, code, or project paths.</p>
        </div>

      {:else if tab === 'mcp'}
        <!-- Configured servers -->
        <div class="flex items-start justify-between mb-3">
          <div>
            <div class="text-sm font-medium text-foreground">MCP Servers</div>
            <p class="text-xs text-muted-foreground mt-0.5">
              Servers from your Claude Code configuration. New and restarted conversations pick them up automatically.
            </p>
          </div>
          <Button variant="ghost" size="sm" onclick={() => mcpConfigStore.refresh()} disabled={mcpConfigStore.loading} class="text-xs shrink-0">
            Refresh
          </Button>
        </div>

        {#if mcpConfigStore.loading}
          <div class="flex items-center justify-center py-8 text-muted-foreground">
            <span class="w-3 h-3 bg-primary animate-pulse mr-2"></span>
            <span class="text-sm">Checking MCP server health — this can take a few seconds...</span>
          </div>
        {:else if mcpConfigStore.servers.length === 0}
          <p class="text-sm text-muted-foreground/60 text-center py-6">
            {mcpConfigStore.loaded ? 'No MCP servers configured yet.' : ''}
          </p>
        {:else}
          <div class="flex flex-col gap-1.5 mb-4">
            {#each mcpConfigStore.servers as server (server.name)}
              <div class="flex items-center gap-2.5 border border-border/50 px-2.5 py-2">
                <span class="w-1.5 h-1.5 shrink-0 {mcpStatusDot(server.status)}"></span>
                <div class="flex-1 min-w-0">
                  <div class="font-mono text-xs text-foreground truncate">{server.name}</div>
                  <div class="text-[10px] text-muted-foreground/60 truncate" title={server.target}>
                    {server.target}{server.transport ? ` · ${server.transport}` : ''} · {server.status}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-destructive hover:bg-destructive/10 text-xs shrink-0"
                  disabled={mcpConfigStore.actionInProgress !== null}
                  onclick={() => mcpConfigStore.remove(server.name)}
                >
                  {mcpConfigStore.actionInProgress === server.name ? 'Removing...' : 'Remove'}
                </Button>
              </div>
            {/each}
          </div>
        {/if}

        <Separator />

        <!-- Add a new server -->
        <div class="mt-3 space-y-3">
          <div class="text-sm font-medium text-foreground">Add MCP Server</div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label for="mcp-name" class="mb-1 block">Name</Label>
              <input
                id="mcp-name"
                type="text"
                bind:value={mcpName}
                placeholder="my-server"
                class="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <Label class="mb-1 block">Transport</Label>
              <Select.Root type="single" value={mcpTransport} onValueChange={(v) => { if (v) mcpTransport = v as typeof mcpTransport; }}>
                <Select.Trigger class="w-full">
                  {mcpTransports.find(t => t.value === mcpTransport)?.label}
                </Select.Trigger>
                <Select.Content>
                  {#each mcpTransports as t (t.value)}
                    <Select.Item value={t.value} label={t.label} />
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div>
            <Label for="mcp-command" class="mb-1 block">{mcpTransport === 'stdio' ? 'Command' : 'URL'}</Label>
            <input
              id="mcp-command"
              type="text"
              bind:value={mcpCommand}
              placeholder={mcpTransport === 'stdio' ? 'npx' : 'https://example.com/mcp'}
              class="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {#if mcpTransport === 'stdio'}
            <div>
              <Label for="mcp-args" class="mb-1 block">Arguments</Label>
              <input
                id="mcp-args"
                type="text"
                bind:value={mcpArgs}
                placeholder="-y my-mcp-server"
                class="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <Label for="mcp-env" class="mb-1 block">Environment Variables</Label>
              <textarea
                id="mcp-env"
                bind:value={mcpEnv}
                placeholder="API_KEY=xxx&#10;ONE_PER_LINE=value"
                class="w-full bg-background border border-input px-3 py-2 text-sm min-h-[48px] max-h-[120px] resize-y font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              ></textarea>
            </div>
          {:else}
            <div>
              <Label for="mcp-headers" class="mb-1 block">Headers</Label>
              <textarea
                id="mcp-headers"
                bind:value={mcpHeaders}
                placeholder="Authorization: Bearer xxx&#10;One header per line"
                class="w-full bg-background border border-input px-3 py-2 text-sm min-h-[48px] max-h-[120px] resize-y font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              ></textarea>
            </div>
          {/if}

          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label class="mb-1 block">Scope</Label>
              <Select.Root type="single" value={mcpScope} onValueChange={(v) => { if (v) mcpScope = v as McpConfigScope; }}>
                <Select.Trigger class="w-full">
                  {mcpScopes.find(s => s.value === mcpScope)?.label}
                </Select.Trigger>
                <Select.Content>
                  {#each mcpScopes as s (s.value)}
                    <Select.Item value={s.value} label={s.label} />
                  {/each}
                </Select.Content>
              </Select.Root>
              <p class="text-xs text-muted-foreground mt-1">
                {mcpScopes.find(s => s.value === mcpScope)?.description ?? ''}
              </p>
            </div>
            {#if mcpScope !== 'user'}
              <div>
                <Label class="mb-1 block">Project</Label>
                <Select.Root type="single" value={mcpRepo} onValueChange={(v) => { if (v) mcpRepo = v; }}>
                  <Select.Trigger class="w-full">
                    <span class="truncate">{mcpRepo || 'Select a project...'}</span>
                  </Select.Trigger>
                  <Select.Content>
                    {#each mcpRepos as repo (repo)}
                      <Select.Item value={repo} label={repo} />
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
            {/if}
          </div>

          <div class="flex items-center gap-3">
            <Button
              size="sm"
              onclick={addMcpServer}
              disabled={!mcpCanAdd || mcpConfigStore.actionInProgress !== null}
            >
              {mcpConfigStore.actionInProgress && mcpConfigStore.actionInProgress === mcpName.trim() ? 'Adding...' : 'Add Server'}
            </Button>
            {#if mcpAdded}
              <span class="text-xs text-green-400">
                Added "{mcpAdded}" — restart conversations to connect it.
              </span>
            {/if}
          </div>
        </div>

      {:else if tab === 'plugins'}
        <!-- Plugin sub-tabs -->
        <div class="flex items-center gap-1 border-b border-border mb-3">
          <button
            onclick={() => pluginTab = 'installed'}
            class="px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px
              {pluginTab === 'installed' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
          >
            Installed ({pluginStore.installed.length})
          </button>
          <button
            onclick={() => pluginTab = 'discover'}
            class="px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px
              {pluginTab === 'discover' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
          >
            Discover
          </button>
          <div class="flex-1"></div>
          <Button variant="ghost" size="sm" onclick={() => pluginStore.refresh()} disabled={pluginStore.loading} class="text-xs">
            Refresh
          </Button>
        </div>

        <!-- Plugin search -->
        <div class="mb-3">
          <input
            type="text"
            bind:value={pluginSearch}
            placeholder="Search plugins..."
            class="w-full bg-muted/50 border border-border px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {#if pluginStore.loading}
          <div class="flex items-center justify-center py-8 text-muted-foreground">
            <span class="w-3 h-3 bg-primary animate-pulse mr-2"></span>
            <span class="text-sm">Loading plugins...</span>
          </div>
        {:else if pluginTab === 'installed'}
          {#if filteredInstalled.length === 0}
            <p class="text-sm text-muted-foreground/60 text-center py-8">
              {pluginSearch ? 'No matching installed plugins.' : 'No plugins installed.'}
            </p>
          {:else}
            <div class="flex flex-col gap-2">
              {#each filteredInstalled as plugin (plugin.id)}
                <PluginCard
                  installed={plugin}
                  available={findAvailable(plugin.id)}
                  busy={pluginBusy}
                  onuninstall={(id) => pluginStore.uninstall(id)}
                  onenable={(id) => pluginStore.enable(id)}
                  ondisable={(id) => pluginStore.disable(id)}
                />
              {/each}
            </div>
          {/if}
        {:else}
          {#if filteredAvailable.length === 0}
            <p class="text-sm text-muted-foreground/60 text-center py-8">
              {pluginSearch ? 'No matching plugins found.' : 'All available plugins are already installed.'}
            </p>
          {:else}
            <div class="flex flex-col gap-2">
              {#each filteredAvailable as plugin (plugin.pluginId)}
                <PluginCard
                  available={plugin}
                  busy={pluginBusy}
                  oninstall={(id) => pluginStore.install(id)}
                />
              {/each}
            </div>
          {/if}
        {/if}
      {/if}
    </div>

    <Dialog.Footer class="mt-3">
      {#if tab !== 'plugins' && tab !== 'mcp'}
        <Button variant="ghost" size="sm" onclick={() => settingsStore.reset()} disabled={!settingsStore.dirty}>
          Reset
        </Button>
        <Button variant="secondary" size="sm" onclick={() => { try { settingsStore.reset(); } catch {} onclose(); }}>
          Cancel
        </Button>
        <Button size="sm" onclick={handleSave} disabled={!settingsStore.dirty || settingsStore.saving}>
          {settingsStore.saving ? 'Saving...' : 'Save'}
        </Button>
      {:else}
        <Button variant="secondary" size="sm" onclick={onclose}>
          Close
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
