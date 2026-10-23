import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { threadItemsStore } from '../stores/threadItems.svelte.js';

import StatusBarThreadItems from './StatusBarThreadItems.svelte';
import type { ThreadItems } from '../../shared/thread-items.js';

const ACTIVE = 's-active';
const HIDDEN = 's-hidden';

const withTasks = (status: 'pending' | 'completed'): ThreadItems => ({
  tasks: [{ id: '0', content: 'Ship it', status }],
  tasksEventIndex: 1,
  files: [{ kind: 'made', made: { path: 'a.pdf', kind: 'pdf', size: 1 }, eventIndex: 2 }],
});

beforeEach(() => {
  store.activeSessionId = ACTIVE;
  mockGroveBench.getThreadItems.mockReset();
  mockGroveBench.getThreadItems.mockResolvedValue(withTasks('pending'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  store.activeSessionId = null;
  threadItemsStore.destroy(ACTIVE);
  threadItemsStore.destroy(HIDDEN);
  messageStore.destroyAllSessions();
});

describe('StatusBarThreadItems', () => {
  it('loads the open thread only', async () => {
    render(StatusBarThreadItems, { sessionId: ACTIVE });
    render(StatusBarThreadItems, { sessionId: HIDDEN });
    expect(await screen.findByRole('button', { name: /Tasks 0\/1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Files 1/ })).toBeInTheDocument();
    expect(mockGroveBench.getThreadItems).toHaveBeenCalledTimes(1);
    expect(mockGroveBench.getThreadItems).toHaveBeenCalledWith(ACTIVE);
  });

  it('keeps its room in a narrow bar while a task is still to do', async () => {
    const { container } = render(StatusBarThreadItems, { sessionId: ACTIVE });
    await screen.findByRole('button', { name: /Tasks/ });
    expect(container.firstElementChild).toHaveClass('flex');
    expect(container.firstElementChild).not.toHaveClass('hidden');
  });

  it('gives it up once every task is done', async () => {
    mockGroveBench.getThreadItems.mockResolvedValue(withTasks('completed'));
    const { container } = render(StatusBarThreadItems, { sessionId: ACTIVE });
    await screen.findByRole('button', { name: /Tasks 1\/1/ });
    expect(container.firstElementChild).toHaveClass('hidden', '@2xl:flex');
  });
});
