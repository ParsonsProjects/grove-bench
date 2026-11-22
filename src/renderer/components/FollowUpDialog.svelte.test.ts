import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';

import FollowUpDialog from './FollowUpDialog.svelte';
import { followUpsStore } from '../stores/followUps.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';
import { FOLLOW_UP_LIMITS, type FollowUp } from '../../shared/follow-ups.js';

function fu(extra: Partial<FollowUp> = {}): FollowUp {
  return { id: 'x1', repoPath: '/repo-a', title: 'Add tests', details: '', createdAt: 0, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo-a', '/repo-b'];
  followUpsStore.list = [];
  followUpsStore.ready = true;
});

afterEach(() => {
  cleanup();
  followUpsStore.closeAdd();
  store.repos = [];
  followUpsStore.list = [];
});

async function fill(title: string, details = '') {
  await fireEvent.input(screen.getByLabelText('What needs doing'), { target: { value: title } });
  if (details) await fireEvent.input(screen.getByLabelText(/^Details/), { target: { value: details } });
}

describe('FollowUpDialog', () => {
  it('shows nothing until it is opened', () => {
    render(FollowUpDialog);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds a follow-up to the project it was opened for, and closes', async () => {
    mockGroveBench.addFollowUp.mockResolvedValueOnce({ followUp: fu({ repoPath: '/repo-b' }), existing: false });
    followUpsStore.openAdd('/repo-b');
    render(FollowUpDialog);
    expect(screen.getByRole('dialog', { name: 'New follow-up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('repo-b');
    expect(screen.getByRole('button', { name: 'Add follow-up' })).toBeDisabled();

    await fill('Add tests', 'For the refresh path.');
    await fireEvent.click(screen.getByRole('button', { name: 'Add follow-up' }));
    await waitFor(() => expect(followUpsStore.addingIn).toBeNull());
    expect(mockGroveBench.addFollowUp).toHaveBeenCalledWith('/repo-b', 'Add tests', 'For the refresh path.');
  });

  it('keeps what was typed when the project list changes while it is open', async () => {
    followUpsStore.openAdd('/repo-b');
    render(FollowUpDialog);
    await fill('Add tests', 'For the refresh path.');
    store.repos = [...store.repos, '/repo-c'];
    await waitFor(() => expect(screen.getByRole('button', { name: 'Project' })).toBeInTheDocument());
    expect(screen.getByLabelText('What needs doing')).toHaveValue('Add tests');
    expect(screen.getByLabelText(/^Details/)).toHaveValue('For the refresh path.');
  });

  it('says a project is needed when there is none', () => {
    store.repos = [];
    followUpsStore.openAdd();
    render(FollowUpDialog);
    expect(screen.getByRole('status')).toHaveTextContent('Add a project first');
    expect(screen.getByRole('button', { name: 'Add follow-up' })).toBeDisabled();
  });

  it('starts in the first project when opened for none', () => {
    followUpsStore.openAdd();
    render(FollowUpDialog);
    expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('repo-a');
  });

  it('says so when the project already has an open one with that title, and stays open', async () => {
    mockGroveBench.addFollowUp.mockResolvedValueOnce({ followUp: fu({ title: 'Add tests' }), existing: true });
    followUpsStore.openAdd('/repo-a');
    render(FollowUpDialog);
    await fill('add tests');
    await fireEvent.click(screen.getByRole('button', { name: 'Add follow-up' }));
    expect(await screen.findByText('repo-a already has an open follow-up called "Add tests".')).toBeInTheDocument();
    expect(followUpsStore.addingIn).not.toBeNull();
  });

  it("doesn't send one past the project's limit, and says what to do", async () => {
    followUpsStore.list = Array.from({ length: FOLLOW_UP_LIMITS.openPerProject }, (_, i) => fu({ id: `f${i}`, title: `T${i}` }));
    followUpsStore.openAdd('/repo-a');
    render(FollowUpDialog);
    await fill('One more');
    await fireEvent.click(screen.getByRole('button', { name: 'Add follow-up' }));
    expect(screen.getByRole('status')).toHaveTextContent(`already has ${FOLLOW_UP_LIMITS.openPerProject} open follow-ups`);
    expect(mockGroveBench.addFollowUp).not.toHaveBeenCalled();
  });

  it("shows why it couldn't be saved", async () => {
    mockGroveBench.addFollowUp.mockRejectedValueOnce(new Error("Error invoking remote method 'followUps:add': Error: Disk full"));
    followUpsStore.openAdd('/repo-a');
    render(FollowUpDialog);
    await fill('Add tests');
    await fireEvent.click(screen.getByRole('button', { name: 'Add follow-up' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Disk full');
  });

  it('adds with Ctrl+Enter from the details, and Cancel closes it', async () => {
    mockGroveBench.addFollowUp.mockResolvedValueOnce({ followUp: fu(), existing: false });
    followUpsStore.openAdd('/repo-a');
    render(FollowUpDialog);
    await fill('Add tests', 'Somewhere');
    await fireEvent.keyDown(screen.getByLabelText(/^Details/), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(followUpsStore.addingIn).toBeNull());

    followUpsStore.openAdd('/repo-a');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByLabelText('What needs doing')).toHaveValue('');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(followUpsStore.addingIn).toBeNull();
  });
});
