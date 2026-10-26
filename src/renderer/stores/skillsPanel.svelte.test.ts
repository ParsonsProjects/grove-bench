import { describe, it, expect, beforeEach, vi } from 'vitest';
import { skillsPanelStore } from './skillsPanel.svelte.js';

beforeEach(() => {
  skillsPanelStore.close();
  skillsPanelStore.collapsed = [];
});

const triage = { name: 'triage', description: 'Sort new issues', source: 'project' as const, path: '/wt/.claude/skills/triage/SKILL.md' };

/** The editor open on triage, its file read and the text changed or not. */
function editing(changed: boolean) {
  skillsPanelStore.editSkill('t1', triage);
  skillsPanelStore.edit!.file = { path: triage.path, content: 'text' };
  skillsPanelStore.edit!.text = changed ? 'new text' : 'text';
}

describe('skillsPanelStore', () => {
  it('opens on This thread, with no form', () => {
    skillsPanelStore.editSchedule('/repo', { skill: 'triage' });
    skillsPanelStore.showThread();
    expect(skillsPanelStore).toMatchObject({ open: true, tab: 'thread', form: null });
  });

  it('opens on Scheduled, listing a project first when given one', () => {
    skillsPanelStore.showScheduled('/repo');
    expect(skillsPanelStore).toMatchObject({ open: true, tab: 'scheduled', focusRepo: '/repo', form: null });
    skillsPanelStore.showScheduled();
    expect(skillsPanelStore.focusRepo).toBeNull();
  });

  it('opens the form on Scheduled for a new or edited schedule', () => {
    skillsPanelStore.editSchedule('/repo', { agentId: 'gemini-cli', skill: 'triage' });
    expect(skillsPanelStore).toMatchObject({
      open: true, tab: 'scheduled', focusRepo: '/repo',
      form: { repoPath: '/repo', initial: { agentId: 'gemini-cli', skill: 'triage' } },
    });
    skillsPanelStore.editSchedule('/repo');
    expect(skillsPanelStore.form).toEqual({ repoPath: '/repo' });
  });

  it('opens the editor on This thread, in place of a schedule form', () => {
    skillsPanelStore.editSchedule('/repo');
    skillsPanelStore.editSkill('t1', triage);
    expect(skillsPanelStore).toMatchObject({ open: true, tab: 'thread', form: null, edit: { sessionId: 't1', skill: triage, file: null, text: '' } });
    // Nothing to lose while the file loads.
    expect(skillsPanelStore.unsaved).toBe(false);
  });

  it('does what was asked at once when the editor has no unsaved changes', () => {
    editing(false);
    skillsPanelStore.requestClose();
    expect(skillsPanelStore).toMatchObject({ open: false, edit: null });

    editing(false);
    skillsPanelStore.leaveEdit();
    expect(skillsPanelStore).toMatchObject({ open: true, edit: null, pendingDiscard: null });
  });

  it('asks before dropping unsaved changes, and does what was asked only on Discard', () => {
    editing(true);
    const then = vi.fn();
    skillsPanelStore.unlessUnsaved(then);
    expect(then).not.toHaveBeenCalled();
    expect(skillsPanelStore.pendingDiscard).toBe(then);
    skillsPanelStore.discardEdit();
    expect(then).toHaveBeenCalledOnce();
    expect(skillsPanelStore).toMatchObject({ edit: null, pendingDiscard: null });

    editing(true);
    skillsPanelStore.requestClose();
    expect(skillsPanelStore.open).toBe(true);
    skillsPanelStore.discardEdit();
    expect(skillsPanelStore.open).toBe(false);
  });

  it('folds and unfolds a section', () => {
    skillsPanelStore.toggleGroup('user');
    skillsPanelStore.toggleGroup('session');
    skillsPanelStore.toggleGroup('user');
    expect(skillsPanelStore.collapsed).toEqual(['session']);
  });

  it('closes, dropping the form', () => {
    skillsPanelStore.editSchedule('/repo');
    skillsPanelStore.close();
    expect(skillsPanelStore).toMatchObject({ open: false, form: null });
  });

  it('closes without asking when told to, dropping the editor', () => {
    editing(true);
    skillsPanelStore.close();
    expect(skillsPanelStore).toMatchObject({ open: false, edit: null, pendingDiscard: null });
  });
});
