import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import AnalyticsConsent from './AnalyticsConsent.svelte';
import { settingsStore } from '../stores/settings.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import type { GroveBenchSettings } from '../../shared/types.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockGroveBench.saveSettings.mockResolvedValue(undefined);
  settingsStore.current = { theme: 'system', analyticsEnabled: false, analyticsPrompted: false } as GroveBenchSettings;
  // An edit left in the Settings draft after closing it with Escape.
  settingsStore.draft = { ...settingsStore.current, theme: 'dark' };
});

afterEach(() => cleanup());

describe('AnalyticsConsent', () => {
  it('saves the answer without an abandoned Settings edit', async () => {
    render(AnalyticsConsent, { visible: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(mockGroveBench.saveSettings).toHaveBeenCalledTimes(1));
    const saved = mockGroveBench.saveSettings.mock.calls[0][0] as GroveBenchSettings;
    expect(saved).toMatchObject({ analyticsEnabled: true, analyticsPrompted: true, theme: 'system' });
  });

  it('records a decline', async () => {
    render(AnalyticsConsent, { visible: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    await waitFor(() => expect(mockGroveBench.saveSettings).toHaveBeenCalledTimes(1));
    expect(mockGroveBench.saveSettings.mock.calls[0][0]).toMatchObject({ analyticsEnabled: false, analyticsPrompted: true, theme: 'system' });
  });

  it('closes even when saving fails, and says it will ask again', async () => {
    mockGroveBench.saveSettings.mockRejectedValueOnce(new Error("Error invoking remote method 'settings:save': Error: disk full"));
    render(AnalyticsConsent, { visible: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
    await waitFor(() => expect(store.error).toBe("Couldn't save your usage data choice (disk full). You'll be asked again next time."));
    store.clearError();
  });

  it('is a row in the layout, not an overlay that covers other buttons', () => {
    render(AnalyticsConsent, { visible: true });
    const banner = screen.getByRole('region', { name: 'Usage data' });
    expect(banner.className).not.toMatch(/\bfixed\b|\bz-/);
    expect(banner).toHaveTextContent('Settings → Privacy (Hedges)');
  });
});
