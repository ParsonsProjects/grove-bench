<script lang="ts">
  /** Plan usage alerts, and the limits that pause a thread before its next
   *  tool call (shared/limits.ts, main's session-limits.ts). */
  import { onMount } from 'svelte';
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { formatUsd } from '../../../shared/limits.js';
  import NumberSetting from './NumberSetting.svelte';
  import SettingsGroup from './SettingsGroup.svelte';

  let todayUsd = $state<number | null>(null);

  onMount(() => {
    window.groveBench.getDailySpend().then((usd) => { todayUsd = usd; }, () => { /* shown without it */ });
  });
</script>

<SettingsGroup
  title="Plan usage alert"
  description="Agents that report plan usage (Claude Code, signed in with a plan) show it under Usage in the agent's settings. This tells you when a window gets close to its limit."
>
  <NumberSetting
    setting="plan-usage-alert"
    label="Alert when a usage window reaches"
    unit="%"
    min={0}
    max={100}
    value={settingsStore.draft.planUsageAlertPercent}
    onchange={(v) => { settingsStore.draft.planUsageAlertPercent = v; }}
    description="Once per window (the 5-hour and weekly ones) until it resets: in the app, and as a desktop notification while Grove Bench isn't focused (Notifications). 0 turns this off."
  />
</SettingsGroup>

<SettingsGroup
  title="Limits"
  description="When a limit is reached, the thread pauses before its next tool call and asks whether to go on. Continue lets it go on for another round of the limit (another $5, another 100 tool calls); Stop ends the turn. 0 turns a limit off."
>
  <NumberSetting
    setting="thread-spend-limit"
    label="Pause a thread once it has spent"
    unit="USD"
    cents
    value={settingsStore.draft.threadSpendLimitUsd}
    onchange={(v) => { settingsStore.draft.threadSpendLimitUsd = v; }}
  />
  <NumberSetting
    setting="daily-spend-limit"
    label="Pause every thread once today's spend reaches"
    unit="USD"
    cents
    value={settingsStore.draft.dailySpendLimitUsd}
    onchange={(v) => { settingsStore.draft.dailySpendLimitUsd = v; }}
    description="Across all threads. The day starts at midnight, your time.{todayUsd !== null ? ` Today so far: about ${formatUsd(todayUsd)}.` : ''}"
  />
  <p class="text-xs text-muted-foreground leading-relaxed -mt-2">
    Spend is the agent's own estimate, counted when each turn ends, so a turn already running finishes before it can pause.
    For Claude Code signed in with a plan it is the list price of what the turn used, not what you are billed.
    Agents that don't report a cost are never paused for spend.
  </p>
  <NumberSetting
    setting="turn-tool-call-limit"
    label="Pause a turn after"
    unit="tool calls"
    value={settingsStore.draft.turnToolCallLimit}
    onchange={(v) => { settingsStore.draft.turnToolCallLimit = v; }}
    description="Catches a turn that keeps going. Subagents' tool calls count toward their turn too."
  />
  <NumberSetting
    setting="turn-minutes-limit"
    label="Pause a turn after"
    unit="minutes"
    value={settingsStore.draft.turnMinutesLimit}
    onchange={(v) => { settingsStore.draft.turnMinutesLimit = v; }}
    description="Time spent waiting on you (a permission, a question) doesn't count."
  />
  <p class="text-xs text-muted-foreground leading-relaxed -mt-2">
    Claude Code is checked before every tool call. Other agents can only be paused before the calls they ask you about, so one set to act without asking runs on until it next asks.
  </p>
</SettingsGroup>
