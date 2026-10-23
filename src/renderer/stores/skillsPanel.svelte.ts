import type { SkillScheduleInput } from '../../shared/skill-schedules.js';

export type SkillsPanelTab = 'thread' | 'scheduled';

/** A schedule being added (no id in `initial`) or edited in the Scheduled tab. */
export interface ScheduleFormState {
  repoPath: string;
  initial?: Partial<SkillScheduleInput>;
}

/**
 * The Skills drawer: a slide-out on the right with the open thread's skills
 * (This thread) and every project's scheduled skills (Scheduled). Opened from
 * Skills in the status bar, a project's clock in the sidebar, and Schedule on
 * a skill.
 */
class SkillsPanelStore {
  open = $state(false);
  tab = $state<SkillsPanelTab>('thread');
  /** The project the Scheduled tab lists first (from its sidebar clock). */
  focusRepo = $state<string | null>(null);
  /** The schedule form, when one is open in the Scheduled tab. */
  form = $state<ScheduleFormState | null>(null);

  showThread(): void {
    this.tab = 'thread';
    this.form = null;
    this.open = true;
  }

  showScheduled(repoPath?: string): void {
    this.tab = 'scheduled';
    this.focusRepo = repoPath ?? null;
    this.form = null;
    this.open = true;
  }

  /** Open the Scheduled tab on the form: a new schedule, or one to edit. */
  editSchedule(repoPath: string, initial?: Partial<SkillScheduleInput>): void {
    this.tab = 'scheduled';
    this.focusRepo = repoPath;
    this.form = { repoPath, ...(initial ? { initial } : {}) };
    this.open = true;
  }

  close(): void {
    this.open = false;
    this.form = null;
  }
}

export const skillsPanelStore = new SkillsPanelStore();
