import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';

import UpdateSettings from './UpdateSettings.svelte';
import { settingsStore } from '../stores/settings.svelte.js';
import type { UpdateState, UpdateStatus } from '../../shared/types.js';

type Mock = ReturnType<typeof vi.fn>;
const groveBench = () => (window as any).groveBench as {
  onUpdateStatus: Mock;
  getUpdateState: Mock;
  checkForUpdate: Mock;
  openExternal: Mock;
};

let emit: (status: UpdateStatus) => void;

function startWith(state: Partial<UpdateState>) {
  groveBench().getUpdateState.mockResolvedValue({ currentVersion: '1.1.0', enabled: true, status: null, ...state });
}

beforeEach(() => {
  for (const fn of Object.values(groveBench())) fn.mockClear?.();
  groveBench().onUpdateStatus.mockImplementation((cb: (s: UpdateStatus) => void) => {
    emit = cb;
    return () => {};
  });
  startWith({});
  settingsStore.draft.autoDownloadUpdates = true;
});

afterEach(() => {
  cleanup();
});

describe('UpdateSettings', () => {
  it('shows the running version and links to all releases', async () => {
    render(UpdateSettings);
    expect(await screen.findByText(/Version 1\.1\.0\./)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'All releases' }));
    expect(groveBench().openExternal).toHaveBeenCalledWith('https://github.com/ParsonsProjects/grove-bench/releases');
  });

  it('checks on request and says what it found', async () => {
    groveBench().checkForUpdate.mockResolvedValue({ state: 'not-available', manual: true });
    render(UpdateSettings);
    await fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(groveBench().checkForUpdate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("You're up to date.")).toBeInTheDocument();
  });

  it('follows live status updates', async () => {
    render(UpdateSettings);
    await screen.findByRole('button', { name: 'Check for updates' });
    emit({ state: 'downloading', info: { version: '1.2.0' }, percent: 12.6, manual: false });
    expect(await screen.findByText('Downloading version 1.2.0 (13%).')).toBeInTheDocument();
    emit({ state: 'error', message: 'disk full', during: 'download', manual: false });
    expect(await screen.findByText('The download failed: disk full')).toBeInTheDocument();
  });

  it('explains that dev builds do not check', async () => {
    startWith({ enabled: false });
    render(UpdateSettings);
    expect(await screen.findByText('Updates are only checked in the installed app.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();
  });

  it('binds the automatic download option to the settings draft', async () => {
    render(UpdateSettings);
    const toggle = await screen.findByRole('checkbox');
    expect(toggle).toBeChecked();
    await fireEvent.click(toggle);
    expect(settingsStore.draft.autoDownloadUpdates).toBe(false);
  });
});
