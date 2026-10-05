<script lang="ts">
  import { settingsStore } from '../../stores/settings.svelte.js';
  import type { SettingsSectionId } from '$lib/settings-search.js';
  import { checkToolRulePattern } from '../../../shared/tool-rules.js';
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
  The permission mode new threads start in is set per agent, under
  <button type="button" class="text-primary hover:underline" onclick={() => ongoto('agents')}>Grovekeepers (Agents)</button>.
</p>

<SettingsGroup>
  <ListSetting
    setting="allow-rules"
    label="Tool allow rules"
    items={settingsStore.draft.toolAllowRules.map((r) => r.pattern)}
    placeholder="e.g. shell(npm run *)"
    removeLabel="Remove allow rule"
    examples={['shell(npm run *)', 'shell(git status)', 'web(*github.com*)', 'mcp(github__*)', 'question']}
    check={checkToolRulePattern}
    onadd={(v) => settingsStore.addToolAllowRule(v)}
    onremove={(i) => settingsStore.removeToolAllowRule(i)}
  >
    {#snippet help()}
      Matching actions run without asking. Write a keyword that works for any agent
      (<code>shell</code>, <code>edit</code>, <code>read</code>, <code>web</code>, <code>mcp</code>, <code>agent</code>, <code>question</code>),
      or a provider's own tool name such as <code>Bash</code>, with an optional pattern in brackets.
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
    examples={['shell(git push *)', 'shell(rm *)', 'shell(Remove-Item *)', 'web(*)']}
    check={checkToolRulePattern}
    onadd={(v) => settingsStore.addToolDenyRule(v)}
    onremove={(i) => settingsStore.removeToolDenyRule(i)}
  >
    {#snippet help()}
      Matching actions are refused without asking. Deny rules win over allow rules.
    {/snippet}
  </ListSetting>
</SettingsGroup>
