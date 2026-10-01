<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { mcpConfigStore } from '../../stores/mcpConfig.svelte.js';
  import { store } from '../../stores/sessions.svelte.js';
  import { agentsStore } from '../../stores/agents.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { parseMcpJson } from '$lib/mcp-json.js';
  import type { McpConfigScope } from '../../../shared/types.js';
  import SettingsGroup from './SettingsGroup.svelte';

  /** Agents whose MCP config Grove can edit, and the one the section shows
   *  (undefined in the store: the default agent). */
  let mcpAgents = $derived(agentsStore.supporting('mcpConfig'));
  let mcpAgent = $derived(agentsStore.get(mcpConfigStore.adapterType ?? agentsStore.defaultId));

  // Listing health-checks every server (slow, e.g. `claude mcp list`), so it
  // loads on the first visit here rather than whenever Settings opens.
  // Keyed on `attempted`, not `loaded`: a listing that fails (no CLI on PATH,
  // a deleted project) would otherwise start another straight away.
  $effect(() => {
    if (mcpConfigStore.attempted || mcpConfigStore.loading) return;
    untrack(() => {
      // Start with the open conversation's agent (if it can edit MCP config)
      // and project: project and local servers only list for one project.
      const active = store.activeSession;
      mcpConfigStore.adapterType ??= mcpAgents.find((a) => a.id === active?.agentType)?.id;
      mcpConfigStore.showProject(mcpConfigStore.cwd ?? active?.repoPath ?? store.repos[0]);
    });
  });

  let mcpRepos = $state<string[]>([]);
  onMount(() => {
    window.groveBench.listRepos().then((repos) => { mcpRepos = repos; }).catch(() => {});
  });
  /** Projects to pick from: those with conversations plus any opened this run. */
  let projectOptions = $derived([...new Set([...mcpRepos, ...store.repos])]);
  const NO_PROJECT = '__none__';

  let name = $state('');
  let transport = $state<'stdio' | 'http' | 'sse'>('stdio');
  let command = $state('');
  let args = $state('');
  let env = $state('');
  let envError = $state<string | null>(null);
  let headers = $state('');
  let scope = $state<McpConfigScope>('user');
  let repo = $state('');
  let added = $state<string | null>(null);
  /** Add form mode: fill in fields, or paste a JSON config. */
  let addMode = $state<'form' | 'json'>('form');
  let json = $state('');
  /** Server whose Remove is waiting for a second click. */
  let confirmingRemove = $state<string | null>(null);

  /** Scopes for an agent that doesn't describe its own. */
  const DEFAULT_SCOPES: { value: McpConfigScope; label: string; description: string }[] = [
    { value: 'user', label: 'User', description: 'Available in all projects on this machine' },
    { value: 'project', label: 'Project', description: 'Shared with the team in the project repository' },
    { value: 'local', label: 'Local', description: 'Only this machine, only the chosen project' },
  ];

  /** The agent's own scopes, wording and name rule for configured servers. */
  let rules = $derived(mcpAgent?.mcp?.config);
  let scopes = $derived(rules?.scopes ?? DEFAULT_SCOPES);
  let jsonParsed = $derived(
    addMode === 'json' && json.trim()
      ? parseMcpJson(json, name, rules ? { pattern: rules.namePattern, rule: rules.nameRule } : undefined)
      : null,
  );

  // Adding to a project defaults to the project the list shows.
  $effect(() => {
    if (scope !== 'user' && !repo && mcpConfigStore.cwd) repo = mcpConfigStore.cwd;
  });
  // Another agent may not offer the scope that was picked.
  $effect(() => {
    if (!scopes.some((s) => s.value === scope)) scope = scopes[0]?.value ?? 'user';
  });

  const transports: { value: 'stdio' | 'http' | 'sse'; label: string }[] = [
    { value: 'stdio', label: 'stdio (local command)' },
    { value: 'http', label: 'HTTP' },
    { value: 'sse', label: 'SSE' },
  ];

  const canAdd = $derived(
    name.trim() !== '' && command.trim() !== '' && (scope === 'user' || repo !== ''),
  );
  const canAddJson = $derived(
    jsonParsed?.ok === true && (scope === 'user' || repo !== ''),
  );

  /** Errors show next to what caused them: the list, or the add form. */
  const listError = $derived(mcpConfigStore.errorKind !== 'add' ? mcpConfigStore.error : null);
  const addError = $derived(mcpConfigStore.errorKind === 'add' ? mcpConfigStore.error : null);

  function showAdded(label: string) {
    added = label;
    setTimeout(() => { if (added === label) added = null; }, 8000);
  }

  async function addFromJson() {
    if (!jsonParsed?.ok || !canAddJson || mcpConfigStore.actionInProgress) return;
    const servers = jsonParsed.servers;
    const done = await mcpConfigStore.addMany(servers.map((server) => ({
      ...server,
      scope,
      cwd: scope !== 'user' ? repo : undefined,
    })));
    if (done.length === servers.length) {
      json = '';
      name = '';
    }
    if (done.length > 0) showAdded(done.join(', '));
  }

  async function addServer() {
    if (!canAdd || mcpConfigStore.actionInProgress) return;
    const envVars: Record<string, string> = {};
    for (const line of env.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) {
        envError = `Write each variable as KEY=value (got "${trimmed}").`;
        return;
      }
      envVars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    envError = null;
    const headerLines = headers.split('\n').map((h) => h.trim()).filter(Boolean);

    const serverName = name.trim();
    const ok = await mcpConfigStore.add({
      name: serverName,
      transport,
      commandOrUrl: command.trim(),
      args: transport === 'stdio' ? args.trim().split(/\s+/).filter(Boolean) : undefined,
      env: transport === 'stdio' && Object.keys(envVars).length > 0 ? envVars : undefined,
      headers: transport !== 'stdio' && headerLines.length > 0 ? headerLines : undefined,
      scope,
      cwd: scope !== 'user' ? repo : undefined,
    });
    if (ok) {
      name = ''; command = ''; args = ''; env = ''; headers = '';
      showAdded(serverName);
    }
  }

  function statusLabel(status: string): string {
    return status === 'needs-approval' ? 'needs approval' : status;
  }

  function statusDot(status: string): string {
    return status === 'connected' ? 'bg-green-500'
      : status === 'pending' ? 'bg-yellow-400 animate-pulse'
      : status === 'needs-auth' || status === 'needs-approval' ? 'bg-yellow-500'
      : status === 'disabled' || status === 'rejected' ? 'bg-muted-foreground'
      : 'bg-red-500';
  }
</script>

{#snippet projectItems()}
  {#each projectOptions as option (option)}
    <Select.Item value={option} label={store.repoDisplayName(option)}>
      {#snippet children()}
        <div class="flex flex-col min-w-0">
          <span class="truncate">{store.repoDisplayName(option)}</span>
          <span class="text-xs text-muted-foreground truncate">{option}</span>
        </div>
      {/snippet}
    </Select.Item>
  {/each}
{/snippet}

<SettingsGroup>
  <div data-setting="mcp-servers" class="flex flex-col gap-3">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h4 class="text-sm font-semibold text-foreground">Configured servers</h4>
        <p class="text-xs text-muted-foreground leading-relaxed mt-1">
          From {mcpAgent ? `${mcpAgent.displayName}'s` : "the agent's"} configuration. New and restarted conversations pick them up.
        </p>
      </div>
      <Button variant="ghost" size="sm" onclick={() => mcpConfigStore.refresh()} disabled={mcpConfigStore.loading} class="text-xs shrink-0">
        Refresh
      </Button>
    </div>

    <!-- Each agent keeps its own MCP configuration. -->
    {#if mcpAgents.length > 1}
      <div class="flex items-center gap-2">
        <Label for="settings-mcp-agent" class="text-xs w-16 shrink-0">Agent</Label>
        <Select.Root type="single" value={mcpAgent?.id ?? ''} onValueChange={(v) => { if (v) mcpConfigStore.showAgent(v); }}>
          <Select.Trigger id="settings-mcp-agent" class="w-full" disabled={mcpConfigStore.loading}>
            <span class="truncate">{mcpAgent?.displayName ?? 'Select an agent...'}</span>
          </Select.Trigger>
          <Select.Content>
            {#each mcpAgents as agent (agent.id)}
              <Select.Item value={agent.id} label={agent.displayName} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {/if}

    <!-- Project and local servers belong to one project, so the list is for one project at a time. -->
    <div class="flex items-center gap-2">
      <Label for="settings-mcp-project" class="text-xs w-16 shrink-0">Project</Label>
      <Select.Root
        type="single"
        value={mcpConfigStore.cwd ?? NO_PROJECT}
        onValueChange={(v) => { if (v) mcpConfigStore.showProject(v === NO_PROJECT ? undefined : v); }}
      >
        <Select.Trigger id="settings-mcp-project" class="w-full" disabled={mcpConfigStore.loading} title={mcpConfigStore.cwd}>
          <span class="truncate">{mcpConfigStore.cwd ? store.repoDisplayName(mcpConfigStore.cwd) : 'None (user servers only)'}</span>
        </Select.Trigger>
        <Select.Content>
          <Select.Item value={NO_PROJECT} label="None (user servers only)" />
          {@render projectItems()}
        </Select.Content>
      </Select.Root>
    </div>

    {#if listError}
      <div class="text-xs text-destructive bg-destructive/10 px-3 py-2 whitespace-pre-wrap" role="alert">{listError}</div>
    {/if}

    {#if mcpConfigStore.loading}
      <div class="flex items-center justify-center py-6 text-muted-foreground">
        <span class="w-3 h-3 bg-primary animate-pulse mr-2"></span>
        <span class="text-sm">Checking MCP server health. This can take a few seconds...</span>
      </div>
    {:else if mcpConfigStore.servers.length === 0}
      {#if mcpConfigStore.loaded}
        <p class="text-sm text-muted-foreground text-center py-4">No MCP servers configured yet.</p>
      {/if}
    {:else}
      <ul class="flex flex-col gap-1.5" aria-label="Configured MCP servers">
        {#each mcpConfigStore.servers as server (server.name)}
          {@const unapproved = server.status === 'needs-approval' || server.status === 'rejected'}
          <li class="flex items-center gap-2.5 border border-border px-2.5 py-2">
            <span class="w-2 h-2 shrink-0 {statusDot(server.status)}" aria-hidden="true"></span>
            <div class="flex-1 min-w-0">
              <div class="font-mono text-xs text-foreground truncate">{server.name}</div>
              <div class="text-xs text-muted-foreground truncate" title={server.target}>
                {server.target}{server.transport ? ` · ${server.transport}` : ''} · {statusLabel(server.status)}
              </div>
              {#if server.managedBy}
                <div class="text-xs text-muted-foreground">{server.managedBy.hint}</div>
              {:else if server.status === 'needs-approval'}
                <div class="text-xs text-muted-foreground">
                  {rules?.approvalHint ?? "Conversations won't connect it until it is approved."}
                </div>
              {:else if server.status === 'rejected'}
                <div class="text-xs text-muted-foreground">
                  Turned down for this project. Approve it to let conversations connect it.
                </div>
              {/if}
            </div>
            {#if server.managedBy}
              <!-- Owned by something else (e.g. a plugin): the agent can't remove it -->
              <span class="text-xs text-muted-foreground border border-border px-1.5 py-0.5 shrink-0">
                {server.managedBy.label}
              </span>
            {:else if confirmingRemove === server.name}
              <span class="text-xs text-foreground shrink-0">Remove {server.name}?</span>
              <Button
                variant="destructive"
                size="sm"
                class="text-xs shrink-0"
                disabled={mcpConfigStore.actionInProgress !== null}
                onclick={() => { confirmingRemove = null; mcpConfigStore.remove(server.name); }}
              >
                Remove
              </Button>
              <Button variant="ghost" size="sm" class="text-xs shrink-0" onclick={() => (confirmingRemove = null)}>
                Cancel
              </Button>
            {:else}
              {#if unapproved && mcpConfigStore.cwd && rules?.approvalHint}
                <Button
                  variant="outline"
                  size="sm"
                  class="text-xs shrink-0"
                  disabled={mcpConfigStore.actionInProgress !== null}
                  onclick={() => mcpConfigStore.approve(server.name)}
                  title="Approve for this project and its conversations"
                >
                  {mcpConfigStore.actionInProgress === server.name && mcpConfigStore.actionKind === 'approve' ? 'Approving...' : 'Approve'}
                </Button>
              {/if}
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive hover:bg-destructive/10 text-xs shrink-0"
                disabled={mcpConfigStore.actionInProgress !== null}
                onclick={() => (confirmingRemove = server.name)}
              >
                {mcpConfigStore.actionInProgress === server.name && mcpConfigStore.actionKind === 'remove' ? 'Removing...' : 'Remove'}
              </Button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</SettingsGroup>

<SettingsGroup>
  <div data-setting="mcp-add" class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-3">
      <h4 class="text-sm font-semibold text-foreground">Add MCP server</h4>
      <div class="flex items-center border border-border text-xs" role="group" aria-label="How to add">
        <button
          type="button"
          aria-pressed={addMode === 'form'}
          onclick={() => (addMode = 'form')}
          class="px-2.5 py-1 transition-colors {addMode === 'form' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}"
        >Form</button>
        <button
          type="button"
          aria-pressed={addMode === 'json'}
          onclick={() => (addMode = 'json')}
          class="px-2.5 py-1 transition-colors {addMode === 'json' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}"
        >Paste JSON</button>
      </div>
    </div>

    {#if addMode === 'form'}
      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1.5">
          <Label for="mcp-name">Name</Label>
          <Input id="mcp-name" type="text" spellcheck={false} placeholder="e.g. my-server" bind:value={name} />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="mcp-transport">Transport</Label>
          <Select.Root type="single" value={transport} onValueChange={(v) => { if (v) transport = v as typeof transport; }}>
            <Select.Trigger id="mcp-transport" class="w-full">
              {transports.find((t) => t.value === transport)?.label}
            </Select.Trigger>
            <Select.Content>
              {#each transports as t (t.value)}
                <Select.Item value={t.value} label={t.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="mcp-command">{transport === 'stdio' ? 'Command' : 'URL'}</Label>
        <Input
          id="mcp-command"
          type="text"
          spellcheck={false}
          placeholder={transport === 'stdio' ? 'e.g. npx' : 'e.g. https://example.com/mcp'}
          bind:value={command}
        />
      </div>

      {#if transport === 'stdio'}
        <div class="flex flex-col gap-1.5">
          <Label for="mcp-args">Arguments</Label>
          <Input id="mcp-args" type="text" spellcheck={false} placeholder="e.g. -y my-mcp-server" bind:value={args} />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="mcp-env">Environment variables</Label>
          <Textarea
            id="mcp-env"
            spellcheck={false}
            bind:value={env}
            aria-invalid={envError ? true : undefined}
            aria-describedby="mcp-env-help"
            class="min-h-12 max-h-32 resize-y font-mono"
            oninput={() => (envError = null)}
          />
          {#if envError}
            <p class="text-xs text-destructive">{envError}</p>
          {/if}
          <p id="mcp-env-help" class="text-xs text-muted-foreground">One per line, as <code>KEY=value</code>.</p>
        </div>
      {:else}
        <div class="flex flex-col gap-1.5">
          <Label for="mcp-headers">Headers</Label>
          <Textarea
            id="mcp-headers"
            spellcheck={false}
            bind:value={headers}
            aria-describedby="mcp-headers-help"
            class="min-h-12 max-h-32 resize-y font-mono"
          />
          <p id="mcp-headers-help" class="text-xs text-muted-foreground">One per line, e.g. <code>Authorization: Bearer xxx</code>.</p>
        </div>
      {/if}
    {:else}
      <div class="flex flex-col gap-1.5">
        <Label for="mcp-json">JSON config</Label>
        <Textarea
          id="mcp-json"
          bind:value={json}
          placeholder={'{\n  "mcpServers": {\n    "my-server": { "command": "npx", "args": ["-y", "my-mcp-server"] }\n  }\n}'}
          spellcheck={false}
          class="text-xs min-h-32 max-h-72 resize-y font-mono"
        />
        <p class="text-xs text-muted-foreground leading-relaxed">
          Paste the config from a server's README, Claude Desktop or another client. A config without a name uses the Name below.
        </p>
      </div>
      {#if jsonParsed && !jsonParsed.ok}
        <p class="text-xs text-destructive">{jsonParsed.error}</p>
        {#if jsonParsed.needsName}
          <div class="flex flex-col gap-1.5">
            <Label for="mcp-json-name">Name</Label>
            <Input id="mcp-json-name" type="text" spellcheck={false} placeholder="e.g. my-server" bind:value={name} />
          </div>
        {/if}
      {:else if jsonParsed?.ok}
        <ul class="flex flex-col gap-1" aria-label="Servers found">
          {#each jsonParsed.servers as server (server.name)}
            <li class="text-xs border border-border px-2.5 py-1.5 min-w-0 text-muted-foreground">
              <span class="font-mono text-foreground">{server.name}</span>
              · {server.transport} ·
              <span class="font-mono truncate" title={[server.commandOrUrl, ...(server.args ?? [])].join(' ')}>{[server.commandOrUrl, ...(server.args ?? [])].join(' ')}</span>
              {#if server.env} · {Object.keys(server.env).length} env{/if}
              {#if server.headers} · {server.headers.length} header{server.headers.length === 1 ? '' : 's'}{/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

    <div class="grid grid-cols-2 gap-3">
      <div class="flex flex-col gap-1.5">
        <Label for="mcp-scope">Scope</Label>
        <Select.Root type="single" value={scope} onValueChange={(v) => { if (v) scope = v as McpConfigScope; }}>
          <Select.Trigger id="mcp-scope" class="w-full">
            {scopes.find((s) => s.value === scope)?.label}
          </Select.Trigger>
          <Select.Content>
            {#each scopes as s (s.value)}
              <Select.Item value={s.value} label={s.label} />
            {/each}
          </Select.Content>
        </Select.Root>
        <p class="text-xs text-muted-foreground">
          {scopes.find((s) => s.value === scope)?.description ?? ''}
        </p>
      </div>
      {#if scope !== 'user'}
        <div class="flex flex-col gap-1.5">
          <Label for="mcp-repo">Project</Label>
          <Select.Root type="single" value={repo} onValueChange={(v) => { if (v) repo = v; }}>
            <Select.Trigger id="mcp-repo" class="w-full" title={repo || undefined}>
              <span class="truncate">{repo ? store.repoDisplayName(repo) : 'Select a project...'}</span>
            </Select.Trigger>
            <Select.Content>
              {@render projectItems()}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}
    </div>

    <div class="flex items-center gap-3">
      {#if addMode === 'form'}
        <Button size="sm" onclick={addServer} disabled={!canAdd || mcpConfigStore.actionInProgress !== null}>
          {mcpConfigStore.actionKind === 'add' && mcpConfigStore.actionInProgress === name.trim() ? 'Adding...' : 'Add server'}
        </Button>
      {:else}
        {@const count = jsonParsed?.ok ? jsonParsed.servers.length : 0}
        <Button size="sm" onclick={addFromJson} disabled={!canAddJson || mcpConfigStore.actionInProgress !== null}>
          {mcpConfigStore.actionKind === 'add' ? 'Adding...' : count > 1 ? `Add ${count} servers` : 'Add server'}
        </Button>
      {/if}
      {#if added}
        <span class="text-xs text-green-400" role="status">
          Added {added}. Restart conversations to connect.
        </span>
      {/if}
    </div>
    {#if addError}
      <div class="text-xs text-destructive bg-destructive/10 px-3 py-2 whitespace-pre-wrap" role="alert">{addError}</div>
    {/if}
  </div>
</SettingsGroup>
