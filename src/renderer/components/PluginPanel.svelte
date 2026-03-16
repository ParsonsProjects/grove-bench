<script lang="ts">
  import { onMount } from 'svelte';
  import { pluginStore } from '../stores/plugins.svelte.js';
  import PluginCard from './PluginCard.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import Fuse from 'fuse.js';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  let tab = $state<'installed' | 'discover'>('installed');
  let search = $state('');

  const filteredInstalled = $derived.by(() => {
    if (!search.trim()) return pluginStore.installed;
    const fuse = new Fuse(pluginStore.installed, { keys: ['id'], threshold: 0.4 });
    return fuse.search(search).map((r) => r.item);
  });

  const filteredAvailable = $derived.by(() => {
    // Filter out already-installed plugins
    const notInstalled = pluginStore.available.filter(
      (a) => !pluginStore.isInstalled(a.pluginId)
    );
    if (!search.trim()) return notInstalled;
    const fuse = new Fuse(notInstalled, { keys: ['name', 'description'], threshold: 0.4 });
    return fuse.search(search).map((r) => r.item);
  });

  const busy = $derived(pluginStore.actionInProgress !== null);

  function handleInstall(pluginId: string) {
    pluginStore.install(pluginId);
  }

  function handleUninstall(pluginId: string) {
    pluginStore.uninstall(pluginId);
  }

  function handleEnable(pluginId: string) {
    pluginStore.enable(pluginId);
  }

  function handleDisable(pluginId: string) {
    pluginStore.disable(pluginId);
  }

  // Find the matching available plugin for an installed one (to get description)
  function findAvailable(installedId: string) {
    return pluginStore.available.find((a) => a.pluginId === installedId);
  }

  $effect(() => {
    if (open) {
      pluginStore.refresh();
    }
  });
</script>

<Dialog.Root {open} onOpenChange={(o) => { if (!o) onclose(); }}>
  <Dialog.Content class="max-w-lg max-h-[80vh] flex flex-col">
    <Dialog.Header>
      <Dialog.Title>Plugins</Dialog.Title>
      <Dialog.Description>
        Manage Claude Code plugins. Changes apply to new agent sessions.
      </Dialog.Description>
    </Dialog.Header>

    <!-- Tabs -->
    <div class="flex items-center gap-1 border-b border-border mt-2">
      <button
        onclick={() => tab = 'installed'}
        class="px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px
          {tab === 'installed' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        Installed ({pluginStore.installed.length})
      </button>
      <button
        onclick={() => tab = 'discover'}
        class="px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px
          {tab === 'discover' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        Discover
      </button>
    </div>

    <!-- Search -->
    <div class="mt-2">
      <input
        type="text"
        bind:value={search}
        placeholder="Search plugins..."
        class="w-full bg-muted/50 border border-border rounded px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>

    <!-- Error -->
    {#if pluginStore.error}
      <div class="mt-2 text-xs text-destructive bg-destructive/10 px-3 py-2">
        {pluginStore.error}
      </div>
    {/if}

    <!-- Content -->
    <div class="flex-1 overflow-auto mt-2 min-h-0">
      {#if pluginStore.loading}
        <div class="flex items-center justify-center py-8 text-muted-foreground">
          <span class="w-3 h-3 bg-primary animate-pulse mr-2"></span>
          <span class="text-sm">Loading plugins...</span>
        </div>
      {:else if tab === 'installed'}
        {#if filteredInstalled.length === 0}
          <p class="text-sm text-muted-foreground/60 text-center py-8">
            {search ? 'No matching installed plugins.' : 'No plugins installed.'}
          </p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each filteredInstalled as plugin (plugin.id)}
              <PluginCard
                installed={plugin}
                available={findAvailable(plugin.id)}
                {busy}
                onuninstall={handleUninstall}
                onenable={handleEnable}
                ondisable={handleDisable}
              />
            {/each}
          </div>
        {/if}
      {:else}
        {#if filteredAvailable.length === 0}
          <p class="text-sm text-muted-foreground/60 text-center py-8">
            {search ? 'No matching plugins found.' : 'All available plugins are already installed.'}
          </p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each filteredAvailable as plugin (plugin.pluginId)}
              <PluginCard
                available={plugin}
                {busy}
                oninstall={handleInstall}
              />
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <Dialog.Footer class="mt-3">
      <Button variant="ghost" size="sm" onclick={() => pluginStore.refresh()} disabled={pluginStore.loading}>
        Refresh
      </Button>
      <Button variant="secondary" size="sm" onclick={onclose}>
        Close
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
