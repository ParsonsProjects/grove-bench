<script lang="ts">
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import SettingRow from './SettingRow.svelte';
  import CheckboxSetting from './CheckboxSetting.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { worktreeFolderError, worktreeFolderTooLong } from '../../../shared/worktree-folder.js';

  const folderError = $derived(worktreeFolderError(settingsStore.draft.worktreeFolder));
  const folderTooLong = $derived(!folderError && worktreeFolderTooLong(settingsStore.draft.worktreeFolder));
</script>

<SettingsGroup title="New branches">
  <SettingRow
    setting="default-base-branch"
    label="Default base branch"
    for="settings-base-branch"
    description="The branch new worktrees start from. Leave empty to use each project's default branch, such as main or master."
  >
    <Input
      id="settings-base-branch"
      type="text"
      class="max-w-sm"
      spellcheck={false}
      placeholder="Project's default branch"
      bind:value={settingsStore.draft.defaultBaseBranch}
    />
  </SettingRow>

  <SettingRow
    setting="branch-naming-rule"
    label="Branch naming rule"
    for="settings-branch-rule"
    description="How to name a branch when a new thread starts without one, in your own words. Leave empty to copy the style of the project's recent branches."
  >
    <Input
      id="settings-branch-rule"
      type="text"
      class="max-w-xl"
      spellcheck={false}
      placeholder="e.g. <type>/<ticket>-<short-description>"
      bind:value={settingsStore.draft.branchNamingRule}
    />
  </SettingRow>
</SettingsGroup>

<SettingsGroup title="New worktrees">
  <SettingRow
    setting="worktree-folder"
    label="Worktree folder"
    for="settings-worktree-folder"
    description="Where new worktrees go, outside your projects. A short folder on a Dev Drive, such as D:\wt, can make installs faster. Leave empty to use the app's data folder. Worktrees already made stay where they are."
  >
    <Input
      id="settings-worktree-folder"
      type="text"
      class="max-w-sm"
      spellcheck={false}
      placeholder="App data folder"
      bind:value={settingsStore.draft.worktreeFolder}
    />
    {#if folderError}
      <Notice tone="danger" class="max-w-xl"><p>{folderError}</p></Notice>
    {:else if folderTooLong}
      <Notice tone="warning" class="max-w-xl">
        <p>A long folder makes every path in its worktrees longer. Git and many build tools on Windows stop at 260 characters, and deep folders such as node_modules get close. A short one, such as D:\wt, is safest.</p>
      </Notice>
    {/if}
  </SettingRow>

  <CheckboxSetting
    setting="auto-install-deps"
    label="Auto-install dependencies"
    description="Install dependencies when a new worktree is created, with the project's package manager: npm, pnpm, Yarn or Bun, picked from its lockfile."
    bind:checked={settingsStore.draft.autoInstallDeps}
  />
</SettingsGroup>
