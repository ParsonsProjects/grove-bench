<script lang="ts">
  /**
   * The Skills drawer's Scheduled tab: every project's scheduled skills,
   * grouped by project, with when each runs next and what its last run did,
   * and the form to add or edit one. A removed project's schedules stay
   * listed, so they can still be deleted.
   */
  import { Button } from '$lib/components/ui/button/index.js';
  import { schedulesStore } from '../stores/schedules.svelte.js';
  import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { getRepoColor } from '../lib/repo-colors.js';
  import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';
  import { describeTiming, scheduleNextRun, type SkillSchedule, type SkillScheduleInput } from '../../shared/skill-schedules.js';
  import ScheduleForm from './ScheduleForm.svelte';

  let confirmDeleteId = $state<string | null>(null);

  /** The project you came from first, then the rest in sidebar order, then
   *  removed projects that still have schedules. The open thread's project
   *  shows even with none, for its Schedule a skill. */
  const groups = $derived.by(() => {
    const active = store.sessions.find((s) => s.id === store.activeSessionId)?.repoPath;
    const withSchedules = new Set(schedulesStore.list.map((s) => s.repoPath));
    const order = [
      ...(skillsPanelStore.focusRepo ? [skillsPanelStore.focusRepo] : []),
      ...(active ? [active] : []),
      ...store.repos.filter((r) => withSchedules.has(r)),
      ...[...withSchedules].filter((r) => !store.repos.includes(r)),
    ];
    return [...new Set(order)].map((repoPath) => ({
      repoPath,
      removed: !store.repos.includes(repoPath),
      schedules: schedulesStore.forRepo(repoPath),
    }));
  });

  /** An error from main, without Electron's "Error invoking remote method" wrapper. */
  const message = (e: unknown) => stripIpcErrorPrefix(e instanceof Error ? e.message : String(e));

  /** The fields the form edits, as a plain copy: the store's schedules are
   *  state proxies, which can't be cloned or sent to main as they are. */
  function fieldsOf(schedule: SkillSchedule): SkillScheduleInput {
    const { scheduledFrom: _f, checkedThrough: _c, lastOutcome: _o, sessionIds: _s, ...fields } = $state.snapshot(schedule) as SkillSchedule;
    return fields;
  }

  async function togglePaused(schedule: SkillSchedule) {
    await schedulesStore.save({ ...fieldsOf(schedule), paused: !schedule.paused }).catch((e) => store.setError(message(e)));
  }

  async function remove(id: string) {
    confirmDeleteId = null;
    await schedulesStore.remove(id).catch((e) => store.setError(message(e)));
  }

  async function runNow(schedule: SkillSchedule) {
    // The new thread takes the screen; the drawer would sit over it.
    if (await schedulesStore.run(schedule)) skillsPanelStore.close();
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

{#if skillsPanelStore.form}
  {@const form = skillsPanelStore.form}
  {#key form}
    <ScheduleForm repoPath={form.repoPath} initial={form.initial ?? null} onclose={() => { skillsPanelStore.form = null; }} />
  {/key}
{:else}
  <p class="text-xs text-muted-foreground mb-3">
    Run a skill in a new thread every few hours or each day. Schedules run only while Grove Bench is open.
  </p>
  {#each groups as group (group.repoPath)}
    {@const color = getRepoColor(store.repos, group.repoPath, settingsStore.current.repoColors)}
    {@const label = group.removed ? `${group.repoPath} (removed project)` : store.repoDisplayName(group.repoPath)}
    <section class="mb-4 min-w-0" aria-label="Scheduled skills in {label}">
      <div class="flex items-center gap-2 mb-1.5">
        {#if color}
          <span class="inline-block w-2 h-2 shrink-0" style="background-color: {color}"></span>
        {/if}
        <span class="text-xs font-medium text-muted-foreground truncate flex-1" title={group.repoPath}>{label}</span>
        {#if !group.removed}
          <Button size="2xs" variant="subtle" onclick={() => skillsPanelStore.editSchedule(group.repoPath)}>Schedule a skill</Button>
        {/if}
      </div>
      <div class="flex flex-col gap-2 min-w-0">
        {#each group.schedules as schedule (schedule.id)}
          {@const next = scheduleNextRun(schedule)}
          {@const openCount = schedulesStore.openThreads(schedule)}
          <div class="border border-border bg-card/80 px-3 py-2 min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-sm font-medium font-mono truncate flex-1">{schedule.skill}</span>
              <span class="text-caption text-muted-foreground shrink-0">{agentName(schedule.agentId)}</span>
            </div>
            {#if schedule.note.trim()}
              <div class="text-caption mt-0.5 line-clamp-2" title={schedule.note}>{schedule.note}</div>
            {/if}
            <div class="text-caption text-muted-foreground mt-1">
              {describeTiming(schedule.timing)}{schedule.paused ? ' · paused' : next ? ` · next ${when(next)}` : ''}
            </div>
            <div class="text-caption text-muted-foreground">
              {outcomeText(schedule)}{openCount ? ` · ${openCount} open` : ''}
            </div>
            <div class="flex items-center gap-1 mt-2">
              <Button
                size="xs"
                variant="secondary"
                disabled={group.removed || !!schedulesStore.starting[schedule.id]}
                title={group.removed ? 'Its project was removed' : 'Run it now in a new thread'}
                onclick={() => runNow(schedule)}
              >Run now</Button>
              <Button size="xs" variant="subtle" onclick={() => togglePaused(schedule)}>{schedule.paused ? 'Resume' : 'Pause'}</Button>
              {#if !group.removed}
                <Button size="xs" variant="subtle" onclick={() => skillsPanelStore.editSchedule(schedule.repoPath, fieldsOf(schedule))}>Edit</Button>
              {/if}
              <span class="flex-1"></span>
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
          <p class="text-caption text-muted-foreground">No scheduled skills in this project.</p>
        {/each}
      </div>
    </section>
  {:else}
    <p class="text-xs text-muted-foreground mt-4 text-center">
      No scheduled skills yet. Use Schedule on a skill in This thread.
    </p>
  {/each}
{/if}
