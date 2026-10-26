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
  import { Portal } from 'bits-ui';
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
  import type { SkillInfo, SkillReach, SkillSharing, SkillSuggestion } from '../../shared/types.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PlayIcon from '@lucide/svelte/icons/play';
  import ClockIcon from '@lucide/svelte/icons/clock';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import SkillCard from './SkillCard.svelte';
  import ContextMenu from './ContextMenu.svelte';

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

  // ─── Who can use a skill ───

  /** Claude Code's own skills other agents can't see (skill-sharing.ts).
   *  Only asked for in a Claude Code thread. */
  let sharing = $state<SkillSharing>({ toShare: [], toLink: [], broken: [] });

  /** The thread's agent, as the drawer names it. */
  const agentName = $derived(agentsStore.get(agentId)?.displayName ?? 'this agent');
  /** Claude Code's own skills, which other agents can't see until shared.
   *  Only in a Claude Code thread: Copilot and OpenCode read `.claude/skills`
   *  too, so there they aren't Claude's alone. */
  const claudeOnly = $derived(managed ? new Set(sharing.toShare.map((s) => s.path)) : new Set<string | undefined>());

  /** Who can use a skill now. Grove moves only Claude Code's skills between
   *  its folders and the shared ones, so in another agent's thread that half
   *  isn't asked. */
  function reachOf(skill: SkillInfo): SkillReach {
    return {
      agents: skill.path && claudeOnly.has(skill.path) ? 'claude' : 'all',
      projects: skill.source === 'user' ? 'all' : 'project',
    };
  }

  /** Who can use a skill, in a few words, e.g. "Claude only · This project".
   *  A personal skill in Claude Code's own folder is the thread's account's
   *  alone; one in a project's is every Claude account's. */
  function reachLabel(skill: SkillInfo): string {
    const own = skill.source === 'project' ? 'Claude only' : `${agentName} only`;
    const agents = managed
      ? (reachOf(skill).agents === 'claude' ? own : 'All agents')
      : (/[\\/]\.agents[\\/]skills[\\/]/.test(skill.path ?? '') ? 'All agents' : `${agentName} only`);
    return `${agents} · ${skill.source === 'user' ? 'All my projects' : 'This project'}`;
  }

  async function refreshSharing() {
    if (!managed) return;
    try {
      sharing = await window.groveBench.getSkillSharing(sessionId, repoPath) ?? { toShare: [], toLink: [], broken: [] };
    } catch { /* keep the last snapshot */ }
  }

  /** Claude Code's links, kept in line with the shared folders without
   *  asking: missing ones added, out-of-date ones updated, ones to deleted
   *  skills removed. Only links Grove made. A project's show in the Changes
   *  tab like any change. */
  async function keepLinks() {
    if (!managed) return;
    try {
      await window.groveBench.linkSkills(sessionId, repoPath);
    } catch { /* left as they are; the next opening tries again */ }
  }

  async function refresh() {
    await keepLinks();
    await Promise.all([refreshSkills(), refreshSharing()]);
  }

  // Links are kept once the agent list says this is a Claude Code thread.
  let linksKept = false;
  $effect(() => {
    if (!managed || linksKept) return;
    linksKept = true;
    void refresh();
  });

  /** The "Who can use it" form, open on one skill's card. */
  let reachForm = $state<({ skill: SkillInfo } & SkillReach) | null>(null);
  let reachBusy = $state(false);
  /** What the last change did, until dismissed. */
  let reachDone = $state<string | null>(null);

  function openReach(skill: SkillInfo) {
    reachDone = null;
    reachForm = { skill, ...reachOf(skill) };
  }

  /** What Apply will do, as a sentence; empty when nothing would change. */
  const reachPlan = $derived.by(() => {
    if (!reachForm) return '';
    const now = reachOf(reachForm.skill);
    if (now.projects === 'project' && reachForm.projects === 'all') {
      return reachForm.agents === 'all'
        ? 'Copies it to ~/.agents/skills, for every agent in all your projects, linked for each Claude account. The project keeps its copy as it is.'
        : `Copies it to ${agentName}'s own folder, for it alone in all your projects. The project keeps its copy as it is.`;
    }
    if (now.agents === reachForm.agents) return '';
    const level = now.projects === 'project' ? "the project's" : 'your';
    return reachForm.agents === 'all'
      ? `Moves it to ${level} .agents/skills, where every agent looks, leaving a link so Claude Agent still finds it.`
      : "Moves it back into Claude Agent's own folder. Other agents won't see it.";
  });

  async function applyReach() {
    const form = reachForm;
    if (!form?.skill.path || reachBusy || !reachPlan) return;
    reachBusy = true;
    try {
      await window.groveBench.setSkillReach(sessionId, repoPath, form.skill.path, { agents: form.agents, projects: form.projects });
      const copied = form.skill.source === 'project' && form.projects === 'all';
      const who = form.agents === 'all' ? 'every agent' : copied || form.skill.source === 'user' ? `${agentName} alone` : 'Claude Agent alone';
      reachDone = `"${form.skill.name}" is for ${who} in ${form.projects === 'all' ? 'all your projects' : 'this project'} now.`
        + (copied ? ' The project keeps its copy for your team.' + (managed ? ' Claude Agent uses yours where both are.' : '') : '');
      reachForm = null;
    } catch (err) {
      store.setError(`Couldn't change who can use "${form.skill.name}": ${stripIpcErrorPrefix(errorMessage(err))}`);
    } finally {
      reachBusy = false;
      void refresh();
    }
  }

  /** Escape closes the form before it closes the drawer. */
  function closeReachOnEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    reachForm = null;
  }

  // ─── A card's menu (⋯, or right-click): what doesn't fit on it ───

  let menu = $state<{ x: number; y: number; skill: SkillInfo } | null>(null);

  /** What a skill's menu offers. Turning one off sits apart: it's not about
   *  its file. */
  function menuItems(skill: SkillInfo) {
    const items: { label: string; action: () => void; disabled?: boolean; separator?: boolean }[] = [];
    if (skill.path && skill.source !== 'session') {
      items.push({ label: 'Edit SKILL.md', action: () => skillsPanelStore.editSkill(sessionId, skill) });
      items.push({ label: 'Open folder', action: () => void showFolder(skill) });
    }
    if (skill.path && skill.source !== 'session') {
      items.push({ label: 'Who can use it…', action: () => openReach(skill), disabled: reachBusy });
    }
    if (managed && !disabledSkills.includes(skill.name)) {
      items.push({ label: 'Disable', action: () => void setSkillEnabled(skill.name, false), disabled: skillsBusy[skill.name], separator: items.length > 0 });
    }
    return items;
  }

  /** Show the skill's SKILL.md in Explorer: for a Claude Code link, the
   *  shared skill's. */
  async function showFolder(skill: SkillInfo) {
    if (!skill.path) return;
    try {
      await window.groveBench.showSkillFolder(sessionId, repoPath, skill.path);
    } catch (err) {
      store.setError(`Couldn't open the folder "${skill.name}" is in: ${stripIpcErrorPrefix(errorMessage(err))}`);
    }
  }

  /** Under the card's ⋯ button. */
  function openMenuBelow(e: MouseEvent, skill: SkillInfo) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = { x: rect.left, y: rect.bottom + 2, skill };
  }

  /** At the pointer, on a right-click on the card. */
  function openMenuAt(e: MouseEvent, skill: SkillInfo) {
    if (menuItems(skill).length === 0) return;
    e.preventDefault();
    menu = { x: e.clientX, y: e.clientY, skill };
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
    // The rest (links, what only Claude Code has) once the agent list says
    // this is a Claude Code thread: the effect above.
    void refreshSkills();
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

{#if reachDone}
  <Notice tone="success" class="mb-3">
    {#snippet actions()}
      <Button variant="quiet" size="icon-2xs" onclick={() => { reachDone = null; }} title="Dismiss" aria-label="Dismiss"><XIcon /></Button>
    {/snippet}
    {reachDone}
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
          <SkillCard name={skill.name} active={!disabled} struck={disabled} nameTitle={skill.path ?? skill.name} oncontextmenu={(e: MouseEvent) => openMenuAt(e, skill)}>
            {#if skill.description}
              <div class="line-clamp-2" title={skill.description}>{skill.description}</div>
            {/if}
            {#if skill.path && skill.source !== 'session'}
              <div class="mt-0.5 text-micro">{reachLabel(skill)}</div>
            {/if}
            {#if reachForm && reachForm.skill.name === skill.name}
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div class="mt-2 pt-2 border-t border-border space-y-2" role="group" aria-label="Who can use {skill.name}" onkeydown={closeReachOnEscape}>
                {#if managed}
                  <div class="flex items-center gap-2">
                    <span class="w-14 shrink-0">Agents</span>
                    <Segmented.Root bind:value={reachForm.agents} aria-label="Agents">
                      <Segmented.Item value="claude">{skill.source === 'project' ? 'Claude only' : `${agentName} only`}</Segmented.Item>
                      <Segmented.Item value="all">All agents</Segmented.Item>
                    </Segmented.Root>
                  </div>
                {/if}
                <div class="flex items-center gap-2">
                  <span class="w-14 shrink-0">Projects</span>
                  <!-- A personal skill is in every project already. -->
                  <Segmented.Root bind:value={reachForm.projects} aria-label="Projects">
                    <Segmented.Item value="project" disabled={skill.source === 'user'}>This project</Segmented.Item>
                    <Segmented.Item value="all">All my projects</Segmented.Item>
                  </Segmented.Root>
                </div>
                <p class="text-foreground">{reachPlan || 'No change.'}</p>
                <div class="flex justify-end gap-2">
                  <Button variant="subtle" size="2xs" onclick={() => { reachForm = null; }}>Cancel</Button>
                  <Button variant="subtle-primary" size="2xs" onclick={applyReach} disabled={!reachPlan || reachBusy}>{reachBusy ? 'Applying…' : 'Apply'}</Button>
                </div>
              </div>
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
            {/snippet}
            {#snippet end()}
              <!-- A turned-off skill's one action stays in view. -->
              {#if managed && disabled}
                <Button variant="subtle-primary" size="2xs" onclick={() => setSkillEnabled(skill.name, true)} disabled={skillsBusy[skill.name]} title="Re-enable this skill">Enable</Button>
              {/if}
              {#if menuItems(skill).length > 0}
                <Button
                  variant="quiet"
                  size="icon-2xs"
                  onclick={(e: MouseEvent) => openMenuBelow(e, skill)}
                  title="More actions"
                  aria-label="More for {skill.name}"
                  aria-haspopup="menu"
                  aria-expanded={menu?.skill.name === skill.name}
                ><EllipsisIcon /></Button>
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

<!-- On the page, not in the drawer: the drawer is the box a fixed menu
     inside it would be placed in, so it would open off to the right. -->
{#if menu}
  <Portal>
    <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.skill)} label={menu.skill.name} onclose={() => { menu = null; }} />
  </Portal>
{/if}

{#if addSkillOpen}
  {#await loadAddSkillDialog() then AddSkillDialog}
    <AddSkillDialog
      {sessionId}
      initial={addSkillInitial}
      onclose={() => { addSkillOpen = false; addSkillInitial = null; }}
      oncreated={(skill) => {
        void refresh();
        // A created suggestion is resolved — drop it from the list for good.
        const created = suggestions.find((s) => s.name === skill.name);
        if (created) void dismissSkillSuggestion(created.id);
      }}
      onaskagent={(skill) => void askAgent(skill)}
    />
  {/await}
{/if}
