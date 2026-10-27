import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import AddSkillDialog from './AddSkillDialog.svelte';
import { store } from '../stores/sessions.svelte.js';

beforeEach(() => {
  vi.clearAllMocks();
  store.sessions = [{ id: 't1', branch: 'b', repoPath: '/repo', status: 'running', createdAt: 0 }] as typeof store.sessions;
});

afterEach(() => {
  cleanup();
  store.sessions = [];
});

const props = () => ({ sessionId: 't1', onclose: vi.fn(), oncreated: vi.fn(), onaskagent: vi.fn() });

describe('AddSkillDialog', () => {
  it('holds back names the Agent Skills format rejects, saying why', async () => {
    render(AddSkillDialog, props());
    await fireEvent.input(screen.getByLabelText('Description'), { target: { value: 'Draft notes' } });
    await fireEvent.input(screen.getByLabelText('Instructions'), { target: { value: 'Do it' } });
    for (const bad of ['trailing-', 'two--dashes', 'Upper']) {
      await fireEvent.input(screen.getByLabelText('Name'), { target: { value: bad } });
      expect(screen.getByText(/Use lowercase letters, digits and single hyphens/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create skill' })).toBeDisabled();
    }
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'release-notes' } });
    expect(screen.getByRole('button', { name: 'Create skill' })).toBeEnabled();
  });

  it("shows main's reason without Electron's wrapper", async () => {
    mockGroveBench.addSkill.mockRejectedValueOnce(new Error('Error invoking remote method \'skills:add\': Error: A project skill named "notes" already exists'));
    render(AddSkillDialog, props());
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'notes' } });
    await fireEvent.input(screen.getByLabelText('Description'), { target: { value: 'Draft notes' } });
    await fireEvent.input(screen.getByLabelText('Instructions'), { target: { value: 'Do it' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create skill' }));
    await waitFor(() => expect(screen.getByText('A project skill named "notes" already exists')).toBeInTheDocument());
  });

  it('names the Scope switch by its label', () => {
    render(AddSkillDialog, props());
    expect(screen.getByRole('radiogroup', { name: 'Scope' })).toBeInTheDocument();
  });
});
