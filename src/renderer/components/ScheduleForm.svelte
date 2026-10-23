<script lang="ts">
  /**
   * Add or edit a scheduled skill (shared/skill-schedules.ts): the agent, one
   * of its skills in the project, a note sent with it, the mode, where the
   * thread runs, when, and the open-thread cap. Shown in the Skills drawer's
   * Scheduled tab.
   */
  import { onMount, untrack } from 'svelte';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { schedulesStore } from '../stores/schedules.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';
  import { MAX_NOTE_LENGTH, MAX_OPEN_LIMIT, type SkillScheduleInput } from '../../shared/skill-schedules.js';
  import { CONTROL_IDS, type ControlOption, type PermissionMode, type SkillInfo } from '../../shared/types.js';

  let { repoPath, initial = null, onclose }: {
    repoPath: string;
    /** A schedule to edit (with its id), or fields for a new one. */
    initial?: Partial<SkillScheduleInput> | null;
    /** Back to the list, saved or not. */
    onclose: () => void;
  } = $props();

  const folderProject = untrack(() => store.isFolderProject(repoPath));
  let editing = $state<SkillScheduleInput>({
    repoPath: untrack(() => repoPath),
    agentId: agentsStore.defaultId ?? '',
    skill: '',
    note: '',
    start: folderProject ? 'folder' : 'new',
    permissionMode: '',
    timing: { kind: 'daily', time: '09:00', weekdaysOnly: true },
    maxOpen: 1,
    paused: false,
    ...untrack(() => initial ?? {}),
  });
  let saving = $state(false);
  let formError = $state('');

  /** The picked agent's skills in this project: loading, loaded or failed. */
  let skills = $state<{ agentId: string; list: SkillInfo[] | null; failed: boolean }>({ agentId: '', list: null, failed: false });
  /** The picked agent's own modes (its Mode control). */
  let modeOptions = $state<ControlOption[]>([]);

  const agents = $derived(agentsStore.offered(settingsStore.current.enabledAlphaAgents));
  /** Claude Code's turned-off skills can't run, so they aren't offered. */
  const managed = $derived(agentsStore.loaded && agentsStore.supports(editing.agentId, 'skills'));
  const offered = $derived((skills.list ?? []).filter((s) => !managed || !(settingsStore.current.disabledSkills ?? []).includes(s.name)));
  /** The skill being edited stays a choice even if it's gone, so opening
   *  the form doesn't quietly drop it. */
  const skillChoices = $derived(
    editing.skill && !offered.some((s) => s.name === editing.skill)
      ? [{ name: editing.skill, description: 'Not found in this project now', source: 'project' as const }, ...offered]
      : offered,
  );
  const skillsLoaded = $derived(skills.agentId === editing.agentId && skills.list !== null);

  /** The Select's value for "the default": an empty value reads as nothing picked. */
  const DEFAULT = '_default';
  const modes = $derived([{ value: DEFAULT, label: "Agent's default" }, ...modeOptions.map((o) => ({ value: o.value, label: o.label }))]);

  onMount(() => {
    // Agents load on first use, and nothing may have used them yet.
    void agentsStore.load().then(() => {
      if (!editing.agentId) editing.agentId = agentsStore.defaultId ?? '';
    });
  });

  // The picked agent's skills and modes, fetched again when it changes.
  $effect(() => {
    const agentId = editing.agentId;
    if (!agentId || skills.agentId === agentId) return;
    skills = { agentId, list: null, failed: false };
    window.groveBench.listAgentSkills(agentId, repoPath)
      .then((list) => { if (skills.agentId === agentId) skills = { agentId, list, failed: false }; })
      .catch(() => { if (skills.agentId === agentId) skills = { agentId, list: [], failed: true }; });
    window.groveBench.getAdapterControls(agentId)
      .then((controls) => {
        if (editing.agentId !== agentId) return;
        modeOptions = controls.find((c) => c.id === CONTROL_IDS.permissionMode)?.options ?? [];
        // A mode this agent doesn't have would quietly start in Ask instead.
        if (editing.permissionMode && !modeOptions.some((o) => o.value === editing.permissionMode)) editing.permissionMode = '';
      })
      .catch(() => { modeOptions = []; });
  });

  function setAgent(agentId: string) {
    if (agentId === editing.agentId) return;
    editing.agentId = agentId;
    // Skills belong to an agent: another agent may not have this one.
    editing.skill = '';
  }

  function setTimingKind(kind: string) {
    if (kind === 'every') editing.timing = { kind: 'every', hours: 4 };
    else if (kind === 'daily') editing.timing = { kind: 'daily', time: '09:00', weekdaysOnly: true };
  }

  async function save() {
    if (saving) return;
    saving = true;
    formError = '';
    try {
      await schedulesStore.save(editing);
      onclose();
    } catch (e) {
      formError = stripIpcErrorPrefix(e instanceof Error ? e.message : String(e));
    } finally {
      saving = false;
    }
  }

  function agentName(id: string): string {
    return agentsStore.get(id)?.displayName ?? id;
  }
</script>

<div class="flex flex-col gap-3 min-w-0">
  <div class="text-xs text-muted-foreground">
    {editing.id ? 'Edit the schedule' : 'Schedule a skill'} in <span class="text-foreground">{store.repoDisplayName(repoPath)}</span>
  </div>

  <div class="flex flex-wrap items-end gap-3">
    <div class="flex flex-col gap-1">
      <Label for="schedule-agent">Agent</Label>
      <Select.Root type="single" value={editing.agentId} onValueChange={(v) => { if (v) setAgent(v); }}>
        <Select.Trigger id="schedule-agent" class="w-44">{editing.agentId ? agentName(editing.agentId) : 'Pick an agent'}</Select.Trigger>
        <Select.Content>
          {#each agents as agent (agent.id)}
            <Select.Item value={agent.id} label={agent.displayName} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="flex flex-col gap-1 flex-1 min-w-48">
      <Label for="schedule-skill">Skill</Label>
      <Select.Root type="single" value={editing.skill} onValueChange={(v) => { if (v) editing.skill = v; }}>
        <Select.Trigger id="schedule-skill" class="w-full font-mono" disabled={skillChoices.length === 0}>
          {editing.skill || (!skillsLoaded ? 'Loading…' : skillChoices.length ? 'Pick a skill' : 'No skills found')}
        </Select.Trigger>
        <Select.Content>
          {#each skillChoices as skill (skill.name)}
            <Select.Item value={skill.name} label={skill.name} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  </div>
  {#if skillsLoaded && skills.failed}
    <Notice tone="warning"><p>Couldn't read {agentName(editing.agentId)}'s skills in this project.</p></Notice>
  {:else if skillsLoaded && skillChoices.length === 0}
    <Notice tone="info">
      <p>{agentName(editing.agentId)} has no skills in this project{managed ? ' that are turned on' : ''}. Add a <code>SKILL.md</code> to one of its skills folders, then open this again.</p>
    </Notice>
  {/if}

  <div>
    <Label for="schedule-note" class="mb-1 block">Note <span class="text-muted-foreground font-normal">(optional, sent with the skill)</span></Label>
    <Textarea
      id="schedule-note"
      bind:value={editing.note}
      rows={3}
      maxlength={MAX_NOTE_LENGTH}
      placeholder="Take the top issue labelled agent-ready."
    />
  </div>

  <div class="flex flex-wrap items-end gap-3">
    <div class="flex flex-col gap-1">
      <Label for="schedule-mode">Mode</Label>
      <Select.Root type="single" value={editing.permissionMode || DEFAULT} onValueChange={(v) => { editing.permissionMode = !v || v === DEFAULT ? '' : v as PermissionMode; }}>
        <Select.Trigger id="schedule-mode" class="w-44">{modes.find((m) => m.value === (editing.permissionMode || DEFAULT))?.label}</Select.Trigger>
        <Select.Content>
          {#each modes as mode (mode.value)}
            <Select.Item value={mode.value} label={mode.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    {#if !folderProject}
      <div class="flex flex-col gap-1">
        <Label>Runs in</Label>
        <Segmented.Root
          value={editing.start}
          onValueChange={(v) => { if (v === 'new' || v === 'folder') editing.start = v; }}
          aria-label="Runs in"
          class="h-9"
        >
          <Segmented.Item value="new" title="Each run gets its own branch and worktree">New branch</Segmented.Item>
          <Segmented.Item value="folder" title="Runs in the project folder, on whatever is checked out">Project folder</Segmented.Item>
        </Segmented.Root>
      </div>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <Label>When</Label>
    <div class="flex flex-wrap items-center gap-3">
      <Segmented.Root value={editing.timing.kind} onValueChange={(v) => { if (v) setTimingKind(v); }} aria-label="When" class="h-9">
        <Segmented.Item value="every">Every</Segmented.Item>
        <Segmented.Item value="daily">Daily</Segmented.Item>
      </Segmented.Root>
      {#if editing.timing.kind === 'every'}
        <div class="flex items-center gap-1.5">
          <Input type="number" min="1" max="168" class="w-20" aria-label="Hours between runs" bind:value={editing.timing.hours} />
          <span class="text-xs text-muted-foreground">hours</span>
        </div>
      {:else}
        <Input type="time" class="w-32" aria-label="Time of day" bind:value={editing.timing.time} />
        <label class="flex items-center gap-1.5 text-xs">
          <Checkbox bind:checked={editing.timing.weekdaysOnly} />
          Weekdays only
        </label>
      {/if}
    </div>
    <div class="flex items-center gap-1.5">
      <span class="text-xs text-muted-foreground">Skip a run while</span>
      <Input type="number" min="1" max={MAX_OPEN_LIMIT} class="w-16" aria-label="Open threads before a run is skipped" bind:value={editing.maxOpen} />
      <span class="text-xs text-muted-foreground">of its threads are still open</span>
    </div>
  </div>

  {#if formError}
    <Notice tone="danger"><p>{formError}</p></Notice>
  {/if}

  <div class="flex justify-end gap-2 pt-1">
    <Button variant="subtle" size="sm" onclick={onclose}>Cancel</Button>
    <Button size="sm" disabled={saving || !editing.skill} onclick={save}>Save</Button>
  </div>
</div>
