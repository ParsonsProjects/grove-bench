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
  import StatusBarPopover from './StatusBarPopover.svelte';

  let { sessionId, count = $bindable(0) }: { sessionId: string; count?: number } = $props();

  // The dialog loads when first opened.
  const loadAddSkillDialog = lazyComponent(() => import('./AddSkillDialog.svelte'));

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
  let addSkillInitial = $state<{ name: string; description: string; instructions: string; scope?: 'project' | 'user' } | null>(null);
  let sessionRepoPath = $derived(store.sessions.find((s) => s.id === sessionId)?.repoPath ?? '');

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

  /** Hand a skill to the agent in a new thread. A suggestion of the same
   *  name is resolved straight away, as for a manual create, so it can't be
   *  handed off twice while the thread starts. If the thread can't start,
   *  the Add Skill dialog opens with the skill, so nothing is lost. */
  async function askAgent(skill: SkillPromptOpts) {
    const suggested = suggestions.find((s) => s.name === skill.name);
    if (suggested) dismissSkillSuggestion(suggested.id);
    if (await startSkillThread(sessionId, skill)) return;
    // The dialog shows over whatever is on screen, so only over this thread.
    if (store.activeSessionId !== sessionId) return;
    addSkillInitial = { name: skill.name, description: skill.description, instructions: skill.notes ?? '', scope: skill.scope };
    addSkillOpen = true;
  }

  /** Hand the suggestion to the agent, with the mined evidence as draft notes. */
  function askAgentFromSuggestion(s: SkillSuggestion) {
    skillsExpanded = false;
    void askAgent({
      name: s.name,
      description: s.description,
      scope: 'project',
      notes: `${s.draftInstructions}\n\nEvidence from past threads (${s.rationale}):\n${s.evidence.map((e) => `- ${e}`).join('\n')}`,
    });
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
  <StatusBarPopover bind:open={skillsExpanded} anchored={false} panelClass="w-96">
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
          <span class="text-blue-400" title="{suggestions.length} suggested skill{suggestions.length === 1 ? '' : 's'} from your threads">+{suggestions.length}</span>
        {/if}
      </button>
    {/snippet}

    <div class="flex items-center justify-between mb-2">
      <span class="font-medium text-foreground">Skills</span>
      <div class="flex items-center gap-2.5">
        <Button
          variant="link"
          size="inline"
          onclick={analyzeSuggestions}
          disabled={analyzingSuggestions}
          title="Mine this project's thread history for recurring workflows and suggest skills"
        >
          {analyzingSuggestions ? 'Scanning…' : 'Suggest'}
        </Button>
        <Button
          variant="quiet"
          size="inline"
          onclick={refreshSkills}
          title="Re-scan skill directories"
        >
          Refresh
        </Button>
      </div>
    </div>

    {#if settingsStore.error}
      <Notice tone="danger" class="mb-2 break-words">{settingsStore.error}</Notice>
    {/if}

    {#if suggestions.length > 0}
      <div class="mb-2 pb-2 border-b border-border">
        <SectionLabel class="mb-1.5">
          Suggested from your threads
        </SectionLabel>
        <div class="space-y-1.5">
          {#each suggestions as suggestion (suggestion.id)}
            <div>
              <div class="flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 bg-blue-400 shrink-0"></span>
                <span class="font-mono truncate text-foreground flex-1 min-w-0" title={suggestion.description}>
                  {suggestion.name}
                </span>
                <Button
                  variant="outline-success"
                  size="2xs"
                  onclick={() => createFromSuggestion(suggestion)}
                  title="Open the Add Skill dialog prefilled with this suggestion"
                >
                  Create
                </Button>
                <Button
                  variant="subtle"
                  size="2xs"
                  onclick={() => askAgentFromSuggestion(suggestion)}
                  title={store.isFolderProject(sessionRepoPath)
                    ? 'Start a new thread in the project folder where the agent writes this skill, with the mined evidence as notes'
                    : 'Start a new thread on a branch of its own where the agent writes this skill, with the mined evidence as notes'}
                >
                  Agent
                </Button>
                <Button
                  variant="subtle"
                  size="icon-2xs"
                  onclick={() => dismissSkillSuggestion(suggestion.id)}
                  title="Dismiss — this suggestion won't come back"
                  aria-label="Dismiss suggestion"
                >
                  <XIcon />
                </Button>
              </div>
              <div class="text-muted-foreground text-micro truncate ml-3" title={suggestion.evidence.join('\n')}>
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
              <Badge tone="muted">
                {skillSourceLabels[skill.source]}
              </Badge>
            </div>
            {#if skill.description}
              <div class="text-muted-foreground text-micro truncate" title={skill.description}>
                {skill.description}
              </div>
            {/if}
          </div>
          {#if disabled}
            <Button
              variant="outline-success"
              size="2xs"
              onclick={() => setSkillEnabled(skill.name, true)}
              disabled={skillsBusy[skill.name]}
              title="Re-enable this skill"
            >
              Enable
            </Button>
          {:else}
            <Button
              variant="outline-destructive"
              size="2xs"
              onclick={() => setSkillEnabled(skill.name, false)}
              disabled={skillsBusy[skill.name]}
              title="Hide this skill from agents"
            >
              Disable
            </Button>
          {/if}
        </div>
      {/each}
    </div>

    <div class="flex items-center gap-2 mt-2 pt-2 border-t border-border">
      <span class="text-muted-foreground text-micro flex-1">
        Applies to all projects, when a thread's agent (re)starts. Running turns keep their current skills.
      </span>
      <Button
        variant="subtle"
        size="2xs"
        onclick={() => { skillsExpanded = false; addSkillOpen = true; }}
        title="Author a new skill — write it yourself or hand it to the agent"
      >
        <PlusIcon />
        Add skill
      </Button>
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
      onaskagent={(skill) => void askAgent(skill)}
    />
  {/await}
{/if}
