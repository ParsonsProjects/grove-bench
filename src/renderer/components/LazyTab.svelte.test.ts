import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

import LazyTab from './LazyTab.svelte';

afterEach(() => cleanup());

/** What the tab shows once its code is in: here, the loaded value. */
const children = createRawSnippet((loaded: () => unknown) => ({ render: () => `<p>${String(loaded())}</p>` }));

/** The errors handed to the app's handler for uncaught ones, while `run` runs.
 *  (With a listener on, as the app has one, Vitest doesn't count them as its
 *  own uncaught errors.) */
async function reported(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onError = (e: ErrorEvent) => seen.push(e.error);
  window.addEventListener('error', onError);
  try { await run(); } finally { window.removeEventListener('error', onError); }
  return seen;
}

describe('LazyTab', () => {
  it('shows the tab once its code is in', async () => {
    render(LazyTab, { load: () => Promise.resolve('the Changes panel'), tab: 'Changes', children });
    expect(await screen.findByText('the Changes panel')).toBeInTheDocument();
  });

  it("says it couldn't load, to restart, and reports it as an error nothing caught", async () => {
    const error = new Error('Failed to fetch dynamically imported module: changes.js');
    const errors = await reported(async () => {
      render(LazyTab, { load: () => Promise.reject(error), tab: 'Changes', children });
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /^Couldn't load the Changes tab \(Failed to fetch dynamically imported module: changes\.js\)\. Restart Grove Bench to try again; if that doesn't help, reinstall it\.$/,
      );
    });
    expect(errors).toEqual([error]);
    // Asking again wouldn't fetch it (Chromium keeps a failed import).
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names an error that has no message', async () => {
    await reported(async () => {
      render(LazyTab, { load: () => Promise.reject(new TypeError()), tab: 'Terminal', children });
      expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't load the Terminal tab \(TypeError\)\./);
    });
  });
});
