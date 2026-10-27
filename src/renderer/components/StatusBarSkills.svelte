<script lang="ts">
  /**
   * The thread's skills, counted for the bar's MCP · Skills lozenge
   * (StatusBarCapabilities, which opens the Skills drawer): how many the
   * thread's agent has, how many are on and how many suggestions wait
   * (Claude Code). Draws nothing itself.
   */
  import { onMount } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
  import { mergeSkills } from '../lib/skills-merge.js';
  import type { SkillInfo } from '../../shared/types.js';

  let {
    sessionId,
    count = $bindable(0),
    enabled = $bindable(0),
    suggestions = $bindable(0),
  }: {
    sessionId: string;
    /** Every skill the agent has. */
    count?: number;
    /** The ones turned on. */
    enabled?: number;
    /** Suggested skills from your threads (Claude Code only). */
    suggestions?: number;
  } = $props();

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
  $effect(() => { enabled = enabledSkillCount; });
  $effect(() => { suggestions = managed ? suggestionCount : 0; });

  onMount(() => {
    void agentsStore.load();
    // Count up front: the lozenge shouldn't wait for the drawer.
    void refresh();
  });
</script>
