<script lang="ts">
  import { settingsStore } from '../../stores/settings.svelte.js';
  import type { SettingsSectionId } from '$lib/settings-search.js';
  import ListSetting from './ListSetting.svelte';
  import SettingsGroup from './SettingsGroup.svelte';

  let { ongoto, onhelp }: {
    ongoto: (section: SettingsSectionId) => void;
    /** Open the Settings help page. */
    onhelp: () => void;
  } = $props();
</script>

<!-- The default mode depends on the agent and model, so it lives with each
     agent's other defaults. -->
<p class="text-xs text-muted-foreground leading-relaxed">
  The permission mode new conversations start in is set per agent, under
  <button type="button" class="text-primary hover:underline" onclick={() => ongoto('agents')}>Grovekeepers (Agents)</button>.
</p>

<SettingsGroup>
  <ListSetting
    setting="allow-rules"
    label="Tool allow rules"
    items={settingsStore.draft.toolAllowRules.map((r) => r.pattern)}
    placeholder="e.g. shell(npm run *)"
    removeLabel="Remove allow rule"
    onadd={(v) => settingsStore.addToolAllowRule(v)}
    onremove={(i) => settingsStore.removeToolAllowRule(i)}
  >
    {#snippet help()}
      Matching actions run without asking. Rules work for any agent:
      <code>shell(npm run *)</code>, <code>edit(src/**)</code>, <code>read(**/.env*)</code>,
      <code>web(*github.com*)</code>, <code>mcp(github__*)</code>, <code>agent</code>, <code>question</code>.
      A provider's own tool name also works, e.g. <code>Bash(git push *)</code>.
      <button type="button" class="text-primary hover:underline" onclick={onhelp}>How rules match</button>
    {/snippet}
  </ListSetting>

  <ListSetting
    setting="deny-rules"
    label="Tool deny rules"
    tone="destructive"
    items={settingsStore.draft.toolDenyRules.map((r) => r.pattern)}
    placeholder="e.g. shell(git push *)"
    removeLabel="Remove deny rule"
    onadd={(v) => settingsStore.addToolDenyRule(v)}
    onremove={(i) => settingsStore.removeToolDenyRule(i)}
  >
    {#snippet help()}
      Matching actions are refused without asking. Deny rules win over allow rules.
    {/snippet}
  </ListSetting>
</SettingsGroup>
