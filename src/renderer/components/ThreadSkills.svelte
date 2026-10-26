<script lang="ts">
  /**
   * The Skills drawer's This thread tab: the skills the thread's agent can
   * use, in sections by where they live and searchable, each with Run (in a
   * new thread now), Schedule and, for one with a file, Edit (SkillEditor,
   * which the drawer shows in this tab's place); and the Add Skill dialog,
   * which writes to the shared `.agents/skills`. Share and Link keep skills
   * usable by every agent (skill-sharing.ts). For Claude Code, whose skills
   * Grove manages, also turning them off and on, and suggestions mined from
   * past threads.
   */
  import { onMount } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { schedulesStore } from '../stores/schedules.svelte.js';
  import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
  import { mergeSkills } from '../lib/skills-merge.js';
  import { groupSkills, searchSkills } from '../lib/skill-groups.js';
  import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';
  import { errorMessage } from '../../shared/error-message.js';
  import { startSkillThread } from '../lib/skill-thread.js';
  import type { SkillPromptOpts } from '../lib/skill-prompt.js';
  import { lazyComponent } from '../lib/lazy-component.js';
  import type { SkillInfo, SkillSharing, SkillSuggestion } from '../../shared/types.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PlayIcon from '@lucide/svelte/icons/play';
  import ClockIcon from '@lucide/svelte/icons/clock';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import ShareIcon from '@lucide/svelte/icons/share-2';
  import SkillCard from './SkillCard.svelte';

  let { sessionId }: { sessionId: string } = $props();

  // The dialog loads when first opened.
  const loadAddSkillDialog = lazyComponent(() => import('./AddSkillDialog.svelte'));

  let systemInfo = $derived(messageStore.getSystemInfo(sessionId));
  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  let repoPath = $derived(session?.repoPath ?? '');
  /** The thread's agent: the skills listed are its own. */
  let agentId = $derived(session?.agentType ?? agentsStore.defaultId ?? '');
  /** Grove manages this agent's skills (turn off, suggest): Claude Code
   *  only, and only once the agent list says so. Any agent's skills can be
   *  run, scheduled and added. */
  let managed = $derived(agentsStore.loaded && agentsStore.supports(agentId, 'skills'));

  let addSkillOpen = $state(false);
  let diskSkills = $state<SkillInfo[]>([]);
  let skillsBusy = $state<Record<string, boolean>>({});
  /** On-disk scan merged with the session's init report (plugin skills). */
  let allSkills = $derived(mergeSkills(diskSkills, systemInfo.skills));
  /** Claude Code's turned-off skills; another agent reading the same folder
   *  still uses them. */
  let disabledSkills = $derived(managed ? settingsStore.current.disabledSkills ?? [] : []);

  const searching = $derived(skillsPanelStore.query.trim().length > 0);
  /** The sections, holding only the skills the search matches. */
  const groups = $derived(groupSkills(searchSkills(allSkills, skillsPanelStore.query)));
  /** Escape clears a search before it closes the drawer, whose Escape
   *  listener is on the document. */
  function clearSearchOnEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !skillsPanelStore.query) return;
    e.preventDefault();
    e.stopPropagation();
    skillsPanelStore.query = '';
  }

  async function refreshSkills() {
    try {
      diskSkills = await window.groveBench.listSkills(sessionId, repoPath) ?? [];
    } catch { /* keep the last snapshot */ }
  }

  // ─── Share and Link (skills every agent can use) ───

  let sharing = $state<SkillSharing>({ toShare: [], toLink: [], broken: [] });
  let sharingBusy = $state(false);
  const toShareCount = $derived(sharing.toShare.length);
  /** Claude Code's own skills, which other agents can't see until shared.
   *  Only marked in a Claude Code thread: Copilot and OpenCode read
   *  `.claude/skills` too, so there they aren't Claude's alone. */
  const claudeOnly = $derived(managed ? new Set(sharing.toShare.map((s) => s.path)) : new Set<string | undefined>());
  const linkCount = $derived(sharing.toLink.length + sharing.broken.length);

  async function refreshSharing() {
    try {
      sharing = await window.groveBench.getSkillSharing(sessionId, repoPath) ?? { toShare: [], toLink: [], broken: [] };
    } catch { /* keep the last snapshot */ }
  }

  function refresh() {
    void refreshSkills();
    void refreshSharing();
  }

  /** What Share and Link would change, in one line; the details are under it. */
  const sharingSummary = $derived([
    toShareCount === 0 ? '' : toShareCount === 1 ? "1 skill isn't shared with every agent" : `${toShareCount} skills aren't shared with every agent`,
    linkCount === 0 ? '' : linkCount === 1 ? '1 Claude Agent link needs updating' : `${linkCount} Claude Agent links need updating`,
  ].filter(Boolean).join(' · '));
  const sharingAction = $derived(toShareCount > 0 && linkCount > 0 ? 'Share and link' : toShareCount > 0 ? 'Share' : 'Link');

  /** Share, then Link, as needed, and say what couldn't be done. Both change
   *  files in the project, which show in the Changes tab. */
  async function fixSharing() {
    if (sharingBusy) return;
    sharingBusy = true;
    const failed: string[] = [];
    try {
      if (toShareCount > 0) {
        const result = await window.groveBench.shareSkills(sessionId, repoPath);
        failed.push(...result.skipped.map((s) => `share "${s.name}" (${s.reason})`));
      }
      if (linkCount > 0) {
        const result = await window.groveBench.linkSkills(sessionId, repoPath);
        failed.push(...result.skipped.map((s) => `link "${s.name}" (${s.reason})`));
      }
      if (failed.length > 0) store.setError(`Couldn't ${failed.join(', ')}.`);
    } catch (err) {
      store.setError(`Couldn't ${sharingAction.toLowerCase()} the skills: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      sharingBusy = false;
      refresh();
    }
  }

  /** Share one of Claude Code's own skills from its card: move it to
   *  `.agents/skills`, leaving a link, as Share does for all of them. */
  async function shareSkill(skill: SkillInfo) {
    if (sharingBusy || !skill.path) return;
    sharingBusy = true;
    try {
      const result = await window.groveBench.shareSkills(sessionId, repoPath, skill.path);
      const skipped = result.skipped[0];
      if (skipped) store.setError(`Couldn't share "${skipped.name}" (${skipped.reason}).`);
    } catch (err) {
      store.setError(`Couldn't share "${skill.name}": ${stripIpcErrorPrefix(errorMessage(err))}`);
    } finally {
      sharingBusy = false;
      refresh();
    }
  }

  /** What Link will do, as a sentence. */
  function linkPlan({ toLink, broken }: SkillSharing): string {
    const parts = [];
    if (toLink.length > 0) parts.push(`adds or updates the links for ${nameList(toLink)}`);
    if (broken.length > 0) parts.push(`removes the links to ${nameList(broken)}, which ${broken.length === 1 ? 'was' : 'were'} deleted`);
    return `Link ${parts.join(', and ')}.`;
  }

  /** Up to three names, then how many more. */
  function nameList(skills: SkillInfo[]): string {
    const names = skills.map((s) => s.name);
    if (names.length <= 3) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
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
    if (suggested) void dismissSkillSuggestion(suggested.id);
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
    refresh();
    void refreshSuggestions();
  });
</script>

<div class="flex items-center gap-2 mb-3">
  <span class="text-xs text-muted-foreground flex-1 min-w-0 truncate">
    {agentsStore.get(agentId)?.displayName ?? agentId} · {store.repoDisplayName(repoPath)}
  </span>
  <!-- Add skill is the tab's main action, green as Schedule a skill is on
       the other tab; the rest stay grey. -->
  {#if managed}
    <Button
      variant="subtle"
      size="2xs"
      onclick={analyzeSuggestions}
      disabled={analyzingSuggestions}
      title="Mine this project's thread history for recurring workflows and suggest skills"
    ><SparklesIcon />{analyzingSuggestions ? 'Scanning…' : 'Suggest'}</Button>
  {/if}
  <Button variant="subtle" size="icon-2xs" onclick={refresh} title="Re-scan skill directories" aria-label="Refresh skills"><RefreshIcon /></Button>
  <Button
    variant="subtle-primary"
    size="2xs"
    onclick={() => { addSkillOpen = true; }}
    title="Author a new skill every agent can use — write it yourself or hand it to the agent"
  ><PlusIcon />Add skill</Button>
</div>

{#if settingsStore.error}
  <Notice tone="danger" class="mb-2 break-words">{settingsStore.error}</Notice>
{/if}

{#if toShareCount > 0 || linkCount > 0}
  <Notice class="mb-3">
    {#snippet actions()}
      <Button
        variant="link"
        size="2xs"
        onclick={fixSharing}
        disabled={sharingBusy}
        title="Move skills only Claude Agent's folder has to .agents/skills, and bring Claude Agent's links in line with it"
      >{sharingBusy ? 'Working…' : sharingAction}</Button>
    {/snippet}
    <details>
      <summary class="cursor-pointer">{sharingSummary}</summary>
      <div class="mt-1 space-y-1 text-muted-foreground">
        {#if toShareCount > 0}
          <p>
            {nameList(sharing.toShare)} {toShareCount === 1 ? 'is' : 'are'} in <span class="font-mono">.claude/skills</span>, which only some agents read.
            Share moves {toShareCount === 1 ? 'it' : 'them'} to <span class="font-mono">.agents/skills</span>, where every agent looks, and leaves a link so Claude Agent still finds {toShareCount === 1 ? 'it' : 'them'}.
          </p>
        {/if}
        {#if linkCount > 0}
          <p>
            Claude Agent doesn't read <span class="font-mono">.agents/skills</span>, so it finds shared skills through links in <span class="font-mono">.claude/skills</span>.
            {linkPlan(sharing)}
          </p>
        {/if}
      </div>
    </details>
  </Notice>
{/if}

{#if allSkills.length > 0}
  <Input
    type="search"
    bind:value={skillsPanelStore.query}
    onkeydown={clearSearchOnEscape}
    placeholder="Search skills by name or description"
    aria-label="Search skills"
    class="h-7 text-xs md:text-xs mb-3"
  />
{/if}

{#each groups as group (group.id)}
  {@const open = searching || !skillsPanelStore.collapsed.includes(group.id)}
  <section class="mb-3" aria-labelledby="skills-group-{group.id}">
    <SectionLabel as="h3" class="mb-1.5">
      <!-- Search shows every match, so sections only fold without one. -->
      <button
        type="button"
        id="skills-group-{group.id}"
        class="flex w-full min-w-0 items-center gap-1 text-start uppercase hover:text-foreground disabled:hover:text-muted-foreground"
        aria-expanded={open}
        disabled={searching}
        onclick={() => skillsPanelStore.toggleGroup(group.id)}
      >
        <ChevronRightIcon class="size-3 shrink-0 transition-transform {open ? 'rotate-90' : ''}" />
        {group.label}
        <Badge tone="muted" count>{group.skills.length}</Badge>
        <span class="ms-auto ps-2 truncate normal-case tracking-normal font-normal">{group.hint}</span>
      </button>
    </SectionLabel>
    {#if open}
      <div class="space-y-2">
        {#each group.skills as skill (skill.name)}
          {@const disabled = disabledSkills.includes(skill.name)}
          <SkillCard name={skill.name} active={!disabled} struck={disabled} nameTitle={skill.path ?? skill.name}>
            {#snippet tags()}
              {#if skill.path && claudeOnly.has(skill.path)}
                <Badge tone="muted" title="Only Claude Agent reads .claude/skills. Share moves it to .agents/skills, where every agent looks, leaving a link for Claude Agent.">Claude only</Badge>
              {/if}
            {/snippet}
            {#if skill.description}
              <div class="line-clamp-2" title={skill.description}>{skill.description}</div>
            {/if}
            {#snippet actions()}
              {#if !disabled}
                <Button
                  variant="subtle-primary"
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
              {#if skill.path && skill.source !== 'session'}
                <Button
                  variant="subtle"
                  size="2xs"
                  onclick={() => skillsPanelStore.editSkill(sessionId, skill)}
                  title="Edit this skill's SKILL.md"
                  aria-label="Edit {skill.name}"
                ><PencilIcon />Edit</Button>
              {/if}
              {#if skill.path && claudeOnly.has(skill.path)}
                <Button
                  variant="subtle"
                  size="2xs"
                  onclick={() => shareSkill(skill)}
                  disabled={sharingBusy}
                  title="Move this skill to .agents/skills, where every agent looks, leaving a link for Claude Agent"
                  aria-label="Share {skill.name} with every agent"
                ><ShareIcon />Share</Button>
              {/if}
            {/snippet}
            {#snippet end()}
              {#if managed}
                <!-- Turning a skill off is reversible, so it stays quiet; red is
                     for what can't be undone. -->
                {#if disabled}
                  <Button variant="subtle-primary" size="2xs" onclick={() => setSkillEnabled(skill.name, true)} disabled={skillsBusy[skill.name]} title="Re-enable this skill">Enable</Button>
                {:else}
                  <Button variant="quiet" size="2xs" onclick={() => setSkillEnabled(skill.name, false)} disabled={skillsBusy[skill.name]} title="Hide this skill from agents">Disable</Button>
                {/if}
              {/if}
            {/snippet}
          </SkillCard>
        {/each}
      </div>
    {/if}
  </section>
{:else}
  <p class="text-xs text-muted-foreground mt-4 text-center">
    {#if searching}
      No skills match "{skillsPanelStore.query.trim()}".
    {:else}
      {agentsStore.get(agentId)?.displayName ?? 'This agent'} has no skills in this project yet.
    {/if}
  </p>
{/each}

{#if managed && suggestions.length > 0}
  <div class="mt-3 pt-3 border-t border-border">
    <SectionLabel class="mb-1.5">Suggested from your threads</SectionLabel>
    <div class="space-y-2">
      {#each suggestions as suggestion (suggestion.id)}
        <div>
          <div class="flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 bg-blue-400 shrink-0"></span>
            <span class="font-mono text-xs truncate text-foreground flex-1 min-w-0" title={suggestion.description}>{suggestion.name}</span>
            <Button variant="subtle-primary" size="2xs" onclick={() => createFromSuggestion(suggestion)} title="Open the Add Skill dialog prefilled with this suggestion">Create</Button>
            <Button
              variant="subtle"
              size="2xs"
              onclick={() => askAgentFromSuggestion(suggestion)}
              title={store.isFolderProject(repoPath)
                ? 'Start a new thread in the project folder where the agent writes this skill, with the mined evidence as notes'
                : 'Start a new thread on a branch of its own where the agent writes this skill, with the mined evidence as notes'}
            >Ask agent</Button>
            <Button variant="subtle" size="icon-2xs" onclick={() => dismissSkillSuggestion(suggestion.id)} title="Dismiss — this suggestion won't come back" aria-label="Dismiss suggestion"><XIcon /></Button>
          </div>
          <div class="text-muted-foreground text-micro ml-3" title={suggestion.evidence.join('\n')}>{suggestion.rationale}</div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<p class="text-muted-foreground text-caption mt-3 pt-3 border-t border-border">
  {#if managed}
    Turning a skill off applies to all projects, when a thread's agent (re)starts. Running turns keep their current skills.
  {:else}
    Skills from {agentsStore.get(agentId)?.displayName ?? 'this agent'}'s own folders. Turn them off there.
  {/if}
</p>

{#if addSkillOpen}
  {#await loadAddSkillDialog() then AddSkillDialog}
    <AddSkillDialog
      {sessionId}
      initial={addSkillInitial}
      onclose={() => { addSkillOpen = false; addSkillInitial = null; }}
      oncreated={(skill) => {
        refresh();
        // A created suggestion is resolved — drop it from the list for good.
        const created = suggestions.find((s) => s.name === skill.name);
        if (created) void dismissSkillSuggestion(created.id);
      }}
      onaskagent={(skill) => void askAgent(skill)}
    />
  {/await}
{/if}
