<script lang="ts">
  /**
   * Agents from the ACP Registry (main's catalogs.ts), to add as one of the
   * user's own agents without looking up how to start them. Each shows how to
   * install it (a command to copy, or a download) and "Use" fills in the add
   * form; nothing is installed or added until the user does it.
   */
  import { onMount } from 'svelte';
  import type { RegistryAgentSummary } from '../../../shared/types.js';
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import CommandLine from '../CommandLine.svelte';

  let { onUse }: { onUse: (agent: { name: string; command: string; args: string[] }) => void } = $props();

  let agents = $state<RegistryAgentSummary[]>([]);
  let loaded = $state(false);
  let refreshing = $state(false);
  let query = $state('');
  let icons = $state<Record<string, string | null>>({});
  let open = $state<string | null>(null);

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => !q || `${a.name} ${a.id} ${a.description ?? ''}`.toLowerCase().includes(q));
  });

  async function load() {
    try {
      agents = await window.groveBench.listRegistryAgents();
    } catch (e) {
      console.warn('[registry] list failed:', e);
    } finally {
      loaded = true;
    }
    for (const a of agents) {
      if (a.id in icons) continue;
      icons[a.id] = null;
      window.groveBench.getRegistryIcon(a.id).then((url) => { icons[a.id] = url; }).catch(() => {});
    }
  }

  async function refresh() {
    refreshing = true;
    try {
      await window.groveBench.refreshCatalogs();
      await load();
    } finally {
      refreshing = false;
    }
  }

  onMount(load);
</script>

<div class="flex flex-col gap-2" data-testid="registry-agents">
  <div class="flex items-center gap-2">
    <p class="text-xs font-medium text-foreground flex-1">From the ACP Registry</p>
    {#if settingsStore.current.onlineCatalogs}
      <button type="button" class="text-xs text-primary hover:underline disabled:opacity-50" disabled={refreshing} onclick={refresh}>
        {refreshing ? 'Checking…' : 'Check for new agents'}
      </button>
    {/if}
  </div>
  {#if !loaded}
    <p class="text-xs text-muted-foreground">Loading…</p>
  {:else if agents.length === 0}
    <p class="text-xs text-muted-foreground">
      {#if settingsStore.current.onlineCatalogs}
        Not downloaded yet. Grove Bench gets the list once a day, or now with <span class="text-foreground">Check for new agents</span>.
      {:else}
        Turn on <span class="text-foreground">Look up agents and models online</span> in Privacy to see the agents in the public ACP Registry.
      {/if}
    </p>
  {:else}
    <Input type="search" bind:value={query} placeholder="Search {agents.length} agents" aria-label="Search the ACP Registry" class="max-w-xs" />
    <ul class="flex flex-col max-h-72 overflow-y-auto border border-border" aria-label="ACP Registry agents">
      {#each shown as agent (agent.id)}
        {@const icon = icons[agent.id]}
        <li class="border-b border-border last:border-b-0">
          <button
            type="button"
            class="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent"
            aria-expanded={open === agent.id}
            onclick={() => open = open === agent.id ? null : agent.id}
          >
            <!-- Registry icons are monochrome SVGs: a mask takes the text colour. -->
            <span
              class="size-4 shrink-0 {icon ? 'bg-foreground' : 'bg-muted'}"
              style={icon ? `mask: url("${icon}") center / contain no-repeat; -webkit-mask: url("${icon}") center / contain no-repeat;` : ''}
              aria-hidden="true"
            ></span>
            <span class="text-foreground">{agent.name}</span>
            <span class="text-muted-foreground/60">{agent.version}</span>
            {#if agent.builtIn}<span class="text-[10px] uppercase tracking-wide text-muted-foreground/60">built in</span>{/if}
            <span class="flex-1 min-w-0 truncate text-muted-foreground">{agent.description ?? ''}</span>
          </button>
          {#if open === agent.id}
            <div class="flex flex-col gap-1.5 px-2 pb-2 text-xs">
              {#if agent.description}<p class="text-muted-foreground">{agent.description}</p>{/if}
              {#if agent.install && 'command' in agent.install}
                <p class="text-muted-foreground">Install it by running this in a terminal:</p>
                <CommandLine command={agent.install.command} label="Install {agent.name}" />
              {:else if agent.install && 'download' in agent.install}
                {@const url = agent.install.download}
                <button type="button" class="self-start text-primary hover:underline" onclick={() => window.groveBench.openExternal(url)}>Download {agent.name} for this computer</button>
              {/if}
              <div class="flex items-center gap-3">
                {#if agent.builtIn}
                  <span class="text-muted-foreground">Already in Grove Bench under its own name.</span>
                {:else if agent.launch}
                  {@const launch = agent.launch}
                  <button type="button" class="text-primary hover:underline" onclick={() => onUse({ name: agent.name, command: launch.command, args: launch.args })}>Use</button>
                  <span class="text-muted-foreground/70">Fills in the form below with <code>{[launch.command, ...launch.args].join(' ')}</code>, which downloads the package the first time it starts.</span>
                {:else}
                  <span class="text-muted-foreground/70">After downloading, add it below with the path to the program.</span>
                {/if}
                {#if agent.website}
                  {@const site = agent.website}
                  <button type="button" class="text-primary hover:underline" onclick={() => window.groveBench.openExternal(site)}>Website</button>
                {/if}
              </div>
            </div>
          {/if}
        </li>
      {:else}
        <li class="px-2 py-1.5 text-xs text-muted-foreground">No agent matches.</li>
      {/each}
    </ul>
  {/if}
</div>
