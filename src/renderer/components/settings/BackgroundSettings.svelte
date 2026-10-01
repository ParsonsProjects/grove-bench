<script lang="ts">
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { MEMORY_COMPACT_MAX_TIMEOUT_SECONDS, MEMORY_COMPACT_MIN_TIMEOUT_SECONDS } from '../../../shared/compact-timeout.js';
  import type { SettingsSectionId } from '$lib/settings-search.js';
  import CheckboxSetting from './CheckboxSetting.svelte';
  import NumberSetting from './NumberSetting.svelte';
  import SettingsGroup from './SettingsGroup.svelte';

  let { ongoto }: { ongoto: (section: SettingsSectionId) => void } = $props();
</script>

<p class="text-xs text-muted-foreground leading-relaxed">
  Memory and skill suggestions run on each conversation's own agent, using its background model, set under
  <button type="button" class="text-primary hover:underline" onclick={() => ongoto('agents')}>Grovekeepers (Agents)</button>.
</p>

<SettingsGroup title="Project memory">
  <CheckboxSetting
    setting="memory-auto-save"
    label="Auto-save project memory"
    description="After substantial conversations, save what was learned about the project, and notes on the conversation, to memory."
    bind:checked={settingsStore.draft.memoryAutoSave}
  />
  <CheckboxSetting
    setting="memory-auto-compact"
    label="Auto-compact project memory"
    description="When memory outgrows the agent's prompt budget, merge and prune it in the background. A backup is taken first. Costs an extra model call."
    bind:checked={settingsStore.draft.memoryAutoCompact}
  />
  <NumberSetting
    setting="memory-compact-timeout"
    label="Compaction timeout"
    unit="seconds"
    min={MEMORY_COMPACT_MIN_TIMEOUT_SECONDS}
    max={MEMORY_COMPACT_MAX_TIMEOUT_SECONDS}
    value={settingsStore.draft.memoryCompactTimeoutSeconds}
    onchange={(v) => { settingsStore.draft.memoryCompactTimeoutSeconds = v; }}
    description="Stop a compaction pass, manual or automatic, that runs longer than this. From {MEMORY_COMPACT_MIN_TIMEOUT_SECONDS} to {MEMORY_COMPACT_MAX_TIMEOUT_SECONDS} (an hour)."
  />
</SettingsGroup>

<SettingsGroup title="Skill suggestions">
  <CheckboxSetting
    setting="skill-suggestions"
    label="Suggest skills automatically"
    description="After each finished turn, look for requests and commands you repeat and suggest skills for them. Costs a model call each time. The Suggest button in the status bar's Skills popover does the same on demand."
    bind:checked={settingsStore.draft.autoSkillSuggestions}
  />
</SettingsGroup>

<SettingsGroup title="Idle conversations">
  <NumberSetting
    setting="idle-sleep"
    label="Sleep idle conversations after"
    unit="minutes"
    min={0}
    value={settingsStore.draft.idleSleepMinutes}
    onchange={(v) => { settingsStore.draft.idleSleepMinutes = v; }}
    description="Stops a conversation's agent to save memory and CPU. It wakes when you open it or send it a message, with the same mode and &quot;always allow&quot; choices. 0 turns this off."
  />
</SettingsGroup>
