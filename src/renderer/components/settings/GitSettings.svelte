<script lang="ts">
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import SettingRow from './SettingRow.svelte';
  import CheckboxSetting from './CheckboxSetting.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
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
  <CheckboxSetting
    setting="auto-install-deps"
    label="Auto-install dependencies"
    description="Run npm install when a new worktree is created."
    bind:checked={settingsStore.draft.autoInstallDeps}
  />
</SettingsGroup>
