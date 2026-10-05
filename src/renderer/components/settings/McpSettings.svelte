<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { mcpConfigStore } from '../../stores/mcpConfig.svelte.js';
  import { store } from '../../stores/sessions.svelte.js';
  import { agentsStore } from '../../stores/agents.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import SettingsGroup from './SettingsGroup.svelte';
  import McpAddDialog from './McpAddDialog.svelte';
  import PlusIcon from '@lucide/svelte/icons/plus';

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

  /** The Add server dialog is open. */
  let adding = $state(false);
  /** Servers just added, shown for a few seconds. */
  let added = $state<string | null>(null);
  /** Server whose Remove is waiting for a second click. */
  let confirmingRemove = $state<string | null>(null);
  // A pending Remove is for one row of one list: drop it when the list
  // changes (another project or agent, or a refresh).
  $effect(() => {
    void mcpConfigStore.servers;
    void mcpConfigStore.cwd;
    void mcpConfigStore.adapterType;
    confirmingRemove = null;
  });

  /** The agent's own wording for configured servers. */
  let rules = $derived(mcpAgent?.mcp?.config);

  /** Add errors show in the Add server dialog. */
  const listError = $derived(mcpConfigStore.errorKind !== 'add' ? mcpConfigStore.error : null);

  function showAdded(label: string) {
    added = label;
    setTimeout(() => { if (added === label) added = null; }, 8000);
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
          From {mcpAgent ? `${mcpAgent.displayName}'s` : "the agent's"} configuration. New and restarted threads pick them up.
        </p>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" onclick={() => mcpConfigStore.refresh()} disabled={mcpConfigStore.loading} class="text-xs">
          Refresh
        </Button>
        <span data-setting="mcp-add">
          <Button variant="outline" size="sm" onclick={() => (adding = true)} class="text-xs">
            <PlusIcon class="size-3.5" aria-hidden="true" />
            Add server
          </Button>
        </span>
      </div>
    </div>

    {#if added}
      <p class="text-xs text-green-400" role="status">Added {added}. Restart threads to connect.</p>
    {/if}

    <!-- Each agent keeps its own MCP configuration. -->
    {#if mcpAgents.length > 1}
      <div class="flex items-center gap-2 max-w-xl">
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
    <div class="flex items-center gap-2 max-w-xl">
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
                  {rules?.approvalHint ?? "Threads won't connect it until it is approved."}
                </div>
              {:else if server.status === 'rejected'}
                <div class="text-xs text-muted-foreground">
                  Turned down for this project. Approve it to let threads connect it.
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
                  title="Approve for this project and its threads"
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

{#if adding}
  <McpAddDialog {projectItems} onclose={() => (adding = false)} onadded={showAdded} />
{/if}
