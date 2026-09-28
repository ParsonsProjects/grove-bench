import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';

import StatusBar from './StatusBar.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { CONTROL_IDS } from '../../shared/types.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  store.activeSessionId = null;
});

describe('StatusBar control shortcuts', () => {
  it.each([
    ['m', CONTROL_IDS.permissionMode],
    ['t', CONTROL_IDS.thinking],
    ['e', CONTROL_IDS.effort],
  ])('Alt+%s only changes the visible conversation', (key, controlId) => {
    const cycle = vi.spyOn(messageStore, 'cycleControl').mockImplementation(() => {});
    store.activeSessionId = 'a';
    // Every live conversation's status bar stays mounted, hidden ones included
    render(StatusBar, { props: { sessionId: 'a' } });
    render(StatusBar, { props: { sessionId: 'b' } });

    window.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true }));

    expect(cycle.mock.calls).toEqual([['a', controlId]]);
  });
});
