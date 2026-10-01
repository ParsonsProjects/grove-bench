<script lang="ts">
  /**
   * The Skills badge and its popover: the skills agents can use, with
   * enable / disable, suggestions mined from past conversations, and the
   * Add Skill dialog. Reports its skill count to the bar.
   */
  import { onMount } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { mergeSkills } from '../lib/skills-merge.js';
  import { buildCreateSkillPrompt } from '../lib/skill-prompt.js';
  import { lazyComponent } from '../lib/lazy-component.js';
  import type { SkillInfo, SkillSuggestion } from '../../shared/types.js';
  import StatusBarPopover from './StatusBarPopover.svelte';

  let { sessionId, count = $bindable(0) }: { sessionId: string; count?: number } = $props();

  // The dialog loads when first opened.
  const loadAddSkillDialog = lazyComponent(() => import('./AddSkillDialog.svelte'));

  let sessionStatus = $derived(store.sessions.find((s) => s.id === sessionId)?.status);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let systemInfo = $derived(messageStore.getSystemInfo(sessionId));

  let skillsExpanded = $state(false);
  let addSkillOpen = $state(false);
  let diskSkills = $state<SkillInfo[]>([]);
  let skillsBusy = $state<Record<string, boolean>>({});
  /** On-disk scan merged with the session's init report (plugin skills). */
  let allSkills = $derived(mergeSkills(diskSkills, systemInfo.skills));
  let disabledSkills = $derived(settingsStore.current.disabledSkills ?? []);
  let enabledSkillCount = $derived(allSkills.filter((s) => !disabledSkills.includes(s.name)).length);
  let disabledSkillCount = $derived(allSkills.length - enabledSkillCount);

  const skillSourceLabels: Record<SkillInfo['source'], string> = {
    project: 'project',
    user: 'user',
    session: 'plugin',
  };

  async function refreshSkills() {
    try {
      const repoPath = store.sessions.find((s) => s.id === sessionId)?.repoPath ?? '';
      diskSkills = await window.groveBench.listSkills(sessionId, repoPath) ?? [];
    } catch { /* keep the last snapshot */ }
  }

  function toggleSkillsPopover() {
    skillsExpanded = !skillsExpanded;
    if (skillsExpanded) {
      refreshSkills();
      refreshSuggestions();
    }
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

  // ─── Skill suggestions (mined from session history) ───

  let suggestions = $state<SkillSuggestion[]>([]);
  let analyzingSuggestions = $state(false);
  let addSkillInitial = $state<{ name: string; description: string; instructions: string } | null>(null);
  let sessionRepoPath = $derived(store.sessions.find((s) => s.id === sessionId)?.repoPath ?? '');
  let canAskAgent = $derived(sessionStatus === 'running' && !isRunning);

  async function refreshSuggestions() {
    if (!sessionRepoPath) return;
    try {
      suggestions = await window.groveBench.getSkillSuggestions(sessionRepoPath) ?? [];
    } catch { /* keep the last snapshot */ }
  }

  async function analyzeSuggestions() {
    if (analyzingSuggestions || !sessionRepoPath) return;
    analyzingSuggestions = true;
    try {
      suggestions = await window.groveBench.analyzeSkillSuggestions(sessionRepoPath) ?? [];
    } catch { /* analysis is best-effort */ }
    finally {
      analyzingSuggestions = false;
    }
  }

  async function dismissSkillSuggestion(id: string) {
    suggestions = suggestions.filter((s) => s.id !== id);
    try {
      await window.groveBench.dismissSkillSuggestion(sessionRepoPath, id);
    } catch { /* worst case it reappears on the next analysis */ }
  }

  function createFromSuggestion(s: SkillSuggestion) {
    addSkillInitial = { name: s.name, description: s.description, instructions: s.draftInstructions };
    skillsExpanded = false;
    addSkillOpen = true;
  }

  /** Hand the suggestion to the agent with the mined evidence as draft notes. */
  function askAgentFromSuggestion(s: SkillSuggestion) {
    if (!canAskAgent) return;
    const prompt = buildCreateSkillPrompt({
      name: s.name,
      description: s.description,
      scope: 'project',
      notes: `${s.draftInstructions}\n\nEvidence from past conversations (${s.rationale}):\n${s.evidence.map((e) => `- ${e}`).join('\n')}`,
    });
    messageStore.addUserMessage(sessionId, prompt);
    window.groveBench.sendMessage(sessionId, prompt);
    store.updateLastActive(sessionId);
    skillsExpanded = false;
    dismissSkillSuggestion(s.id);
  }

  $effect(() => { count = allSkills.length; });

  onMount(() => {
    // Populate the badge up front: the count and suggestion badge shouldn't
    // wait for the popover to be opened.
    refreshSkills();
    refreshSuggestions();
  });
</script>

{#if allSkills.length > 0}
  <StatusBarPopover bind:open={skillsExpanded} anchored={false} panelClass="bg-popover border border-border shadow-xl p-3 text-xs w-96">
    {#snippet trigger()}
      <button
        onclick={toggleSkillsPopover}
        class="flex items-center gap-1 whitespace-nowrap transition-colors text-muted-foreground hover:text-foreground"
        title="Skills — click to manage{disabledSkillCount > 0 ? ` (${disabledSkillCount} disabled)` : ''}"
        aria-expanded={skillsExpanded}
      >
        <!-- Turning skills off is a choice, not a fault, so no warning
             colours here (MCP's are for real failures): grey with none on. -->
        <span class="w-1.5 h-1.5 {enabledSkillCount === 0 ? 'bg-muted-foreground/40' : 'bg-green-500'}"></span>
        Skills {disabledSkillCount > 0 ? `${enabledSkillCount}/${allSkills.length}` : allSkills.length}
        {#if suggestions.length > 0}
          <span class="text-blue-400" title="{suggestions.length} suggested skill{suggestions.length === 1 ? '' : 's'} from your conversations">+{suggestions.length}</span>
        {/if}
      </button>
    {/snippet}

    <div class="flex items-center justify-between mb-2">
      <span class="font-medium text-foreground">Skills</span>
      <div class="flex items-center gap-2.5">
        <button
          onclick={analyzeSuggestions}
          disabled={analyzingSuggestions}
          class="text-blue-400/80 hover:text-blue-300 transition-colors disabled:opacity-50"
          title="Mine this project's conversation history for recurring workflows and suggest skills"
        >
          {analyzingSuggestions ? 'Scanning…' : 'Suggest'}
        </button>
        <button
          onclick={refreshSkills}
          class="text-muted-foreground/60 hover:text-foreground transition-colors"
          title="Re-scan skill directories"
        >
          Refresh
        </button>
      </div>
    </div>

    {#if settingsStore.error}
      <div class="text-destructive mb-2 break-words">{settingsStore.error}</div>
    {/if}

    {#if suggestions.length > 0}
      <div class="mb-2 pb-2 border-b border-border">
        <div class="text-[10px] uppercase tracking-wide text-blue-400/80 mb-1.5">
          Suggested from your conversations
        </div>
        <div class="space-y-1.5">
          {#each suggestions as suggestion (suggestion.id)}
            <div>
              <div class="flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 bg-blue-400 shrink-0"></span>
                <span class="font-mono truncate text-foreground flex-1 min-w-0" title={suggestion.description}>
                  {suggestion.name}
                </span>
                <button
                  onclick={() => createFromSuggestion(suggestion)}
                  class="px-1.5 py-0.5 border border-border text-green-400 hover:bg-green-400/10 transition-colors shrink-0"
                  title="Open the Add Skill dialog prefilled with this suggestion"
                >
                  Create
                </button>
                <button
                  onclick={() => askAgentFromSuggestion(suggestion)}
                  disabled={!canAskAgent}
                  class="px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 disabled:opacity-50"
                  title={canAskAgent
                    ? 'Ask the agent to write this skill, with the mined evidence as notes'
                    : 'Needs a running, idle conversation'}
                >
                  Agent
                </button>
                <button
                  onclick={() => dismissSkillSuggestion(suggestion.id)}
                  class="px-1.5 py-0.5 border border-border text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                  title="Dismiss — this suggestion won't come back"
                >
                  ✕
                </button>
              </div>
              <div class="text-muted-foreground/60 text-[10px] truncate ml-3" title={suggestion.evidence.join('\n')}>
                {suggestion.rationale}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <div class="space-y-1.5 max-h-64 overflow-y-auto">
      {#each allSkills as skill (skill.name)}
        {@const disabled = disabledSkills.includes(skill.name)}
        <div class="flex items-center gap-2 group">
          <span class="w-1.5 h-1.5 shrink-0 {disabled ? 'bg-muted-foreground/40' : 'bg-green-500'}"></span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="font-mono truncate {disabled ? 'text-muted-foreground line-through' : 'text-foreground'}" title={skill.path ?? skill.name}>
                {skill.name}
              </span>
              <span class="text-[10px] px-1 border border-border text-muted-foreground/60 shrink-0">
                {skillSourceLabels[skill.source]}
              </span>
            </div>
            {#if skill.description}
              <div class="text-muted-foreground/60 text-[10px] truncate" title={skill.description}>
                {skill.description}
              </div>
            {/if}
          </div>
          {#if disabled}
            <button
              onclick={() => setSkillEnabled(skill.name, true)}
              disabled={skillsBusy[skill.name]}
              class="px-1.5 py-0.5 border border-border text-green-400 hover:bg-green-400/10 transition-colors shrink-0 disabled:opacity-50"
              title="Re-enable this skill"
            >
              Enable
            </button>
          {:else}
            <button
              onclick={() => setSkillEnabled(skill.name, false)}
              disabled={skillsBusy[skill.name]}
              class="px-1.5 py-0.5 border border-border text-destructive hover:bg-destructive/10 transition-colors shrink-0 disabled:opacity-50"
              title="Hide this skill from agents"
            >
              Disable
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <div class="flex items-center gap-2 mt-2 pt-2 border-t border-border">
      <span class="text-muted-foreground/50 text-[10px] flex-1">
        Applies to all projects, when a conversation's agent (re)starts — running turns keep their current skills.
      </span>
      <button
        onclick={() => { skillsExpanded = false; addSkillOpen = true; }}
        class="px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
        title="Author a new skill — write it yourself or hand it to the agent"
      >
        + Add skill
      </button>
    </div>
  </StatusBarPopover>
{/if}

{#if addSkillOpen}
  {#await loadAddSkillDialog() then AddSkillDialog}
    <AddSkillDialog
      {sessionId}
      initial={addSkillInitial}
      onclose={() => { addSkillOpen = false; addSkillInitial = null; }}
      oncreated={(skill) => {
        refreshSkills();
        skillsExpanded = true;
        // A created suggestion is resolved — drop it from the list for good.
        const created = suggestions.find((s) => s.name === skill.name);
        if (created) dismissSkillSuggestion(created.id);
      }}
    />
  {/await}
{/if}
