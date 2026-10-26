import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import SkillEditor from './SkillEditor.svelte';
import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
import { store } from '../stores/sessions.svelte.js';

const listed = '/wt/.claude/skills/triage/SKILL.md';
const triage = { name: 'triage', description: 'Sort new issues', source: 'project' as const, path: listed };
const text = '---\nname: triage\ndescription: Sort new issues\n---\n\nLabel each issue.\n';

function open() {
  skillsPanelStore.editSkill('t1', triage);
  render(SkillEditor);
}

const textbox = () => screen.findByRole('textbox', { name: 'SKILL.md for triage' });
const saveButton = () => screen.getByRole('button', { name: /^Save/ });

beforeEach(() => {
  vi.clearAllMocks();
  store.sessions = [{ id: 't1', branch: 'b', repoPath: '/repo', status: 'running', agentType: 'claude-code', createdAt: 0 }] as typeof store.sessions;
  mockGroveBench.readSkill.mockResolvedValue({ path: listed, content: text });
});

afterEach(() => {
  cleanup();
  skillsPanelStore.close();
  store.sessions = [];
});

describe('SkillEditor', () => {
  it("shows the skill's whole SKILL.md, with Save off until it changes", async () => {
    open();
    expect(await textbox()).toHaveValue(text);
    expect(mockGroveBench.readSkill).toHaveBeenCalledWith('t1', '/repo', listed);
    expect(screen.getByText(listed)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('saves the text against what it read, in its own thread, then goes back to the list', async () => {
    mockGroveBench.saveSkill.mockResolvedValue({ ...triage, description: 'Sort and label new issues' });
    open();
    // Another thread open meanwhile doesn't change where it saves.
    store.activeSessionId = 't2';
    const edited = text.replace('Sort new issues', 'Sort and label new issues');
    await fireEvent.input(await textbox(), { target: { value: edited } });
    await fireEvent.click(saveButton());
    await waitFor(() => expect(skillsPanelStore.edit).toBeNull());
    expect(mockGroveBench.saveSkill).toHaveBeenCalledWith('t1', '/repo', listed, text, edited);
    store.activeSessionId = null;
  });

  it('saves on Ctrl+S from anywhere in the editor, whatever letter the layout puts on S', async () => {
    mockGroveBench.saveSkill.mockResolvedValue(triage);
    open();
    const box = await textbox();
    await fireEvent.input(box, { target: { value: `${text}More.\n` } });
    await fireEvent.keyDown(box, { key: 's', ctrlKey: true });
    await waitFor(() => expect(mockGroveBench.saveSkill).toHaveBeenCalledOnce());
    cleanup();

    open();
    await fireEvent.input(await textbox(), { target: { value: `${text}More.\n` } });
    // A Russian layout: the S key types ы.
    await fireEvent.keyDown(screen.getByRole('button', { name: /Open in editor/ }), { key: 'ы', code: 'KeyS', ctrlKey: true });
    await waitFor(() => expect(mockGroveBench.saveSkill).toHaveBeenCalledTimes(2));
  });

  it("can't be typed in while it saves, and doesn't save while it asks about discarding", async () => {
    let finish!: (skill: typeof triage) => void;
    mockGroveBench.saveSkill.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    open();
    const box = await textbox();
    await fireEvent.input(box, { target: { value: 'changed' } });
    await fireEvent.click(saveButton());
    expect(box).toHaveAttribute('readonly');
    finish(triage);
    await waitFor(() => expect(skillsPanelStore.edit).toBeNull());
    cleanup();

    open();
    await fireEvent.input(await textbox(), { target: { value: 'changed' } });
    skillsPanelStore.requestClose();
    await fireEvent.keyDown(await textbox(), { key: 's', ctrlKey: true });
    expect(mockGroveBench.saveSkill).toHaveBeenCalledOnce();
    expect(skillsPanelStore.open).toBe(true);
  });

  it("shows main's own words, without Electron's wrapper", async () => {
    mockGroveBench.saveSkill.mockRejectedValue(new Error("Error invoking remote method 'skills:save': Error: SKILL.md can't be empty"));
    open();
    await fireEvent.input(await textbox(), { target: { value: ' ' } });
    await fireEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/^SKILL\.md can't be empty$/);
  });

  it('keeps the text and says why when Save is refused, offering Reload only if the file changed', async () => {
    mockGroveBench.saveSkill.mockRejectedValue(new Error('Keep the name "triage": renaming a skill isn\'t supported here'));
    open();
    const renamed = text.replace('name: triage', 'name: sort');
    await fireEvent.input(await textbox(), { target: { value: renamed } });
    await fireEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep the name "triage"');
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    expect(await textbox()).toHaveValue(renamed);

    // The agent changed the file meanwhile: Reload reads it again.
    const agentEdit = text.replace('Label', 'Tag');
    mockGroveBench.saveSkill.mockRejectedValue(new Error("triage's SKILL.md changed after you opened it."));
    mockGroveBench.readSkill.mockResolvedValue({ path: listed, content: agentEdit });
    await fireEvent.click(saveButton());
    await fireEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    await waitFor(async () => expect(await textbox()).toHaveValue(agentEdit));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says when the file can\'t be read, with Reload to try again', async () => {
    mockGroveBench.readSkill.mockRejectedValueOnce(new Error('EBUSY'));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('EBUSY');
    await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await textbox()).toHaveValue(text);
  });

  it('asks before Cancel drops unsaved changes, and leaves at once without any', async () => {
    open();
    await textbox();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(skillsPanelStore.edit).toBeNull();
    cleanup();

    open();
    await fireEvent.input(await textbox(), { target: { value: 'changed' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Back to the skills' }));
    expect(screen.getByText('Discard your changes to triage?')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(skillsPanelStore.edit?.text).toBe('changed');
    // Back to the text, so typing or Ctrl+S carries on.
    expect(await textbox()).toHaveFocus();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(skillsPanelStore.edit).toBeNull();
  });

  it("says when Claude Agent reads the skill through a link Save updates, and opens the shared file elsewhere", async () => {
    const shared = '/wt/.agents/skills/triage/SKILL.md';
    mockGroveBench.readSkill.mockResolvedValue({ path: shared, content: text, linkPath: listed });
    open();
    await textbox();
    expect(screen.getByText(shared)).toBeInTheDocument();
    expect(screen.getByText(/which Save updates too/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /Open in editor/ }));
    expect(mockGroveBench.openSkillInEditor).toHaveBeenCalledWith('t1', '/repo', listed);
  });
});
