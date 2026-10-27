import type { SkillScheduleInput } from '../../shared/skill-schedules.js';
import type { SkillFile, SkillInfo } from '../../shared/types.js';
import type { SkillGroupId } from '../lib/skill-groups.js';

export type SkillsPanelTab = 'thread' | 'scheduled';

/** A schedule being added (no id in `initial`) or edited in the Scheduled tab. */
export interface ScheduleFormState {
  repoPath: string;
  initial?: Partial<SkillScheduleInput>;
}

/** A skill's SKILL.md open in the This thread tab's editor. */
export interface SkillEditState {
  /** The thread whose agent and worktree the skill is read from. */
  sessionId: string;
  /** As listed: reading and saving go by its path. */
  skill: SkillInfo;
  /** The file as last read; null while it loads. */
  file: SkillFile | null;
  /** The text in the editor. */
  text: string;
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
  /** The skill editor, when one is open in the This thread tab. It takes
   *  the list's place whichever thread is open, so another thread opening
   *  meanwhile can't hide it or its unsaved changes. */
  edit = $state<SkillEditState | null>(null);
  /** The schedule form's fields differ from what it opened with
   *  (ScheduleForm keeps this up to date). */
  formDirty = $state(false);
  /** What runs once the editor's or the schedule form's unsaved changes are
   *  dropped, while it asks. */
  pendingDiscard = $state<(() => void) | null>(null);
  /** The This thread tab's sections folded away, kept while the app runs. */
  collapsed = $state<SkillGroupId[]>([]);
  /** The This thread tab's search, kept while a skill is edited. */
  query = $state('');

  /** The editor's text differs from the file it read, or the schedule
   *  form has changes. */
  get unsaved(): boolean {
    return (!!this.edit?.file && this.edit.text !== this.edit.file.content) || (!!this.form && this.formDirty);
  }

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

  /** Open a skill's SKILL.md in the This thread tab's editor. */
  editSkill(sessionId: string, skill: SkillInfo): void {
    this.tab = 'thread';
    this.form = null;
    this.pendingDiscard = null;
    this.edit = { sessionId, skill, file: null, text: '' };
    this.open = true;
  }

  /** Run `then` now, or once unsaved changes are discarded: the editor or
   *  the schedule form asks in place of its Save. */
  unlessUnsaved(then: () => void): void {
    if (this.unsaved) {
      this.pendingDiscard = then;
      return;
    }
    then();
  }

  /** Drop the editor's or the schedule form's changes and do what was
   *  waiting on that. */
  discardChanges(): void {
    const then = this.pendingDiscard;
    this.pendingDiscard = null;
    this.edit = null;
    this.formDirty = false;
    then?.();
  }

  /** Leave the editor for the list, asking first about unsaved changes. */
  leaveEdit(): void {
    this.unlessUnsaved(() => { this.edit = null; });
  }

  /** Leave the schedule form for the list, asking first about changes. */
  leaveForm(): void {
    this.unlessUnsaved(() => {
      this.form = null;
      this.formDirty = false;
    });
  }

  /** Close the drawer, asking first about unsaved changes. */
  requestClose(): void {
    this.unlessUnsaved(() => this.close());
  }

  toggleGroup(id: SkillGroupId): void {
    this.collapsed = this.collapsed.includes(id) ? this.collapsed.filter((g) => g !== id) : [...this.collapsed, id];
  }

  close(): void {
    this.open = false;
    this.form = null;
    this.formDirty = false;
    this.edit = null;
    this.pendingDiscard = null;
    this.query = '';
  }
}

export const skillsPanelStore = new SkillsPanelStore();
