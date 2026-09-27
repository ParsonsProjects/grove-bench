import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { store } from './sessions.svelte.js';
import { prerequisitesStore } from './prerequisites.svelte.js';
import type { PrerequisiteStatus } from '../../shared/types.js';

const signedOut: PrerequisiteStatus = {
  git: { available: true, meetsMinimum: true },
  agent: { available: true, authenticated: false },
};
const signedIn: PrerequisiteStatus = {
  git: { available: true, meetsMinimum: true },
  agent: { available: true, authenticated: true },
};

beforeEach(() => {
  store.prerequisites = null;
  vi.clearAllMocks();
  mockGroveBench.getCachedPrerequisites.mockResolvedValue(null);
  mockGroveBench.checkPrerequisites.mockResolvedValue(signedIn);
  mockGroveBench.checkGhPrerequisite.mockResolvedValue({ available: false });
});

describe('prerequisitesStore', () => {
  it('shows the cached result first, then replaces it with a fresh check', async () => {
    mockGroveBench.getCachedPrerequisites.mockResolvedValue(signedOut);
    let resolveCheck!: (s: PrerequisiteStatus) => void;
    mockGroveBench.checkPrerequisites.mockReturnValue(new Promise((r) => { resolveCheck = r; }));

    const done = prerequisitesStore.init();
    await vi.waitFor(() => expect(store.prerequisites?.agent.authenticated).toBe(false));
    expect(prerequisitesStore.checking).toBe(true);

    resolveCheck(signedIn);
    await done;
    expect(store.prerequisites?.agent.authenticated).toBe(true);
    expect(prerequisitesStore.checking).toBe(false);
  });

  it('shares one check between concurrent callers', async () => {
    await Promise.all([prerequisitesStore.refresh(), prerequisitesStore.refresh()]);
    expect(mockGroveBench.checkPrerequisites).toHaveBeenCalledTimes(1);
  });

  it('keeps the last result and stops checking when the check fails', async () => {
    store.prerequisites = signedOut;
    mockGroveBench.checkPrerequisites.mockRejectedValue(new Error('IPC down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await prerequisitesStore.refresh();

    expect(store.prerequisites).toEqual(signedOut);
    expect(prerequisitesStore.checking).toBe(false);
    consoleError.mockRestore();
  });

  it('keeps the gh status, which the core check does not return', async () => {
    store.prerequisites = { ...signedOut, gh: { available: true, authenticated: true } };
    await prerequisitesStore.refresh();
    expect(store.prerequisites?.gh).toEqual({ available: true, authenticated: true });
  });

  it('applies the status returned after saving a key', async () => {
    await prerequisitesStore.saveApiKey('sk-test');
    expect(mockGroveBench.setApiKey).toHaveBeenCalledWith('sk-test');
    expect(store.prerequisites?.agent.apiKey?.saved).toBe(true);
  });

  it('strips the Electron IPC wrapper from save errors', async () => {
    mockGroveBench.setApiKey.mockRejectedValueOnce(
      new Error("Error invoking remote method 'credentials:setApiKey': Error: An API key cannot contain spaces."),
    );
    await expect(prerequisitesStore.saveApiKey('bad key')).rejects.toThrow(/^An API key cannot contain spaces\.$/);
  });
});
