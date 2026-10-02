<script lang="ts">
  import { Tabs } from 'bits-ui';
  import Fuse from 'fuse.js';
  import { pluginStore } from '../../stores/plugins.svelte.js';
  import { agentsStore } from '../../stores/agents.svelte.js';
  import PluginCard from '../PluginCard.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';

  let search = $state('');
  let view = $state('installed');

  const filteredInstalled = $derived.by(() => {
    if (!search.trim()) return pluginStore.installed;
    const fuse = new Fuse(pluginStore.installed, { keys: ['id'], threshold: 0.4 });
    return fuse.search(search).map((r) => r.item);
  });

  const filteredAvailable = $derived.by(() => {
    const notInstalled = pluginStore.available.filter(
      (a) => !pluginStore.isInstalled(a.pluginId)
    );
    if (!search.trim()) return notInstalled;
    const fuse = new Fuse(notInstalled, { keys: ['name', 'description'], threshold: 0.4 });
    return fuse.search(search).map((r) => r.item);
  });

  const busy = $derived(pluginStore.actionInProgress !== null);

  function findAvailable(installedId: string) {
    return pluginStore.available.find((a) => a.pluginId === installedId);
  }

  // Plugins configure the default agent (the IPC calls don't name an agent).
  const defaultAgent = $derived(agentsStore.get(agentsStore.defaultId));
  const agentNote = $derived(
    agentsStore.list.length > 1 && defaultAgent ? `These plugins are for ${defaultAgent.displayName} conversations.` : '',
  );

  const triggerClass = 'px-3 py-1 text-xs transition-colors text-muted-foreground hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
</script>

<div data-setting="plugins" class="flex flex-col gap-3">
  {#if agentNote}
    <p class="text-xs text-muted-foreground">{agentNote}</p>
  {/if}
  {#if pluginStore.error}
    <div class="text-xs text-destructive bg-destructive/10 px-3 py-2" role="alert">{pluginStore.error}</div>
  {/if}

  <Tabs.Root bind:value={view} class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <Tabs.List class="inline-flex border border-border" aria-label="Plugins">
        <Tabs.Trigger value="installed" class={triggerClass}>Installed ({pluginStore.installed.length})</Tabs.Trigger>
        <Tabs.Trigger value="discover" class={triggerClass}>Discover</Tabs.Trigger>
      </Tabs.List>
      <div class="flex-1"></div>
      <Button variant="ghost" size="sm" onclick={() => pluginStore.refresh()} disabled={pluginStore.loading} class="text-xs">
        Refresh
      </Button>
    </div>

    <Input type="search" bind:value={search} placeholder="Search plugins" aria-label="Search plugins" />

    {#if pluginStore.loading}
      <div class="flex items-center justify-center py-8 text-muted-foreground">
        <span class="w-3 h-3 bg-primary animate-pulse mr-2"></span>
        <span class="text-sm">Loading plugins...</span>
      </div>
    {:else}
      <Tabs.Content value="installed">
        {#if filteredInstalled.length === 0}
          <p class="text-sm text-muted-foreground text-center py-8">
            {#if search}
              No matching installed plugins.
            {:else}
              No plugins installed yet. Find some under
              <button type="button" class="text-primary hover:underline" onclick={() => (view = 'discover')}>Discover</button>.
            {/if}
          </p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each filteredInstalled as plugin (plugin.id)}
              <PluginCard
                installed={plugin}
                available={findAvailable(plugin.id)}
                {busy}
                onuninstall={(id) => pluginStore.uninstall(id)}
                onenable={(id) => pluginStore.enable(id)}
                ondisable={(id) => pluginStore.disable(id)}
              />
            {/each}
          </div>
        {/if}
      </Tabs.Content>
      <Tabs.Content value="discover">
        {#if filteredAvailable.length === 0}
          <p class="text-sm text-muted-foreground text-center py-8">
            {search ? 'No matching plugins found.' : 'All available plugins are already installed.'}
          </p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each filteredAvailable as plugin (plugin.pluginId)}
              <PluginCard
                available={plugin}
                {busy}
                oninstall={(id) => pluginStore.install(id)}
              />
            {/each}
          </div>
        {/if}
      </Tabs.Content>
    {/if}
  </Tabs.Root>
</div>
