<script lang="ts">
  import { settingsStore } from '../../stores/settings.svelte.js';
  import CheckboxSetting from './CheckboxSetting.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
</script>

<SettingsGroup
  title="Desktop notifications"
  description="Shown only while the Grove Bench window isn't focused. Clicking one opens the conversation."
>
  <CheckboxSetting setting="notify-turn-complete" label="Agent finishes a turn" bind:checked={settingsStore.draft.notifyOnTurnComplete} />
  <CheckboxSetting setting="notify-permission" label="Agent is waiting on a permission or question" bind:checked={settingsStore.draft.notifyOnPermission} />
  <CheckboxSetting setting="notify-pr-alert" label="PR activity: new CI failures and review comments" bind:checked={settingsStore.draft.notifyOnPrAlert} />
</SettingsGroup>

<SettingsGroup title="Taskbar">
  <CheckboxSetting
    setting="taskbar-flash"
    label="Flash the taskbar button"
    description="Stops when you switch back to Grove Bench."
    bind:checked={settingsStore.draft.notifyTaskbarFlash}
  />
  <CheckboxSetting
    setting="taskbar-badge"
    label="Badge the taskbar icon"
    description="Shows how many conversations need you."
    bind:checked={settingsStore.draft.notifyTaskbarBadge}
  />
</SettingsGroup>
