import { describe, it, expect, beforeEach } from 'vitest';
import { skillsPanelStore } from './skillsPanel.svelte.js';

beforeEach(() => skillsPanelStore.close());

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

  it('closes, dropping the form', () => {
    skillsPanelStore.editSchedule('/repo');
    skillsPanelStore.close();
    expect(skillsPanelStore).toMatchObject({ open: false, form: null });
  });
});
