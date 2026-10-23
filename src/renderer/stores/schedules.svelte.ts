import { CONTROL_IDS } from '../../shared/types.js';
import { skillRunPrompt, type ScheduleOutcome, type SkillRun, type SkillSchedule, type SkillScheduleInput } from '../../shared/skill-schedules.js';
import { store as sessionStore } from './sessions.svelte.js';
import { draftStore, type ThreadStart } from './draft.svelte.js';

/** How often, and how many times, to ask again while app-state.json can't be
 *  read (a passing lock, usually an antivirus scan). */
const LOAD_RETRY_MS = 1000;
const LOAD_ATTEMPTS = 5;

/**
 * Skills run in a new thread: once, by hand (Run in the Skills popover), or
 * on a schedule main keeps (main/skill-schedules.ts). By hand, the thread
 * opens; on a schedule it starts without taking the screen, and not at all
 * while the schedule has `maxOpen` threads still open.
 */
class SchedulesStore {
  list = $state<SkillSchedule[]>([]);
  /** Schedules whose run is starting, and who started it: Run now, or the
   *  schedule. Run now can't start two at once. */
  starting = $state<Record<string, 'hand' | 'schedule'>>({});
  private started = false;
  /** The window has its threads back, so the open-thread cap can count them
   *  (markRestored). */
  restored = false;

  init(): void {
    if (this.started) return;
    this.started = true;
    window.groveBench.onSkillSchedulesChanged((list) => { this.list = list; });
    window.groveBench.onSkillScheduleDue((id) => void this.runDue(id));
    void this.load();
  }

  async load(retryMs = LOAD_RETRY_MS): Promise<void> {
    for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
      try {
        const list = await window.groveBench.listSkillSchedules();
        if (list) {
          this.list = list;
          return;
        }
      } catch (err) {
        console.warn('[schedules] could not load the schedules:', err);
      }
      if (attempt < LOAD_ATTEMPTS) await new Promise((r) => setTimeout(r, retryMs));
    }
    console.warn('[schedules] app-state.json stayed unreadable; schedules show once one runs');
  }

  forRepo(repoPath: string): SkillSchedule[] {
    return this.list.filter((s) => s.repoPath === repoPath);
  }

  async save(input: SkillScheduleInput): Promise<SkillSchedule> {
    const saved = await window.groveBench.saveSkillSchedule($state.snapshot(input) as SkillScheduleInput);
    this.put(saved);
    return saved;
  }

  async remove(id: string): Promise<void> {
    await window.groveBench.deleteSkillSchedule(id);
    this.list = this.list.filter((s) => s.id !== id);
  }

  /** The schedule's threads still in the Threads list: not closed or
   *  deleted. Threads waiting to reconnect after a restart or a wake count. */
  openThreads(schedule: SkillSchedule): number {
    const ids = new Set(schedule.sessionIds);
    return sessionStore.sessions.filter((s) => ids.has(s.id) && sessionStore.isOpenTab(s)).length;
  }

  /** Start a thread that runs the skill, on its own agent only. A refusal
   *  comes back with its reason rather than as a toast, and so does a start
   *  that threw. */
  private async startRun(run: SkillRun & { model?: string }, focus: boolean): Promise<ThreadStart> {
    try {
      return await draftStore.startThreadFor({
        repoPath: run.repoPath,
        text: skillRunPrompt(run),
        agentId: run.agentId,
        ...(run.model ? { model: run.model } : {}),
        start: run.start === 'folder' ? { kind: 'folder' } : { kind: 'new', branchName: '', baseBranch: '' },
        ...(run.permissionMode ? { controls: { [CONTROL_IDS.permissionMode]: run.permissionMode } } : {}),
        focus,
        strictAgent: true,
        quiet: true,
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Run a skill once, by hand: its thread opens. Returns whether it started. */
  async runSkill(run: SkillRun & { model?: string }): Promise<boolean> {
    const result = await this.startRun(run, true);
    if ('error' in result) sessionStore.setError(`Skill "${run.skill}" didn't start a thread: ${sentence(result.error)}`);
    return 'id' in result;
  }

  /** Called once the window has restored its threads (App.svelte). */
  markRestored(): void {
    this.restored = true;
  }

  /** A run main says is due. Skipped until the window has its threads back;
   *  one for a schedule this window doesn't have yet (the list failed to
   *  load) fetches the list first. */
  private async runDue(id: string): Promise<void> {
    // Main's fallback can start the scheduler before the restore is done
    // (or when it failed): the cap would count none of the threads yet.
    if (!this.restored) {
      await this.record(id, { skipped: 'Grove was still restoring its threads' });
      return;
    }
    let schedule = this.list.find((s) => s.id === id);
    if (!schedule) {
      await this.load(0);
      schedule = this.list.find((s) => s.id === id);
    }
    if (schedule) await this.run(schedule, { scheduled: true });
    else console.warn(`[schedules] ${id} is due but isn't in the list (deleted meanwhile?)`);
  }

  /** Run a schedule now (Run now) or because it is due, and note what
   *  happened. Returns whether a thread started. */
  async run(schedule: SkillSchedule, { scheduled = false } = {}): Promise<boolean> {
    const already = this.starting[schedule.id];
    if (already) {
      // Run now twice: the second click does nothing. Due while a run still
      // starts: that run stands in for it.
      if (scheduled) await this.record(schedule.id, { skipped: already === 'hand' ? 'a run by hand was starting' : 'the last run was still starting' });
      return false;
    }
    if (scheduled && !sessionStore.repos.includes(schedule.repoPath)) {
      // Kept until deleted in the Scheduled tab, and runs again if the
      // project comes back: noted each time, no toast.
      await this.record(schedule.id, { skipped: 'its project was removed' });
      return false;
    }
    if (scheduled) {
      const open = this.openThreads(schedule);
      if (open >= schedule.maxOpen) {
        // The cap working as set: noted, no toast.
        await this.record(schedule.id, { skipped: open === 1 ? '1 thread from it is still open' : `${open} threads from it are still open` });
        return false;
      }
    }
    this.starting = { ...this.starting, [schedule.id]: scheduled ? 'schedule' : 'hand' };
    try {
      const result = await this.startRun(schedule, !scheduled);
      if ('error' in result) {
        sessionStore.setError(`Scheduled skill "${schedule.skill}" didn't start a thread: ${sentence(result.error)}`);
        await this.record(schedule.id, { error: result.error });
        return false;
      }
      await this.record(schedule.id, { sessionId: result.id });
      return true;
    } finally {
      const { [schedule.id]: _, ...rest } = this.starting;
      this.starting = rest;
    }
  }

  private async record(id: string, outcome: Omit<ScheduleOutcome, 'at'>): Promise<void> {
    try {
      const saved = await window.groveBench.recordSkillScheduleRun(id, outcome);
      if (saved) this.put(saved);
    } catch (err) {
      console.error('Failed to note a scheduled run:', err);
    }
  }

  private put(schedule: SkillSchedule): void {
    const i = this.list.findIndex((s) => s.id === schedule.id);
    this.list = i === -1 ? [...this.list, schedule] : this.list.map((s) => (s.id === schedule.id ? schedule : s));
  }
}

/** A reason as the end of a sentence: one full stop, whatever main sent. */
function sentence(reason: string): string {
  return `${reason.replace(/\.+$/, '')}.`;
}

export const schedulesStore = new SchedulesStore();
