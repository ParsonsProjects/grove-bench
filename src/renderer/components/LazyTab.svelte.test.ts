import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import LazyTab from './LazyTab.svelte';
import { lazyComponent } from '../lib/lazy-component.js';
import type { AppErrorReport } from '../../shared/types.js';

afterEach(() => {
  cleanup();
  mockGroveBench.reportError.mockClear();
});

/** What the tab shows once its code is in: here, the loaded value. */
const children = createRawSnippet((loaded: () => unknown) => ({ render: () => `<p>${String(loaded())}</p>` }));

describe('LazyTab', () => {
  it('shows the tab once its code is in', async () => {
    render(LazyTab, { load: () => Promise.resolve('the Changes panel'), tab: 'Changes', sessionId: 's1', children });
    expect(await screen.findByText('the Changes panel')).toBeInTheDocument();
  });

  it("says why it couldn't load, logs it, and loads it again on Retry", async () => {
    const load = vi.fn<() => Promise<{ default: string }>>()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module: changes.js'))
      .mockResolvedValueOnce({ default: 'the Changes panel' });
    render(LazyTab, { load: lazyComponent(load), tab: 'Changes', sessionId: 's1', children });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load the Changes tab: Failed to fetch dynamically imported module: changes.js. Retry, or restart Grove Bench if it keeps failing.",
    );
    const [report] = mockGroveBench.reportError.mock.calls[0] as [AppErrorReport];
    expect(report).toMatchObject({ source: 'renderer', kind: 'lazy-load', sessionId: 's1' });
    expect(report.message).toContain('changes.js');

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('the Changes panel')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
