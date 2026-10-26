import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import SkillsPanel from './SkillsPanel.svelte';
import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
import { schedulesStore } from '../stores/schedules.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';

// jsdom has no Web Animations, which the drawer's slide runs through, and
// no scrollIntoView, which a dropdown calls on its picked option.
const realAnimate = Element.prototype.animate;
const realScroll = Element.prototype.scrollIntoView;

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.animate = vi.fn(() => ({ onfinish: null, cancel() {}, finished: Promise.resolve(), currentTime: 0 }) as unknown as Animation);
  Element.prototype.scrollIntoView = function scrollIntoView() {};
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
  Element.prototype.animate = realAnimate;
  Element.prototype.scrollIntoView = realScroll;
});

describe('SkillsPanel', () => {
  it("shows the open thread's skills on This thread", async () => {
    skillsPanelStore.showThread();
    render(SkillsPanel);
    expect(screen.getByRole('dialog', { name: 'Skills' })).toHaveAttribute('aria-modal', 'true');
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

  /** Escape where the keyboard is. */
  const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

  it('closes the form, then the drawer, on Escape', async () => {
    skillsPanelStore.editSchedule('/repo', { agentId: 'gemini-cli', skill: 'triage' });
    render(SkillsPanel);
    await escape();
    expect(skillsPanelStore.form).toBeNull();
    expect(skillsPanelStore.open).toBe(true);
    await escape();
    expect(skillsPanelStore.open).toBe(false);
  });

  it('moves focus to the open tab, and keeps it in the drawer', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    skillsPanelStore.showThread();
    render(SkillsPanel);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'This thread' })).toHaveFocus());
    outside.focus();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Skills' }).contains(document.activeElement)).toBe(true));
    outside.remove();
  });

  it('gives focus back on close, but not once Run has opened a new thread', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    skillsPanelStore.showThread();
    render(SkillsPanel);
    await waitFor(() => expect(opener).not.toHaveFocus());
    skillsPanelStore.close();
    await waitFor(() => expect(opener).toHaveFocus());
    cleanup();

    opener.focus();
    skillsPanelStore.showThread();
    render(SkillsPanel);
    await waitFor(() => expect(opener).not.toHaveFocus());
    store.activeSessionId = 'started-by-run';
    skillsPanelStore.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(opener).not.toHaveFocus();
    opener.remove();
  });

  it('leaves Escape to a dropdown open in it', async () => {
    skillsPanelStore.editSchedule('/repo', { agentId: 'gemini-cli', skill: 'triage' });
    render(SkillsPanel);
    const mode = await screen.findByLabelText('Mode');
    await fireEvent.keyDown(mode, { key: 'Enter' });
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await escape();
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(skillsPanelStore.form).not.toBeNull();
    expect(skillsPanelStore.open).toBe(true);
  });

  it('closes from its close button', async () => {
    skillsPanelStore.showThread();
    render(SkillsPanel);
    await fireEvent.click(screen.getByRole('button', { name: 'Close skills' }));
    expect(skillsPanelStore.open).toBe(false);
  });

  it('clears a search on Escape before closing', async () => {
    skillsPanelStore.showThread();
    render(SkillsPanel);
    const search = await screen.findByRole('searchbox', { name: 'Search skills' });
    search.focus();
    await fireEvent.input(search, { target: { value: 'tri' } });
    await escape();
    expect(search).toHaveValue('');
    expect(skillsPanelStore.open).toBe(true);
    await escape();
    expect(skillsPanelStore.open).toBe(false);
  });

  describe('with a skill open in the editor', () => {
    const triage = { name: 'triage', description: 'Sort new issues', source: 'project' as const, path: '/repo/.claude/skills/triage/SKILL.md' };

    async function editTriage(change: boolean) {
      mockGroveBench.readSkill.mockResolvedValue({ path: triage.path, content: 'text' });
      skillsPanelStore.editSkill('t1', triage);
      render(SkillsPanel);
      const box = await screen.findByRole('textbox', { name: 'SKILL.md for triage' });
      if (change) await fireEvent.input(box, { target: { value: 'changed' } });
      return box;
    }

    it('keeps the editor, its text and its question when another thread opens meanwhile', async () => {
      await editTriage(true);
      // As Ctrl+N or Ctrl+Shift+T can, with the drawer open.
      store.sessions = [...store.sessions, { id: 't2', branch: 'c', repoPath: '/repo', status: 'running', agentType: 'gemini-cli', createdAt: 0 }] as typeof store.sessions;
      store.activeSessionId = 't2';
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'SKILL.md for triage' })).toHaveValue('changed'));
      expect(mockGroveBench.readSkill).toHaveBeenCalledOnce();

      await escape();
      expect(screen.getByText('Discard your changes to triage?')).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      // The list is the open thread's.
      expect(await screen.findByRole('button', { name: 'Run triage in a new thread' })).toBeInTheDocument();
      expect(mockGroveBench.listSkills).toHaveBeenLastCalledWith('t2', '/repo');
    });

    it('keeps the search while a skill is edited', async () => {
      mockGroveBench.readSkill.mockResolvedValue({ path: triage.path, content: 'text' });
      mockGroveBench.listSkills.mockResolvedValue([triage]);
      skillsPanelStore.showThread();
      render(SkillsPanel);
      await fireEvent.input(await screen.findByRole('searchbox', { name: 'Search skills' }), { target: { value: 'sort' } });
      await fireEvent.click(await screen.findByRole('button', { name: 'Edit triage' }));
      expect(await screen.findByRole('textbox', { name: 'SKILL.md for triage' })).toBeInTheDocument();
      expect(screen.queryByRole('searchbox')).toBeNull();
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await screen.findByRole('searchbox', { name: 'Search skills' })).toHaveValue('sort');
    });

    it('goes back to the list on Escape, then closes', async () => {
      await editTriage(false);
      await escape();
      expect(skillsPanelStore.edit).toBeNull();
      expect(skillsPanelStore.open).toBe(true);
      expect(await screen.findByRole('button', { name: 'Run triage in a new thread' })).toBeInTheDocument();
      await escape();
      expect(skillsPanelStore.open).toBe(false);
    });

    it('asks before Escape drops unsaved changes; a second Escape keeps editing', async () => {
      await editTriage(true);
      await escape();
      expect(screen.getByText('Discard your changes to triage?')).toBeInTheDocument();
      await escape();
      expect(screen.queryByText('Discard your changes to triage?')).toBeNull();
      expect(skillsPanelStore.edit?.text).toBe('changed');
      expect(skillsPanelStore.open).toBe(true);
    });

    /** A click on the dimmed app beside the drawer: off the drawer's box,
     *  which jsdom lays out at 0 by 0. */
    async function clickOutside() {
      const overlay = document.querySelector('[data-dialog-overlay]') ?? document.body;
      // bits-ui starts listening a moment after the drawer opens.
      await new Promise((r) => setTimeout(r, 20));
      overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', clientX: 5, clientY: 5 }));
      // bits-ui waits 10 ms for a layer above to take it first.
      await new Promise((r) => setTimeout(r, 50));
    }

    it('closes on a click outside, unless that would drop unsaved changes', async () => {
      await editTriage(false);
      await clickOutside();
      await waitFor(() => expect(skillsPanelStore.open).toBe(false));
      cleanup();

      await editTriage(true);
      await clickOutside();
      expect(skillsPanelStore.open).toBe(true);
      expect(screen.getByText('Discard your changes to triage?')).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(skillsPanelStore.open).toBe(false);
    });

    it('asks before closing or switching tab drops unsaved changes, and does it on Discard', async () => {
      await editTriage(true);
      await fireEvent.click(screen.getByRole('button', { name: 'Close skills' }));
      expect(skillsPanelStore.open).toBe(true);
      expect(screen.getByRole('dialog', { name: 'Skills' })).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      const scheduled = screen.getByRole('tab', { name: /Scheduled/ });
      await fireEvent.mouseDown(scheduled);
      await fireEvent.click(scheduled);
      expect(screen.getByRole('tab', { name: 'This thread' })).toHaveAttribute('aria-selected', 'true');
      await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(skillsPanelStore).toMatchObject({ tab: 'scheduled', edit: null });
      await waitFor(() => expect(screen.getByRole('tab', { name: /Scheduled/ })).toHaveAttribute('aria-selected', 'true'));
    });
  });
});
