import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import SkillsPanel from './SkillsPanel.svelte';
import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
import { schedulesStore } from '../stores/schedules.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';

// jsdom has no Web Animations; the drawer's slide runs through them.
const realAnimate = Element.prototype.animate;

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.animate = vi.fn(() => ({ onfinish: null, cancel() {}, finished: Promise.resolve(), currentTime: 0 }) as unknown as Animation) as never;
  store.repos = ['/repo'];
  store.sessions = [{ id: 't1', branch: 'b', repoPath: '/repo', status: 'running', agentType: 'gemini-cli', createdAt: 0 }] as typeof store.sessions;
  store.activeSessionId = 't1';
  agentsStore.list = [{ id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} }];
  agentsStore.loaded = true;
  schedulesStore.list = [];
  mockGroveBench.listSkills.mockResolvedValue([{ name: 'triage', description: 'Sort new issues', source: 'project' }]);
});

afterEach(() => {
  cleanup();
  skillsPanelStore.close();
  store.sessions = [];
  store.activeSessionId = null;
  document.querySelectorAll('[data-test-listbox]').forEach((el) => el.remove());
  Element.prototype.animate = realAnimate;
});

describe('SkillsPanel', () => {
  it("shows the open thread's skills on This thread", async () => {
    skillsPanelStore.showThread();
    render(SkillsPanel);
    expect(screen.getByRole('complementary', { name: 'Skills' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Run triage in a new thread' })).toBeInTheDocument();
  });

  it('opens on Scheduled from a project, and says when nothing is scheduled', () => {
    skillsPanelStore.showScheduled('/repo');
    render(SkillsPanel);
    expect(screen.getByRole('tab', { name: /Scheduled/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No scheduled skills in this project.')).toBeInTheDocument();
  });

  it('asks for a thread on This thread when none is open', () => {
    store.activeSessionId = null;
    skillsPanelStore.showThread();
    render(SkillsPanel);
    expect(screen.getByText("Open a thread to see its agent's skills.")).toBeInTheDocument();
  });

  it('closes the form, then the drawer, on Escape', async () => {
    skillsPanelStore.editSchedule('/repo', { agentId: 'gemini-cli', skill: 'triage' });
    render(SkillsPanel);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(skillsPanelStore.form).toBeNull();
    expect(skillsPanelStore.open).toBe(true);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(skillsPanelStore.open).toBe(false);
  });

  it('leaves Escape to an open dropdown', async () => {
    skillsPanelStore.showThread();
    render(SkillsPanel);
    const listbox = document.createElement('div');
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('data-test-listbox', '');
    document.body.appendChild(listbox);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(skillsPanelStore.open).toBe(true);
  });

  it('closes from its close button', async () => {
    skillsPanelStore.showThread();
    render(SkillsPanel);
    await fireEvent.click(screen.getByRole('button', { name: 'Close skills' }));
    expect(skillsPanelStore.open).toBe(false);
  });
});
