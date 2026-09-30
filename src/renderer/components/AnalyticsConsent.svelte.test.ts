import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import AnalyticsConsent from './AnalyticsConsent.svelte';
import { settingsStore } from '../stores/settings.svelte.js';
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
});
