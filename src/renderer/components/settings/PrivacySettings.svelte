<script lang="ts">
  import { settingsStore } from '../../stores/settings.svelte.js';
  import CheckboxSetting from './CheckboxSetting.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
</script>

<SettingsGroup>
  <CheckboxSetting
    setting="analytics"
    label="Send anonymous usage data"
    description="Helps improve Grove Bench. No personal information or code is collected."
    bind:checked={settingsStore.draft.analyticsEnabled}
  />
  <CheckboxSetting
    setting="crash-reports"
    label="Send crash reports"
    description="When something goes wrong, send the error message and stack trace with the usage data. Needs usage data on. Never includes prompts, code or project paths."
    disabled={!settingsStore.draft.analyticsEnabled}
    bind:checked={settingsStore.draft.crashReportsEnabled}
  />
</SettingsGroup>
