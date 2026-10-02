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

  const DIFF_VIEWS: { value: 'unified' | 'side-by-side'; label: string; description: string }[] = [
    { value: 'unified', label: 'Unified', description: 'Removed and added lines in one column.' },
    { value: 'side-by-side', label: 'Side-by-side', description: 'The old and new file next to each other.' },
  ];

  /** The same small change, drawn each way (in the diff panel's colours). */
  const EXAMPLE = {
    before: [{ n: 1, text: 'let n = sum(a);' }, { n: 2, text: 'return n;' }],
    after: [{ n: 1, text: 'let n = sum(a);' }, { n: 2, text: 'return n * 2;' }],
  };
</script>

{#snippet diffExample(mode: 'unified' | 'side-by-side')}
  <div class="font-mono text-[10px] leading-4 border border-border/60 bg-background overflow-hidden" aria-hidden="true">
    {#if mode === 'unified'}
      <div class="flex px-1.5 text-muted-foreground"><span class="w-4 shrink-0">1</span><span class="w-2.5 shrink-0"></span><span class="truncate">{EXAMPLE.before[0].text}</span></div>
      <div class="flex px-1.5 bg-red-950/30 text-red-300"><span class="w-4 shrink-0">2</span><span class="w-2.5 shrink-0">-</span><span class="truncate">{EXAMPLE.before[1].text}</span></div>
      <div class="flex px-1.5 bg-green-950/30 text-green-300"><span class="w-4 shrink-0">2</span><span class="w-2.5 shrink-0">+</span><span class="truncate">{EXAMPLE.after[1].text}</span></div>
    {:else}
      {#each EXAMPLE.before as left, i (i)}
        {@const right = EXAMPLE.after[i]}
        {@const changed = left.text !== right.text}
        <div class="grid grid-cols-2">
          <div class="flex px-1.5 border-r border-border/40 min-w-0 {changed ? 'bg-red-950/30 text-red-300' : 'text-muted-foreground'}"><span class="w-4 shrink-0">{left.n}</span><span class="truncate">{left.text}</span></div>
          <div class="flex px-1.5 min-w-0 {changed ? 'bg-green-950/30 text-green-300' : 'text-muted-foreground'}"><span class="w-4 shrink-0">{right.n}</span><span class="truncate">{right.text}</span></div>
        </div>
      {/each}
      <div class="grid grid-cols-2"><div class="border-r border-border/40 h-4"></div><div></div></div>
    {/if}
  </div>
{/snippet}

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

  <SettingRow
    setting="default-diff-view"
    label="Default diff view"
    description="How the Changes and Checkpoints tabs first show a file's changes. Each file can switch there, with its unified / side-by-side button or V."
  >
    <div role="radiogroup" aria-label="Default diff view" class="grid grid-cols-2 gap-3 max-w-xl">
      {#each DIFF_VIEWS as view (view.value)}
        <label
          class="flex flex-col gap-2 border border-border p-3 cursor-pointer transition-colors hover:border-foreground/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
        >
          <span class="flex items-center gap-2 text-sm text-foreground">
            <input type="radio" name="settings-diff-view" value={view.value} bind:group={settingsStore.draft.diffViewMode} class="accent-primary" />
            {view.label}
          </span>
          {@render diffExample(view.value)}
          <span class="text-xs text-muted-foreground">{view.description}</span>
        </label>
      {/each}
    </div>
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
