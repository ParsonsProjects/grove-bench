<script lang="ts">
  /**
   * The Skills badge in the status bar: how many skills the thread's agent
   * has, how many are on and how many suggestions wait (Claude Code). Opens
   * the Skills drawer (SkillsPanel). Reports its skill count to the bar.
   */
  import { onMount } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
  import { mergeSkills } from '../lib/skills-merge.js';
  import type { SkillInfo } from '../../shared/types.js';

  let { sessionId, count = $bindable(0) }: { sessionId: string; count?: number } = $props();

  let systemInfo = $derived(messageStore.getSystemInfo(sessionId));
  let repoPath = $derived(store.sessions.find((s) => s.id === sessionId)?.repoPath ?? '');
  let agentId = $derived(store.sessions.find((s) => s.id === sessionId)?.agentType ?? agentsStore.defaultId ?? '');
  /** Claude Code, whose skills Grove turns off and suggests. */
  let managed = $derived(agentsStore.loaded && agentsStore.supports(agentId, 'skills'));

  let diskSkills = $state<SkillInfo[]>([]);
  let suggestionCount = $state(0);
  /** On-disk scan merged with the session's init report (plugin skills). */
  let allSkills = $derived(mergeSkills(diskSkills, systemInfo.skills));
  let disabledSkills = $derived(managed ? settingsStore.current.disabledSkills ?? [] : []);
  let enabledSkillCount = $derived(allSkills.filter((s) => !disabledSkills.includes(s.name)).length);
  let disabledSkillCount = $derived(allSkills.length - enabledSkillCount);

  async function refresh() {
    try {
      diskSkills = await window.groveBench.listSkills(sessionId, repoPath) ?? [];
    } catch { /* keep the last snapshot */ }
    try {
      suggestionCount = repoPath ? (await window.groveBench.getSkillSuggestions(repoPath) ?? []).length : 0;
    } catch { /* keep the last count */ }
  }

  // The drawer can add, turn off or resolve skills: count again when it closes.
  let wasOpen = false;
  $effect(() => {
    const open = skillsPanelStore.open;
    if (wasOpen && !open) void refresh();
    wasOpen = open;
  });

  $effect(() => { count = allSkills.length; });

  onMount(() => {
    void agentsStore.load();
    // Populate the badge up front: it shouldn't wait for the drawer.
    void refresh();
  });
</script>

{#if allSkills.length > 0}
  <button
    onclick={() => skillsPanelStore.showThread()}
    class="flex items-center gap-1 whitespace-nowrap transition-colors text-muted-foreground hover:text-foreground"
    title="Skills — click to run, schedule or manage them{disabledSkillCount > 0 ? ` (${disabledSkillCount} disabled)` : ''}"
    aria-haspopup="dialog"
  >
    <!-- Turning skills off is a choice, not a fault, so no warning
         colours here (MCP's are for real failures): grey with none on. -->
    <span class="w-1.5 h-1.5 {enabledSkillCount === 0 ? 'bg-muted-foreground/40' : 'bg-green-500'}"></span>
    Skills {disabledSkillCount > 0 ? `${enabledSkillCount}/${allSkills.length}` : allSkills.length}
    {#if managed && suggestionCount > 0}
      <span class="text-blue-400" title="{suggestionCount} suggested skill{suggestionCount === 1 ? '' : 's'} from your threads">+{suggestionCount}</span>
    {/if}
  </button>
{/if}
