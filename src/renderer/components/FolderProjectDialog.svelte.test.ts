import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import FolderProjectDialog from './FolderProjectDialog.svelte';
import { store } from '../stores/sessions.svelte.js';

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = [];
  store.pendingFolder = null;
});

afterEach(() => {
  cleanup();
  store.pendingFolder = null;
  store.setFolderProject('C:\\notes', false);
  store.repos = [];
});

describe('FolderProjectDialog', () => {
  it('shows nothing until a folder without git is picked', () => {
    render(FolderProjectDialog);
    expect(screen.queryByText("This folder isn't a git repository")).not.toBeInTheDocument();
  });

  it('sets git up and adds the folder as a git project', async () => {
    store.pendingFolder = { path: 'C:\\notes', gitAvailable: true };
    render(FolderProjectDialog);

    await fireEvent.click(await screen.findByRole('button', { name: 'Set up git' }));

    expect(mockGroveBench.initGitRepo).toHaveBeenCalledWith('C:\\notes');
    await waitFor(() => expect(store.repos).toEqual(['C:\\notes']));
    expect(store.isFolderProject('C:\\notes')).toBe(false);
    expect(store.pendingFolder).toBeNull();
  });

  it('keeps the dialog open with the reason when git setup fails', async () => {
    mockGroveBench.initGitRepo.mockResolvedValueOnce({ ok: false, error: 'Git needs your name and email for the first commit.' });
    store.pendingFolder = { path: 'C:\\notes', gitAvailable: true };
    render(FolderProjectDialog);

    await fireEvent.click(await screen.findByRole('button', { name: 'Set up git' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Git needs your name and email for the first commit.');
    expect(store.repos).toEqual([]);
    expect(store.pendingFolder).not.toBeNull();
  });

  it('adds the folder as it is when used without git', async () => {
    store.pendingFolder = { path: 'C:\\notes', gitAvailable: true };
    render(FolderProjectDialog);

    await fireEvent.click(await screen.findByRole('button', { name: 'Use without git' }));

    expect(mockGroveBench.initGitRepo).not.toHaveBeenCalled();
    expect(store.repos).toEqual(['C:\\notes']);
    expect(store.isFolderProject('C:\\notes')).toBe(true);
    expect(store.pendingFolder).toBeNull();
  });

  it('offers a download instead of setup when git is not installed', async () => {
    store.pendingFolder = { path: 'C:\\notes', gitAvailable: false };
    render(FolderProjectDialog);

    expect(await screen.findByText("Git isn't installed, so it can't be set up here yet.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up git' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Download Git' }));
    expect(mockGroveBench.openExternal).toHaveBeenCalledWith('https://git-scm.com/downloads');
    expect(screen.getByRole('button', { name: 'Use without git' })).toBeInTheDocument();
  });

  it('adds nothing when cancelled', async () => {
    store.pendingFolder = { path: 'C:\\notes', gitAvailable: true };
    render(FolderProjectDialog);

    await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(store.pendingFolder).toBeNull();
    expect(store.repos).toEqual([]);
  });
});
