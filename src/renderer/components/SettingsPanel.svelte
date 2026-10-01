<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Tabs } from 'bits-ui';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { pluginStore } from '../stores/plugins.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { helpStore } from '../stores/help.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import {
    SETTINGS_SECTIONS, searchSettings, type SettingsEntry, type SettingsSectionId,
  } from '$lib/settings-search.js';
  import GeneralSettings from './settings/GeneralSettings.svelte';
  import AgentSettings from './settings/AgentSettings.svelte';
  import PermissionSettings from './settings/PermissionSettings.svelte';
  import GitSettings from './settings/GitSettings.svelte';
  import NotificationSettings from './settings/NotificationSettings.svelte';
  import BackgroundSettings from './settings/BackgroundSettings.svelte';
  import McpSettings from './settings/McpSettings.svelte';
  import PluginSettings from './settings/PluginSettings.svelte';
  import PrivacySettings from './settings/PrivacySettings.svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  let section = $state<SettingsSectionId>('general');
  let query = $state('');
  let content = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!open) return;
    // Untracked: the loads read store state (agentsStore.loaded), and a
    // change there, such as an agent reporting new models, would re-run
    // this. Settings only change through the settings store, so once loaded
    // they don't need reading again.
    untrack(() => {
      if (!settingsStore.loaded && !settingsStore.loading) settingsStore.load();
      pluginStore.refresh();
      agentsStore.load();
    });
  });

  // Every edit saves itself: watch the whole draft.
  $effect(() => {
    JSON.stringify(settingsStore.draft);
    untrack(() => settingsStore.scheduleSave());
  });

  // However Settings closes (Esc, the X, Close, Ctrl+,), save what is still
  // waiting, such as text typed in the last half second.
  $effect(() => {
    if (!open) untrack(() => {
      void settingsStore.save();
      // Reopening starts on the sections, not an old search.
      query = '';
    });
  });

  // The Plugins section configures the default agent (its IPC calls don't
  // name an agent), so it only shows when that agent supports it. The MCP
  // section picks its agent, so it shows when any agent can edit MCP config.
  // Until the agent list loads, both stay visible.
  const defaultAgent = $derived(agentsStore.get(agentsStore.defaultId));
  const visibleSections = $derived(SETTINGS_SECTIONS.filter((s) => {
    if (!defaultAgent) return true;
    if (s.id === 'mcp') return agentsStore.supporting('mcpConfig').length > 0;
    if (s.id === 'plugins') return defaultAgent.capabilities.plugins ?? true;
    return true;
  }));
  $effect(() => {
    if (!visibleSections.some((s) => s.id === section)) section = 'general';
  });

  // Opened at a section (settingsStore.openAt): show that one.
  $effect(() => {
    const wanted = settingsStore.requestedSection;
    if (!open || !wanted) return;
    untrack(() => {
      section = wanted;
      settingsStore.requestedSection = null;
    });
  });

  // A new section starts at its top.
  $effect(() => {
    void section;
    untrack(() => { if (content) content.scrollTop = 0; });
  });

  /** Settings that only show in some setups, and when they do: search
   *  shouldn't offer a row that isn't there. */
  const SHOWN_WHEN: Record<string, () => boolean> = {
    credentials: () => Object.values(store.prerequisites?.agents ?? {}).some((a) => a.apiKey),
    'thinking-summaries': () => agentsStore.list.some((a) => a.capabilities.thinkingSummaries),
    'project-colors': () => store.repos.length > 0,
  };
  const results = $derived(
    searchSettings(query, visibleSections.map((s) => s.id)).filter((e) => SHOWN_WHEN[e.id]?.() ?? true),
  );

  function sectionName(id: SettingsSectionId): string {
    return SETTINGS_SECTIONS.find((s) => s.id === id)?.grove ?? id;
  }

  /** Open a search result: its section, scrolled to the setting. */
  async function goTo(entry: SettingsEntry) {
    section = entry.section;
    query = '';
    // A section can still be loading its rows (Agents fetches each agent's
    // models), so look for the row for a little while.
    for (let i = 0; i < 40; i++) {
      await tick();
      const row = content?.querySelector<HTMLElement>(`[data-setting="${entry.id}"]`);
      if (row) {
        reveal(row);
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  function reveal(row: HTMLElement) {
    row.scrollIntoView?.({ block: 'center' });
    row.querySelector<HTMLElement>('input, textarea, button')?.focus({ preventScroll: true });
    row.animate?.(
      [{ backgroundColor: 'var(--accent)' }, { backgroundColor: 'transparent' }],
      { duration: 1500, easing: 'ease-out' },
    );
  }

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && results[0]) {
      e.preventDefault();
      goTo(results[0]);
    } else if (e.key === 'Escape' && query) {
      // Clear the search first; the next Escape closes Settings.
      e.preventDefault();
      e.stopPropagation();
      query = '';
    }
  }

  function openHelp() {
    onclose();
    helpStore.show('settings');
  }
</script>

<Dialog.Root {open} onOpenChange={(o) => { if (!o) onclose(); }}>
  <Dialog.Content
    class="sm:max-w-5xl w-[95vw] h-[85vh] max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden"
    onInteractOutside={(e) => e.preventDefault()}
  >
    <Dialog.Header class="px-6 pt-5 pb-4 border-b border-border">
      <Dialog.Title>Settings</Dialog.Title>
      <Dialog.Description>Changes save as you make them.</Dialog.Description>
    </Dialog.Header>

    <Tabs.Root
      value={section}
      onValueChange={(v) => (section = v as SettingsSectionId)}
      orientation="vertical"
      class="flex flex-1 min-h-0"
    >
      <div class="w-52 shrink-0 border-r border-border flex flex-col">
        <!-- Search stays put; the list under it scrolls in a short window. -->
        <div class="p-3 pb-2 shrink-0">
          <Input
            type="search"
            bind:value={query}
            placeholder="Search settings"
            aria-label="Search settings"
            class="h-8"
            onkeydown={onSearchKeydown}
          />
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-3 pb-3">

          {#if query.trim()}
            <ul class="flex flex-col gap-0.5" aria-label="Matching settings">
              {#each results as entry (entry.id)}
                <li>
                  <button
                    type="button"
                    onclick={() => goTo(entry)}
                    class="w-full text-left px-2 py-1.5 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span class="block text-sm text-foreground">{entry.label}</span>
                    <span class="block text-xs text-muted-foreground">{sectionName(entry.section)}</span>
                  </button>
                </li>
              {:else}
                <li class="px-2 py-1.5 text-xs text-muted-foreground">No settings match.</li>
              {/each}
            </ul>
          {/if}

          <Tabs.List class="flex flex-col gap-0.5 {query.trim() ? 'hidden' : ''}" aria-label="Settings sections">
            {#each visibleSections as s (s.id)}
              <Tabs.Trigger
                value={s.id}
                class="w-full text-left px-3 py-1.5 text-sm border-l-2 border-transparent text-muted-foreground transition-colors hover:text-foreground hover:bg-accent/30 data-[state=active]:border-primary data-[state=active]:bg-accent/50 data-[state=active]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span class="block">
                  {s.grove}
                  {#if s.id === 'plugins' && pluginStore.installed.length > 0}
                    <span class="text-muted-foreground ml-0.5">({pluginStore.installed.length})</span>
                  {/if}
                </span>
                <span class="block text-xs text-muted-foreground">{s.label}</span>
              </Tabs.Trigger>
            {/each}
          </Tabs.List>
        </div>
      </div>

      <div bind:this={content} class="flex-1 min-w-0 overflow-y-auto">
        {#each visibleSections as s (s.id)}
          <Tabs.Content value={s.id} class="px-6 py-5 outline-none">
            {#if section === s.id}
              <div class="max-w-2xl flex flex-col gap-8">
                <div>
                  <h3 class="text-base font-semibold text-foreground">{s.grove}</h3>
                  <p class="text-xs text-muted-foreground mt-1">{s.label}: {s.description}</p>
                </div>

                {#if !settingsStore.loaded && s.id !== 'mcp' && s.id !== 'plugins'}
                  {#if settingsStore.loading}
                    <div class="flex items-center justify-center py-8 text-muted-foreground">
                      <span class="w-3 h-3 bg-primary animate-pulse mr-2"></span>
                      <span class="text-sm">Loading settings...</span>
                    </div>
                  {:else}
                    <div class="text-xs text-destructive bg-destructive/10 px-3 py-2" role="alert">
                      Couldn't load settings{settingsStore.error ? `: ${settingsStore.error}` : '.'}
                      <button type="button" class="ml-1 underline" onclick={() => settingsStore.load()}>Try again</button>
                    </div>
                  {/if}
                {:else if s.id === 'general'}
                  <GeneralSettings />
                {:else if s.id === 'agents'}
                  <AgentSettings />
                {:else if s.id === 'permissions'}
                  <PermissionSettings ongoto={(id) => (section = id)} onhelp={openHelp} />
                {:else if s.id === 'git'}
                  <GitSettings />
                {:else if s.id === 'notifications'}
                  <NotificationSettings />
                {:else if s.id === 'background'}
                  <BackgroundSettings ongoto={(id) => (section = id)} />
                {:else if s.id === 'mcp'}
                  <McpSettings />
                {:else if s.id === 'plugins'}
                  <PluginSettings />
                {:else if s.id === 'privacy'}
                  <PrivacySettings />
                {/if}
              </div>
            {/if}
          </Tabs.Content>
        {/each}
      </div>
    </Tabs.Root>

    <div class="px-6 py-3 border-t border-border flex items-center gap-3">
      <div class="flex-1 min-w-0 text-xs" aria-live="polite">
        {#if settingsStore.loaded && settingsStore.error}
          <span class="text-destructive">Couldn't save: {settingsStore.error}</span>
          <button type="button" class="ml-1 text-primary hover:underline" onclick={() => settingsStore.save()}>Try again</button>
        {:else if settingsStore.saving || settingsStore.dirty}
          <span class="text-muted-foreground">Saving...</span>
        {:else if settingsStore.savedAt}
          <span class="text-muted-foreground">All changes saved</span>
        {/if}
      </div>
      <Button variant="ghost" size="sm" onclick={openHelp}>Help</Button>
      <Button variant="secondary" size="sm" onclick={onclose}>Close</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
