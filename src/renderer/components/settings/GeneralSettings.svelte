<script lang="ts">
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { store } from '../../stores/sessions.svelte.js';
  import { DEFAULT_REPO_COLORS } from '../../lib/repo-colors.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { VIEW_MODE_DESCRIPTIONS, VIEW_MODE_LABELS } from '$lib/message-view.js';
  import { ACTIVITY_VIEW_MODES, type ActivityViewMode } from '../../../shared/types.js';
  import SettingRow from './SettingRow.svelte';
  import CheckboxSetting from './CheckboxSetting.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import UpdateSettings from '../UpdateSettings.svelte';

  const draft = $derived(settingsStore.draft);
</script>

<SettingsGroup title="Views">
  <SettingRow
    setting="default-thread-view"
    label="Default thread view"
    for="settings-thread-view"
    description="{VIEW_MODE_DESCRIPTIONS[draft.defaultActivityView] ?? VIEW_MODE_DESCRIPTIONS.summary}. New conversations start in this view; each can switch from its Thread tab."
  >
    <Select.Root type="single" value={draft.defaultActivityView} onValueChange={(v) => { if (v) settingsStore.draft.defaultActivityView = v as ActivityViewMode; }}>
      <Select.Trigger id="settings-thread-view" class="w-48">
        {VIEW_MODE_LABELS[draft.defaultActivityView] ?? 'Summary'}
      </Select.Trigger>
      <Select.Content>
        {#each ACTIVITY_VIEW_MODES as mode (mode)}
          <Select.Item value={mode} label={VIEW_MODE_LABELS[mode]} />
        {/each}
      </Select.Content>
    </Select.Root>
  </SettingRow>

  <SettingRow setting="default-diff-view" label="Default diff view" for="settings-diff-view">
    <Select.Root type="single" value={draft.diffViewMode} onValueChange={(v) => { if (v) settingsStore.draft.diffViewMode = v as 'unified' | 'side-by-side'; }}>
      <Select.Trigger id="settings-diff-view" class="w-48">
        {draft.diffViewMode === 'side-by-side' ? 'Side-by-side' : 'Unified'}
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="unified" label="Unified" />
        <Select.Item value="side-by-side" label="Side-by-side" />
      </Select.Content>
    </Select.Root>
  </SettingRow>
</SettingsGroup>

<SettingsGroup title="Appearance">
  <CheckboxSetting
    setting="grove-characters"
    label="Show grove characters"
    description="Small pixel agents show each conversation's status by pose as well as colour: in the sidebar, in prompts, and on empty tabs."
    bind:checked={settingsStore.draft.groveCharacters}
  />

  {#if store.repos.length > 0}
    <div data-setting="project-colors" class="flex flex-col gap-1.5">
      <Label>Project colors</Label>
      <p class="text-xs text-muted-foreground leading-relaxed">Accent colors show which conversations and tabs belong to each project.</p>
      <ul class="flex flex-col gap-1.5 mt-1">
        {#each store.repos as repo, i (repo)}
          {@const name = store.repoDisplayName(repo)}
          {@const custom = draft.repoColors[repo]}
          {@const currentColor = custom || DEFAULT_REPO_COLORS[i % DEFAULT_REPO_COLORS.length]}
          <li class="flex items-center gap-2 min-w-0">
            <label class="relative size-6 shrink-0 cursor-pointer border border-input hover:border-foreground/40 focus-within:ring-2 focus-within:ring-ring transition-colors" style="background-color: {currentColor}">
              <input
                type="color"
                value={currentColor}
                aria-label="Color for {name}"
                onchange={(e) => {
                  const target = e.target as HTMLInputElement;
                  settingsStore.draft.repoColors = { ...settingsStore.draft.repoColors, [repo]: target.value };
                }}
                class="absolute inset-0 opacity-0 cursor-pointer"
              />
            </label>
            <span class="text-sm text-foreground truncate" title={repo}>{name}</span>
            {#if custom}
              <button
                type="button"
                onclick={() => {
                  const { [repo]: _, ...rest } = settingsStore.draft.repoColors;
                  settingsStore.draft.repoColors = rest;
                }}
                class="text-xs text-primary hover:underline shrink-0"
                aria-label="Use the default color for {name}"
              >
                Use default
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</SettingsGroup>

<SettingsGroup title="Window and editor">
  <CheckboxSetting
    setting="always-on-top"
    label="Always on top"
    description="Keep the Grove Bench window above other windows."
    bind:checked={settingsStore.draft.alwaysOnTop}
  />
  <CheckboxSetting
    setting="spellcheck"
    label="Spell checking"
    description="Check spelling in the prompt editor."
    bind:checked={settingsStore.draft.spellcheck}
  />
</SettingsGroup>

<SettingsGroup title="Updates">
  <UpdateSettings />
</SettingsGroup>
