<script lang="ts">
  /**
   * The Skills drawer's This thread tab: the skills the thread's agent can
   * use, each with Run (in a new thread now) and Schedule. For Claude Code,
   * whose skills Grove manages, also turning them off and on, suggestions
   * mined from past threads, and the Add Skill dialog.
   */
  import { onMount } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { schedulesStore } from '../stores/schedules.svelte.js';
  import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
  import { mergeSkills } from '../lib/skills-merge.js';
  import { startSkillThread } from '../lib/skill-thread.js';
  import type { SkillPromptOpts } from '../lib/skill-prompt.js';
  import { lazyComponent } from '../lib/lazy-component.js';
  import type { SkillInfo, SkillSuggestion } from '../../shared/types.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PlayIcon from '@lucide/svelte/icons/play';
  import ClockIcon from '@lucide/svelte/icons/clock';

  let { sessionId }: { sessionId: string } = $props();

  // The dialog loads when first opened.
  const loadAddSkillDialog = lazyComponent(() => import('./AddSkillDialog.svelte'));

  let systemInfo = $derived(messageStore.getSystemInfo(sessionId));
  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  let repoPath = $derived(session?.repoPath ?? '');
  /** The thread's agent: the skills listed are its own. */
  let agentId = $derived(session?.agentType ?? agentsStore.defaultId ?? '');
  /** Grove manages this agent's skills (turn off, suggest, add): Claude Code
   *  only, and only once the agent list says so. Any agent's skills can be
   *  run and scheduled. */
  let managed = $derived(agentsStore.loaded && agentsStore.supports(agentId, 'skills'));

  let addSkillOpen = $state(false);
  let diskSkills = $state<SkillInfo[]>([]);
  let skillsBusy = $state<Record<string, boolean>>({});
  /** On-disk scan merged with the session's init report (plugin skills). */
  let allSkills = $derived(mergeSkills(diskSkills, systemInfo.skills));
  /** Claude Code's turned-off skills; another agent reading the same folder
   *  still uses them. */
  let disabledSkills = $derived(managed ? settingsStore.current.disabledSkills ?? [] : []);

  const skillSourceLabels: Record<SkillInfo['source'], string> = {
    project: 'project',
    user: 'user',
    session: 'plugin',
  };

  async function refreshSkills() {
    try {
      diskSkills = await window.groveBench.listSkills(sessionId, repoPath) ?? [];
    } catch { /* keep the last snapshot */ }
  }

  async function setSkillEnabled(name: string, enabled: boolean) {
    skillsBusy = { ...skillsBusy, [name]: true };
    try {
      await settingsStore.setSkillDisabled(name, !enabled);
    } catch { /* settingsStore.error carries the message */ }
    finally {
      skillsBusy = { ...skillsBusy, [name]: false };
    }
  }

  /** Run a skill now in a new thread on this thread's agent and model. The
   *  new thread takes the screen, so the drawer closes once it starts; if it
   *  doesn't, the drawer stays as it was, with the reason in a toast. */
  async function runSkill(skill: SkillInfo) {
    if (!repoPath || !agentId) return;
    const started = await schedulesStore.runSkill({
      repoPath,
      agentId,
      model: messageStore.getModel(sessionId) || undefined,
      skill: skill.name,
      note: '',
      start: store.isFolderProject(repoPath) ? 'folder' : 'new',
      permissionMode: '',
    });
    if (started) skillsPanelStore.close();
  }

  // ─── Skill suggestions (mined from session history) ───

  let suggestions = $state<SkillSuggestion[]>([]);
  let analyzingSuggestions = $state(false);
  let addSkillInitial = $state<{ name: string; description: string; instructions: string; scope?: 'project' | 'user' } | null>(null);

  async function refreshSuggestions() {
    if (!repoPath) return;
    try {
      suggestions = await window.groveBench.getSkillSuggestions(repoPath) ?? [];
    } catch { /* keep the last snapshot */ }
  }

  async function analyzeSuggestions() {
    if (analyzingSuggestions || !repoPath) return;
    analyzingSuggestions = true;
    try {
      suggestions = await window.groveBench.analyzeSkillSuggestions(repoPath) ?? [];
    } catch { /* analysis is best-effort */ }
    finally {
      analyzingSuggestions = false;
    }
  }

  async function dismissSkillSuggestion(id: string) {
    suggestions = suggestions.filter((s) => s.id !== id);
    try {
      await window.groveBench.dismissSkillSuggestion(repoPath, id);
    } catch { /* worst case it reappears on the next analysis */ }
  }

  function createFromSuggestion(s: SkillSuggestion) {
    addSkillInitial = { name: s.name, description: s.description, instructions: s.draftInstructions };
    addSkillOpen = true;
  }

  /** Hand a skill to the agent in a new thread. A suggestion of the same
   *  name is resolved straight away, as for a manual create, so it can't be
   *  handed off twice while the thread starts. If the thread can't start,
   *  the Add Skill dialog opens with the skill, so nothing is lost; the
   *  drawer closes only once the thread starts, as it holds that dialog. */
  async function askAgent(skill: SkillPromptOpts) {
    const suggested = suggestions.find((s) => s.name === skill.name);
    if (suggested) dismissSkillSuggestion(suggested.id);
    if (await startSkillThread(sessionId, skill)) {
      skillsPanelStore.close();
      return;
    }
    // The dialog shows over whatever is on screen, so only over this thread.
    if (store.activeSessionId !== sessionId) return;
    addSkillInitial = { name: skill.name, description: skill.description, instructions: skill.notes ?? '', scope: skill.scope };
    addSkillOpen = true;
  }

  /** Hand the suggestion to the agent, with the mined evidence as draft notes. */
  function askAgentFromSuggestion(s: SkillSuggestion) {
    void askAgent({
      name: s.name,
      description: s.description,
      scope: 'project',
      notes: `${s.draftInstructions}\n\nEvidence from past threads (${s.rationale}):\n${s.evidence.map((e) => `- ${e}`).join('\n')}`,
    });
  }

  onMount(() => {
    void agentsStore.load();
    refreshSkills();
    refreshSuggestions();
  });
</script>

<div class="flex items-center gap-2 mb-3">
  <span class="text-xs text-muted-foreground flex-1 min-w-0 truncate">
    {agentsStore.get(agentId)?.displayName ?? agentId} · {store.repoDisplayName(repoPath)}
  </span>
  {#if managed}
    <Button
      variant="link"
      size="inline"
      onclick={analyzeSuggestions}
      disabled={analyzingSuggestions}
      title="Mine this project's thread history for recurring workflows and suggest skills"
    >
      {analyzingSuggestions ? 'Scanning…' : 'Suggest'}
    </Button>
  {/if}
  <Button variant="quiet" size="inline" onclick={refreshSkills} title="Re-scan skill directories">Refresh</Button>
</div>

{#if settingsStore.error}
  <Notice tone="danger" class="mb-2 break-words">{settingsStore.error}</Notice>
{/if}

{#if managed && suggestions.length > 0}
  <div class="mb-3 pb-3 border-b border-border">
    <SectionLabel class="mb-1.5">Suggested from your threads</SectionLabel>
    <div class="space-y-2">
      {#each suggestions as suggestion (suggestion.id)}
        <div>
          <div class="flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 bg-blue-400 shrink-0"></span>
            <span class="font-mono text-xs truncate text-foreground flex-1 min-w-0" title={suggestion.description}>{suggestion.name}</span>
            <Button variant="outline-success" size="2xs" onclick={() => createFromSuggestion(suggestion)} title="Open the Add Skill dialog prefilled with this suggestion">Create</Button>
            <Button
              variant="subtle"
              size="2xs"
              onclick={() => askAgentFromSuggestion(suggestion)}
              title={store.isFolderProject(repoPath)
                ? 'Start a new thread in the project folder where the agent writes this skill, with the mined evidence as notes'
                : 'Start a new thread on a branch of its own where the agent writes this skill, with the mined evidence as notes'}
            >Agent</Button>
            <Button variant="subtle" size="icon-2xs" onclick={() => dismissSkillSuggestion(suggestion.id)} title="Dismiss — this suggestion won't come back" aria-label="Dismiss suggestion"><XIcon /></Button>
          </div>
          <div class="text-muted-foreground text-micro ml-3" title={suggestion.evidence.join('\n')}>{suggestion.rationale}</div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<div class="space-y-2">
  {#each allSkills as skill (skill.name)}
    {@const disabled = disabledSkills.includes(skill.name)}
    <div class="border border-border bg-card/80 px-3 py-2">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="w-1.5 h-1.5 shrink-0 {disabled ? 'bg-muted-foreground/40' : 'bg-green-500'}"></span>
        <span class="font-mono text-xs truncate {disabled ? 'text-muted-foreground line-through' : 'text-foreground'}" title={skill.path ?? skill.name}>{skill.name}</span>
        <Badge tone="muted">{skillSourceLabels[skill.source]}</Badge>
      </div>
      {#if skill.description}
        <div class="text-muted-foreground text-caption mt-0.5 line-clamp-2" title={skill.description}>{skill.description}</div>
      {/if}
      <div class="flex items-center gap-1 mt-2">
        {#if !disabled}
          <Button
            variant="secondary"
            size="2xs"
            onclick={() => runSkill(skill)}
            title={store.isFolderProject(repoPath)
              ? 'Run this skill now in a new thread in the project folder'
              : 'Run this skill now in a new thread on a branch of its own'}
            aria-label="Run {skill.name} in a new thread"
          ><PlayIcon />Run</Button>
          <Button
            variant="subtle"
            size="2xs"
            onclick={() => skillsPanelStore.editSchedule(repoPath, { agentId, skill: skill.name })}
            title="Run this skill on a schedule"
            aria-label="Schedule {skill.name}"
          ><ClockIcon />Schedule</Button>
        {/if}
        <span class="flex-1"></span>
        {#if managed}
          {#if disabled}
            <Button variant="outline-success" size="2xs" onclick={() => setSkillEnabled(skill.name, true)} disabled={skillsBusy[skill.name]} title="Re-enable this skill">Enable</Button>
          {:else}
            <Button variant="outline-destructive" size="2xs" onclick={() => setSkillEnabled(skill.name, false)} disabled={skillsBusy[skill.name]} title="Hide this skill from agents">Disable</Button>
          {/if}
        {/if}
      </div>
    </div>
  {:else}
    <p class="text-xs text-muted-foreground mt-4 text-center">
      {agentsStore.get(agentId)?.displayName ?? 'This agent'} has no skills in this project yet.
    </p>
  {/each}
</div>

<div class="flex items-center gap-2 mt-3 pt-3 border-t border-border">
  {#if managed}
    <span class="text-muted-foreground text-micro flex-1">
      Turning a skill off applies to all projects, when a thread's agent (re)starts. Running turns keep their current skills.
    </span>
    <Button
      variant="subtle"
      size="2xs"
      onclick={() => { addSkillOpen = true; }}
      title="Author a new skill — write it yourself or hand it to the agent"
    ><PlusIcon />Add skill</Button>
  {:else}
    <span class="text-muted-foreground text-micro">
      Skills from {agentsStore.get(agentId)?.displayName ?? 'this agent'}'s own folders. Add or turn them off there.
    </span>
  {/if}
</div>

{#if addSkillOpen}
  {#await loadAddSkillDialog() then AddSkillDialog}
    <AddSkillDialog
      {sessionId}
      initial={addSkillInitial}
      onclose={() => { addSkillOpen = false; addSkillInitial = null; }}
      oncreated={(skill) => {
        refreshSkills();
        // A created suggestion is resolved — drop it from the list for good.
        const created = suggestions.find((s) => s.name === skill.name);
        if (created) dismissSkillSuggestion(created.id);
      }}
      onaskagent={(skill) => void askAgent(skill)}
    />
  {/await}
{/if}
