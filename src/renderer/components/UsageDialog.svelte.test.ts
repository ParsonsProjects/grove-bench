import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { usageReportStore } from '../stores/usageReport.svelte.js';
import UsageDialog from './UsageDialog.svelte';

afterEach(() => {
  cleanup();
  usageReportStore.open = false;
});

describe('UsageDialog', () => {
  it('shows every thread\'s usage while open, and closes on Escape', async () => {
    usageReportStore.open = true;
    render(UsageDialog);
    const dialog = await screen.findByRole('dialog', { name: 'Usage' });
    expect(dialog).toContainElement(await screen.findByTestId('usage-report'));
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(usageReportStore.open).toBe(false));
  });
});
