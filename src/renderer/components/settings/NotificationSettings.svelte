<script lang="ts">
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import type { TestNotificationResult } from '../../../shared/types.js';
  import CheckboxSetting from './CheckboxSetting.svelte';
  import SettingsGroup from './SettingsGroup.svelte';

  let testing = $state(false);
  let testResult = $state<TestNotificationResult | null>(null);

  async function sendTest() {
    testing = true;
    testResult = null;
    try {
      testResult = await window.groveBench.testNotification();
    } catch {
      testResult = 'failed';
    } finally {
      testing = false;
    }
  }
</script>

<SettingsGroup
  title="Desktop notifications"
  description="Shown only while the Grove Bench window isn't focused. Clicking one opens the thread."
>
  <CheckboxSetting setting="notify-turn-complete" label="Agent finishes a turn" bind:checked={settingsStore.draft.notifyOnTurnComplete} />
  <CheckboxSetting setting="notify-permission" label="Agent is waiting on a permission or question" bind:checked={settingsStore.draft.notifyOnPermission} />
  <CheckboxSetting setting="notify-pr-alert" label="PR activity: new CI failures and review comments" bind:checked={settingsStore.draft.notifyOnPrAlert} />

  <div data-setting="notify-test" class="flex flex-col gap-1.5">
    <Button variant="outline" size="sm" class="self-start" onclick={sendTest} disabled={testing}>
      {testing ? 'Sending...' : 'Send a test notification'}
    </Button>
    <p class="text-xs leading-relaxed {testResult === 'failed' ? 'text-destructive' : 'text-muted-foreground'}" aria-live="polite">
      {#if testResult === 'sent'}
        Sent. If it didn't appear, check Settings > System > Notifications in Windows: Grove Bench needs to be allowed, and Do not disturb (Focus assist on Windows 10) turned off.
      {:else if testResult === 'failed'}
        Windows couldn't show it. Check Settings > System > Notifications in Windows, and that Grove Bench is allowed there.
      {:else if testResult === 'unsupported'}
        This system doesn't support desktop notifications.
      {:else}
        Shows one now, even with this window in front.
      {/if}
    </p>
  </div>
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
    description="Shows how many threads need you."
    bind:checked={settingsStore.draft.notifyTaskbarBadge}
  />
</SettingsGroup>
