import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import SkillEditor from './SkillEditor.svelte';
import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';

const listed = '/wt/.claude/skills/triage/SKILL.md';
const triage = { name: 'triage', description: 'Sort new issues', source: 'project' as const, path: listed };
const text = '---\nname: triage\ndescription: Sort new issues\n---\n\nLabel each issue.\n';

function open(onsaved = vi.fn()) {
  skillsPanelStore.editSkill('t1', triage);
  render(SkillEditor, { repoPath: '/repo', onsaved });
  return onsaved;
}

const textbox = () => screen.findByRole('textbox', { name: 'SKILL.md for triage' });
const saveButton = () => screen.getByRole('button', { name: /^Save/ });

beforeEach(() => {
  vi.clearAllMocks();
  mockGroveBench.readSkill.mockResolvedValue({ path: listed, content: text });
});

afterEach(() => {
  cleanup();
  skillsPanelStore.close();
});

describe('SkillEditor', () => {
  it("shows the skill's whole SKILL.md, with Save off until it changes", async () => {
    open();
    expect(await textbox()).toHaveValue(text);
    expect(mockGroveBench.readSkill).toHaveBeenCalledWith('t1', '/repo', listed);
    expect(screen.getByText(listed)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('saves the text against what it read, then goes back to the list', async () => {
    const saved = { ...triage, description: 'Sort and label new issues' };
    mockGroveBench.saveSkill.mockResolvedValue(saved);
    const onsaved = open();
    const edited = text.replace('Sort new issues', 'Sort and label new issues');
    await fireEvent.input(await textbox(), { target: { value: edited } });
    await fireEvent.click(saveButton());
    await waitFor(() => expect(onsaved).toHaveBeenCalledWith(saved));
    expect(mockGroveBench.saveSkill).toHaveBeenCalledWith('t1', '/repo', listed, text, edited);
    expect(skillsPanelStore.edit).toBeNull();
  });

  it('saves on Ctrl+S', async () => {
    mockGroveBench.saveSkill.mockResolvedValue(triage);
    open();
    const box = await textbox();
    await fireEvent.input(box, { target: { value: `${text}More.\n` } });
    await fireEvent.keyDown(box, { key: 's', ctrlKey: true });
    await waitFor(() => expect(mockGroveBench.saveSkill).toHaveBeenCalledOnce());
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
