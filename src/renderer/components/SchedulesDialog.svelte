<script lang="ts">
  /**
   * A project's scheduled skills: an agent's skill run in a new thread every
   * N hours or daily (shared/skill-schedules.ts). Lists them with when each
   * runs next and what its last run did, and adds or edits one. Opens on the
   * form when Schedule in the Skills popover gives it a skill.
   */
  import { onMount, untrack } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
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
  import { describeTiming, MAX_NOTE_LENGTH, MAX_OPEN_LIMIT, scheduleNextRun, type SkillSchedule, type SkillScheduleInput } from '../../shared/skill-schedules.js';
  import type { PermissionMode, SkillInfo } from '../../shared/types.js';

  let { repoPath, prefill = null, onclose }: {
    repoPath: string;
    /** Open on the form for a new schedule with these fields (from the Skills popover). */
    prefill?: Partial<SkillScheduleInput> | null;
    onclose: () => void;
  } = $props();

  let open = $state(true);
  let editing = $state<SkillScheduleInput | null>(null);
  let saving = $state(false);
  let formError = $state('');
  let confirmDeleteId = $state<string | null>(null);
  /** The picked agent's skills in this project, and for which agent. */
  let skillOptions = $state<SkillInfo[]>([]);
  let skillsFor = $state<string | null>(null);

  const schedules = $derived(schedulesStore.forRepo(repoPath));
  const folderProject = $derived(store.isFolderProject(repoPath));
  const agents = $derived(agentsStore.offered(settingsStore.current.enabledAlphaAgents));
  /** The skill being edited stays a choice even if its folder is gone, so
   *  opening the form doesn't quietly drop it. */
  const skillChoices = $derived(
    editing?.skill && !skillOptions.some((s) => s.name === editing?.skill)
      ? [{ name: editing.skill, description: 'Not found in this project now', source: 'project' as const }, ...skillOptions]
      : skillOptions,
  );

  /** The Select's value for "the default": an empty value reads as nothing picked. */
  const DEFAULT = '_default';

  /** Claude Code's names for its modes; another agent without one starts on its default. */
  const MODES: { value: PermissionMode | typeof DEFAULT; label: string }[] = [
    { value: DEFAULT, label: "Agent's default" },
    { value: 'default', label: 'Ask' },
    { value: 'plan', label: 'Plan' },
    { value: 'acceptEdits', label: 'Edit' },
    { value: 'readSafe', label: 'Read-safe' },
    { value: 'auto', label: 'Auto' },
  ];

  onMount(() => {
    // Agents load on first use, and nothing may have used them yet.
    void agentsStore.load().then(() => {
      // A new schedule starts on the default agent once the list is known.
      if (editing && !editing.id && !editing.agentId) editing.agentId = agentsStore.defaultId ?? '';
    });
    const given = untrack(() => prefill);
    if (given) editing = { ...blank(), ...given };
  });

  // The picked agent's skills, fetched again when the agent changes.
  $effect(() => {
    const agentId = editing?.agentId;
    if (!agentId || agentId === skillsFor) return;
    skillsFor = agentId;
    skillOptions = [];
    window.groveBench.listAgentSkills(agentId, repoPath)
      .then((list) => { if (skillsFor === agentId) skillOptions = list; })
      .catch(() => { /* none to offer */ });
  });

  /** An error from main, without Electron's "Error invoking remote method" wrapper. */
  const message = (e: unknown) => stripIpcErrorPrefix(e instanceof Error ? e.message : String(e));

  function blank(): SkillScheduleInput {
    return {
      repoPath,
      agentId: agentsStore.defaultId ?? '',
      skill: '',
      note: '',
      start: folderProject ? 'folder' : 'new',
      permissionMode: '',
      timing: { kind: 'daily', time: '09:00', weekdaysOnly: true },
      maxOpen: 1,
      paused: false,
    };
  }

  /** The fields the form edits, as a plain copy: the store's schedules are
   *  state proxies, which can't be cloned or sent to main as they are. */
  function fieldsOf(schedule: SkillSchedule): SkillScheduleInput {
    const { scheduledFrom: _f, checkedThrough: _c, lastOutcome: _o, sessionIds: _s, ...fields } = $state.snapshot(schedule) as SkillSchedule;
    return fields;
  }

  function edit(schedule: SkillSchedule | null) {
    formError = '';
    confirmDeleteId = null;
    editing = schedule ? fieldsOf(schedule) : blank();
  }

  function setAgent(agentId: string) {
    if (!editing || agentId === editing.agentId) return;
    editing.agentId = agentId;
    // Skills belong to an agent: another agent may not have this one.
    editing.skill = '';
  }

  function setTimingKind(kind: string) {
    if (!editing) return;
    if (kind === 'every') editing.timing = { kind: 'every', hours: 4 };
    else if (kind === 'daily') editing.timing = { kind: 'daily', time: '09:00', weekdaysOnly: true };
  }

  async function save() {
    if (!editing || saving) return;
    saving = true;
    formError = '';
    try {
      await schedulesStore.save(editing);
      editing = null;
    } catch (e) {
      formError = message(e);
    } finally {
      saving = false;
    }
  }

  async function togglePaused(schedule: SkillSchedule) {
    await schedulesStore.save({ ...fieldsOf(schedule), paused: !schedule.paused }).catch((e) => store.setError(message(e)));
  }

  async function remove(id: string) {
    confirmDeleteId = null;
    await schedulesStore.remove(id).catch((e) => store.setError(message(e)));
  }

  async function runNow(schedule: SkillSchedule) {
    // The new thread takes the screen; the dialog would sit over it.
    if (await schedulesStore.run(schedule)) close();
  }

  function close() {
    open = false;
    onclose();
  }

  function when(ts: number): string {
    return new Date(ts).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function outcomeText(schedule: SkillSchedule): string {
    const o = schedule.lastOutcome;
    if (!o) return 'Not run yet';
    if (o.error) return `Failed ${when(o.at)}: ${o.error}`;
    if (o.skipped) return `Skipped ${when(o.at)}: ${o.skipped}`;
    return `Started a thread ${when(o.at)}`;
  }

  function agentName(id: string): string {
    return agentsStore.get(id)?.displayName ?? id;
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) close(); }}>
  <Dialog.Content class="sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Scheduled skills · {store.repoDisplayName(repoPath)}</Dialog.Title>
      <Dialog.Description>
        Run an agent's skill in a new thread every few hours or each day. Schedules run only while Grove Bench is open.
      </Dialog.Description>
    </Dialog.Header>

    {#if editing}
      <div class="flex flex-col gap-3 mt-2 min-w-0">
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
            <Select.Root type="single" value={editing.skill} onValueChange={(v) => { if (editing && v) editing.skill = v; }}>
              <Select.Trigger id="schedule-skill" class="w-full font-mono" disabled={skillChoices.length === 0}>
                {editing.skill || (skillChoices.length ? 'Pick a skill' : 'No skills found')}
              </Select.Trigger>
              <Select.Content>
                {#each skillChoices as skill (skill.name)}
                  <Select.Item value={skill.name} label={skill.name} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        </div>
        {#if editing.agentId && skillsFor === editing.agentId && skillChoices.length === 0}
          <Notice tone="info">
            <p>{agentName(editing.agentId)} has no skills in this project. Add a <code>SKILL.md</code> to one of its skills folders, then open this again.</p>
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
            <Select.Root type="single" value={editing.permissionMode || DEFAULT} onValueChange={(v) => { if (editing) editing.permissionMode = !v || v === DEFAULT ? '' : v as PermissionMode; }}>
              <Select.Trigger id="schedule-mode" class="w-44">{MODES.find((m) => m.value === (editing?.permissionMode || DEFAULT))?.label}</Select.Trigger>
              <Select.Content>
                {#each MODES as mode (mode.value)}
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
                onValueChange={(v) => { if (editing && (v === 'new' || v === 'folder')) editing.start = v; }}
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
              <Input type="time" class="w-28" aria-label="Time of day" bind:value={editing.timing.time} />
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
      </div>

      <Dialog.Footer>
        <Button variant="subtle" size="sm" onclick={() => { editing = null; }}>Back</Button>
        <Button size="sm" disabled={saving || !editing.skill} onclick={save}>Save</Button>
      </Dialog.Footer>
    {:else}
      <!-- min-w-0: the dialog is a grid, whose items otherwise grow to fit a long note. -->
      <div class="flex flex-col gap-2 mt-2 min-w-0">
        {#each schedules as schedule (schedule.id)}
          {@const next = scheduleNextRun(schedule)}
          {@const openCount = schedulesStore.openThreads(schedule)}
          <div class="border border-border px-3 py-2 flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium font-mono truncate">{schedule.skill}</div>
              {#if schedule.note.trim()}
                <div class="text-caption truncate" title={schedule.note}>{schedule.note}</div>
              {/if}
              <div class="text-caption text-muted-foreground">
                {describeTiming(schedule.timing)}{schedule.paused ? ' · paused' : ''} · {agentName(schedule.agentId)}
              </div>
              {#if next}
                <div class="text-caption text-muted-foreground">Next run {when(next)}</div>
              {/if}
              <div class="text-caption text-muted-foreground">
                {outcomeText(schedule)}{openCount ? ` · ${openCount} open` : ''}
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <Button size="xs" variant="secondary" disabled={!!schedulesStore.starting[schedule.id]} onclick={() => runNow(schedule)}>Run now</Button>
              <Button size="xs" variant="subtle" onclick={() => togglePaused(schedule)}>{schedule.paused ? 'Resume' : 'Pause'}</Button>
              <Button size="xs" variant="subtle" onclick={() => edit(schedule)}>Edit</Button>
              {#if confirmDeleteId === schedule.id}
                <Button size="xs" variant="destructive" onclick={() => remove(schedule.id)}>Delete</Button>
              {:else}
                <Button
                  size="icon-xs"
                  variant="quiet-destructive"
                  onclick={() => { confirmDeleteId = schedule.id; }}
                  title="Delete schedule"
                  aria-label="Delete the schedule for {schedule.skill}"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </Button>
              {/if}
            </div>
          </div>
        {:else}
          <p class="text-xs text-muted-foreground">No scheduled skills in this project yet. You can also schedule a skill from the Skills list in the status bar.</p>
        {/each}
      </div>

      <Dialog.Footer>
        <Button variant="subtle" size="sm" onclick={close}>Close</Button>
        <Button size="sm" onclick={() => edit(null)}>Schedule a skill</Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
