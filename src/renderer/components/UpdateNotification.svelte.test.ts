import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

import UpdateNotification from './UpdateNotification.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import type { UpdateState, UpdateStatus } from '../../shared/types.js';

type Mock = ReturnType<typeof vi.fn>;
const groveBench = () => (window as any).groveBench as {
  onUpdateStatus: Mock;
  getUpdateState: Mock;
  checkForUpdate: Mock;
  downloadUpdate: Mock;
  restartToUpdate: Mock;
  openExternal: Mock;
};

const INFO = { version: '1.2.0' };
let emit: (status: UpdateStatus) => void;

function startWith(status: UpdateStatus | null) {
  groveBench().getUpdateState.mockResolvedValue({ currentVersion: '1.1.0', enabled: true, status } satisfies UpdateState);
}

beforeEach(() => {
  for (const fn of Object.values(groveBench())) fn.mockClear?.();
  groveBench().onUpdateStatus.mockImplementation((cb: (s: UpdateStatus) => void) => {
    emit = cb;
    return () => {};
  });
  startWith(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  store.sessions = [];
  messageStore.setIsRunning('u1', false);
  messageStore.setIsRunning('u2', false);
});

describe('UpdateNotification', () => {
  it('shows nothing for background checks and downloads', async () => {
    render(UpdateNotification);
    emit({ state: 'checking', manual: false });
    emit({ state: 'downloading', info: INFO, percent: 40, manual: false });
    emit({ state: 'error', message: 'offline', during: 'check', manual: false });
    await tick();
    expect(document.body.textContent?.trim()).toBe('');

    // The same component does render once something is worth showing.
    emit({ state: 'error', message: 'offline', during: 'check', manual: true });
    await tick();
    expect(document.body.textContent?.trim()).toBe('Update failed, retry');
  });

  it('picks up an update found before the window loaded', async () => {
    startWith({ state: 'downloaded', info: INFO });
    render(UpdateNotification);
    expect(await screen.findByRole('button', { name: 'Restart to update' })).toBeInTheDocument();
  });

  it('offers a download when automatic download is off', async () => {
    render(UpdateNotification);
    emit({ state: 'available', info: INFO });
    await fireEvent.click(await screen.findByRole('button', { name: 'Update v1.2.0 available' }));
    expect(groveBench().downloadUpdate).toHaveBeenCalledTimes(1);

    emit({ state: 'downloading', info: INFO, percent: 42.4, manual: true });
    expect(await screen.findByText('Downloading v1.2.0 42%')).toBeInTheDocument();
  });

  it('restarts straight away when no conversation is working', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(UpdateNotification);
    emit({ state: 'downloaded', info: INFO });
    await fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(groveBench().restartToUpdate).toHaveBeenCalledTimes(1);
  });

  it('asks first when conversations are working, and stays put if cancelled', async () => {
    store.sessions = [
      { id: 'u1', branch: 'a', repoPath: '/r', status: 'running' },
      { id: 'u2', branch: 'b', repoPath: '/r', status: 'running' },
    ] as any;
    messageStore.setIsRunning('u1', true);
    messageStore.setIsRunning('u2', true);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(UpdateNotification);
    emit({ state: 'downloaded', info: INFO });
    await fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('2 conversations are still working'));
    expect(groveBench().restartToUpdate).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    await waitFor(() => expect(groveBench().restartToUpdate).toHaveBeenCalledTimes(1));
  });

  it("links to the ready version's release notes", async () => {
    render(UpdateNotification);
    emit({ state: 'downloaded', info: INFO });
    await fireEvent.click(await screen.findByRole('button', { name: "What's new" }));
    expect(groveBench().openExternal).toHaveBeenCalledWith('https://github.com/ParsonsProjects/grove-bench/releases/tag/v1.2.0');
  });

  it('shows a failed download with a retry', async () => {
    render(UpdateNotification);
    emit({ state: 'error', message: 'disk full', during: 'download', manual: false });
    const retry = await screen.findByRole('button', { name: 'Update failed, retry' });
    expect(retry).toHaveAttribute('title', 'disk full');
    await fireEvent.click(retry);
    expect(groveBench().checkForUpdate).toHaveBeenCalledTimes(1);
  });
});
