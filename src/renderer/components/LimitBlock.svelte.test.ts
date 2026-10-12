import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { settingsStore } from '../stores/settings.svelte.js';

import LimitBlock from './LimitBlock.svelte';

beforeEach(() => {
  settingsStore.current = { ...settingsStore.current, threadSpendLimitUsd: 5, turnToolCallLimit: 100 };
});

afterEach(() => {
  cleanup();
  vi.mocked(window.groveBench.respondToLimit).mockClear();
});

describe('LimitBlock', () => {
  it('says why the thread paused and continues for another round of the limit', async () => {
    render(LimitBlock, { sessionId: 's1', requestId: 'l1', limit: 'threadSpend', used: 5.2, reachedAt: 5, resolved: false });

    expect(screen.getByText('This thread has spent about $5.20, which reached your limit of $5.00.')).toBeInTheDocument();
    expect(screen.getByText(/the agent's own estimate/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue for another $5.00' }));
    expect(window.groveBench.respondToLimit).toHaveBeenCalledWith('s1', 'l1', 'continue');
  });

  it('stops the turn', async () => {
    render(LimitBlock, { sessionId: 's1', requestId: 'l2', limit: 'turnToolCalls', used: 100, reachedAt: 100, resolved: false });

    expect(screen.queryByText(/the agent's own estimate/)).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Stop the turn' }));
    expect(window.groveBench.respondToLimit).toHaveBeenCalledWith('s1', 'l2', 'stop');
  });

  it('shows how it ended, without buttons', () => {
    render(LimitBlock, { sessionId: 's1', requestId: 'l3', limit: 'turnToolCalls', used: 100, reachedAt: 100, resolved: true, decision: 'stop', timedOut: true });

    expect(screen.getByText('stopped: no answer within 30 minutes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
  });
});
