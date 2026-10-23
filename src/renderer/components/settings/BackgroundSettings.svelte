<script lang="ts">
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { MEMORY_COMPACT_MAX_TIMEOUT_SECONDS, MEMORY_COMPACT_MIN_TIMEOUT_SECONDS } from '../../../shared/compact-timeout.js';
  import type { SettingsSectionId } from '$lib/settings-search.js';
  import CheckboxSetting from './CheckboxSetting.svelte';
  import NumberSetting from './NumberSetting.svelte';
  import SettingsGroup from './SettingsGroup.svelte';

  let { ongoto }: { ongoto: (section: SettingsSectionId) => void } = $props();
</script>

<p class="text-xs text-muted-foreground leading-relaxed">
  Memory, skill suggestions and thread goals run on each thread's own agent, using its background model, set under
  <Button variant="link" size="inline" onclick={() => ongoto('agents')}>Grovekeepers (Agents)</Button>.
</p>

<SettingsGroup title="Project memory">
  <CheckboxSetting
    setting="memory-auto-save"
    label="Auto-save project memory"
    description="After substantial threads, save what was learned about the project, and notes on the thread, to memory."
    bind:checked={settingsStore.draft.memoryAutoSave}
  />
  <NumberSetting
    setting="memory-compact-timeout"
    label="Compaction timeout"
    unit="seconds"
    min={MEMORY_COMPACT_MIN_TIMEOUT_SECONDS}
    max={MEMORY_COMPACT_MAX_TIMEOUT_SECONDS}
    value={settingsStore.draft.memoryCompactTimeoutSeconds}
    onchange={(v) => { settingsStore.draft.memoryCompactTimeoutSeconds = v; }}
    description="Stop a compaction step (planning, or one merge) that runs longer than this. From {MEMORY_COMPACT_MIN_TIMEOUT_SECONDS} to {MEMORY_COMPACT_MAX_TIMEOUT_SECONDS} (an hour)."
  />
</SettingsGroup>

<SettingsGroup title="Threads">
  <CheckboxSetting
    setting="prompt-suggestions"
    label="Suggest the next prompt"
    description="After each turn, show a guess at your next message in the empty message box. Press Tab to use it. Claude Code makes it from the thread's prompt cache, which costs little; a Claude Code thread that is already running picks up a change when its agent next starts. Other agents cost a model call per turn, on their background model."
    bind:checked={settingsStore.draft.promptSuggestions}
  />
  <CheckboxSetting
    setting="skill-suggestions"
    label="Suggest skills automatically"
    description="After each finished turn, look for requests and commands you repeat and suggest skills for them. Costs a model call each time. The Suggest button in the status bar's Skills popover does the same on demand."
    bind:checked={settingsStore.draft.autoSkillSuggestions}
  />
  <CheckboxSetting
    setting="conversation-goal"
    label="Show the thread goal"
    description="Pin a line at the top of the Thread tab saying what the thread is for, written after its first reply, and show it when you hover the thread in the sidebar. Costs one model call per thread, plus one each time you press Refresh. You can edit it or hide it per thread."
    bind:checked={settingsStore.draft.showConversationGoal}
  />
  <NumberSetting
    setting="idle-sleep"
    label="Sleep idle threads after"
    unit="minutes"
    min={0}
    value={settingsStore.draft.idleSleepMinutes}
    onchange={(v) => { settingsStore.draft.idleSleepMinutes = v; }}
    description="Stops a thread's agent to save memory and CPU. It wakes when you open it or send it a message, with the same mode and &quot;always allow&quot; choices. 0 turns this off."
  />
</SettingsGroup>
