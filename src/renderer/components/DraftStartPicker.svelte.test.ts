import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import DraftStartPicker from './DraftStartPicker.svelte';
import { draftStore } from '../stores/draft.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import type { OpenPrSummary } from '../../shared/types.js';

const pr = (over: Partial<OpenPrSummary>): OpenPrSummary => ({
  number: 1, title: 'A PR', headRefName: 'feat/a', author: 'sam', isDraft: false, isCrossRepository: false, url: '', ...over,
});

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  vi.clearAllMocks();
  store.repos = ['/repo/one'];
  store.sessions = [{ id: 'old', branch: 'taken', repoPath: '/repo/one', status: 'running' }];
  store.activeSessionId = null;
  agentsStore.list = [{ id: 'claude-code', displayName: 'Claude Agent', capabilities: { permissionModes: true }, isDefault: true }];
  agentsStore.loaded = true;
  mockGroveBench.getAdapterControls.mockResolvedValue([
    { id: 'permissionMode', label: 'Mode', default: 'default', options: [{ value: 'default', label: 'Ask' }, { value: 'plan', label: 'Plan' }] },
  ]);
  mockGroveBench.listBranches.mockResolvedValue(['main', 'feat/a', 'fix/b', 'taken']);
  mockGroveBench.listOpenPrs.mockResolvedValue([
    pr({ number: 7, title: 'Add login', headRefName: 'feat/a' }),
    pr({ number: 8, title: 'From a fork', headRefName: 'patch-1', isCrossRepository: true }),
  ]);
  draftStore.discard();
  draftStore.open('/repo/one');
  await settle();
  store.activeSessionId = null;
});

afterEach(() => {
  cleanup();
  draftStore.discard();
  store.repos = [];
  store.sessions = [];
  agentsStore.list = [];
  agentsStore.loaded = false;
});

async function openExisting() {
  render(DraftStartPicker, { onclose: vi.fn() });
  await fireEvent.click(screen.getByRole('button', { name: 'Branch or PR' }));
}

describe('DraftStartPicker', () => {
  it('lists open PRs and the branches not already covered or in use', async () => {
    await openExisting();
    expect(await screen.findByRole('button', { name: /#7 Add login/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /From a fork/ })).not.toBeInTheDocument();
    expect(screen.getByText(/1 pull request from a fork is/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'fix/b' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'feat/a' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'taken' })).not.toBeInTheDocument();
  });

  it('picks a PR, which starts in Plan mode', async () => {
    const onclose = vi.fn();
    render(DraftStartPicker, { onclose });
    await fireEvent.click(screen.getByRole('button', { name: 'Branch or PR' }));
    await fireEvent.click(await screen.findByRole('button', { name: /#7 Add login/ }));
    expect(draftStore.draft?.start).toEqual({ kind: 'existing', branch: 'feat/a', pr: { number: 7, title: 'Add login' } });
    expect(draftStore.controlValue('permissionMode')).toBe('plan');
    expect(onclose).toHaveBeenCalled();
  });

  it('filters by search', async () => {
    await openExisting();
    await screen.findByRole('button', { name: /#7 Add login/ });
    await fireEvent.input(screen.getByLabelText('Search pull requests and branches'), { target: { value: 'fix' } });
    expect(screen.queryByRole('button', { name: /#7 Add login/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'fix/b' })).toBeInTheDocument();
  });

  it('keeps listing branches when PRs cannot be listed', async () => {
    mockGroveBench.listOpenPrs.mockRejectedValue(new Error('gh not signed in'));
    await openExisting();
    expect(await screen.findByText(/Pull requests could not be listed/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'feat/a' })).toBeInTheDocument();
  });

  it('sets a branch name and base for a new branch', async () => {
    render(DraftStartPicker, { onclose: vi.fn() });
    await fireEvent.input(screen.getByLabelText('Branch name'), { target: { value: 'feat/API-12' } });
    await fireEvent.input(screen.getByLabelText('Base branch'), { target: { value: 'develop' } });
    expect(draftStore.draft?.start).toEqual({ kind: 'new', branchName: 'feat/API-12', baseBranch: 'develop' });
  });

  it('switches to the project folder', async () => {
    render(DraftStartPicker, { onclose: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Project folder' }));
    await waitFor(() => expect(draftStore.draft?.start).toEqual({ kind: 'folder' }));
  });
});
