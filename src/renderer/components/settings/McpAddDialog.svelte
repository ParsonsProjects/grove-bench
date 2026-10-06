<script lang="ts">
  import type { Snippet } from 'svelte';
  import { mcpConfigStore } from '../../stores/mcpConfig.svelte.js';
  import { store } from '../../stores/sessions.svelte.js';
  import { agentsStore } from '../../stores/agents.svelte.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { parseMcpJson } from '$lib/mcp-json.js';
  import type { McpConfigScope } from '../../../shared/types.js';

  /** Add an MCP server to the agent the Tool shed shows, from a form or a
   *  pasted JSON config. Opened from that section's Add server button. */
  let { projectItems, onclose, onadded }: {
    /** Select items for the projects to pick from. */
    projectItems: Snippet;
    onclose: () => void;
    /** Names of the servers just added. */
    onadded: (names: string) => void;
  } = $props();

  let open = $state(true);
  let nameInput = $state<HTMLInputElement | null>(null);

  let mcpAgent = $derived(agentsStore.get(mcpConfigStore.adapterType ?? agentsStore.defaultId));

  let name = $state('');
  let transport = $state<'stdio' | 'http' | 'sse'>('stdio');
  let command = $state('');
  let args = $state('');
  let env = $state('');
  let envError = $state<string | null>(null);
  let headers = $state('');
  let scope = $state<McpConfigScope>('user');
  let repo = $state('');
  /** Fill in fields, or paste a JSON config. */
  let addMode = $state<'form' | 'json'>('form');
  let json = $state('');
  /** An add was tried here, so an add error in the store is this dialog's. */
  let tried = $state(false);

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

  const addError = $derived(tried && mcpConfigStore.errorKind === 'add' ? mcpConfigStore.error : null);

  function close() {
    open = false;
    onclose();
  }

  async function addFromJson() {
    if (!jsonParsed?.ok || !canAddJson || mcpConfigStore.actionInProgress) return;
    const servers = jsonParsed.servers;
    tried = true;
    const done = await mcpConfigStore.addMany(servers.map((server) => ({
      ...server,
      scope,
      cwd: scope !== 'user' ? repo : undefined,
    })));
    if (done.length > 0) onadded(done.join(', '));
    // Some failed: stay open with the error, and the config to fix.
    if (done.length === servers.length) close();
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
    tried = true;
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
      onadded(serverName);
      close();
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) close(); }}>
  <Dialog.Content
    class="sm:max-w-xl max-h-[85vh] flex flex-col"
    onInteractOutside={(e) => e.preventDefault()}
    onOpenAutoFocus={(e) => { e.preventDefault(); nameInput?.focus(); }}
  >
    <Dialog.Header>
      <Dialog.Title>Add MCP server</Dialog.Title>
      <Dialog.Description>
        {#if rules?.shared}
          Adds it to the list every ACP agent gets. New and restarted threads pick it up.
        {:else}
          Adds it to {mcpAgent ? `${mcpAgent.displayName}'s` : "the agent's"} configuration. New and restarted threads pick it up.
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4 min-h-0 overflow-y-auto -mx-1 px-1">
      <div class="flex items-center border border-border text-xs self-start" role="group" aria-label="How to add">
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

      {#if addMode === 'form'}
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label for="mcp-name">Name</Label>
            <Input id="mcp-name" type="text" spellcheck={false} placeholder="e.g. my-server" bind:value={name} bind:ref={nameInput} />
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

      {#if addError}
        <div class="text-xs text-destructive bg-destructive/10 px-3 py-2 whitespace-pre-wrap" role="alert">{addError}</div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="secondary" onclick={close}>Cancel</Button>
      {#if addMode === 'form'}
        <Button onclick={addServer} disabled={!canAdd || mcpConfigStore.actionInProgress !== null}>
          {mcpConfigStore.actionKind === 'add' && mcpConfigStore.actionInProgress === name.trim() ? 'Adding...' : 'Add server'}
        </Button>
      {:else}
        {@const count = jsonParsed?.ok ? jsonParsed.servers.length : 0}
        <Button onclick={addFromJson} disabled={!canAddJson || mcpConfigStore.actionInProgress !== null}>
          {mcpConfigStore.actionKind === 'add' ? 'Adding...' : count > 1 ? `Add ${count} servers` : 'Add server'}
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
