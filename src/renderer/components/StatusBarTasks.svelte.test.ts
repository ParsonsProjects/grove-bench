import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/svelte';
import { messageStore } from '../stores/messages.svelte.js';

import StatusBarTasks from './StatusBarTasks.svelte';
import type { ThreadTask } from '../../shared/thread-items.js';

const SID = 's1';
const TASKS: ThreadTask[] = [
  { id: '0', content: 'Read the code', status: 'completed' },
  { id: '1', content: 'Fix the bug', activeForm: 'Fixing the bug', status: 'in_progress' },
  { id: '2', content: 'Write tests', status: 'pending' },
  { id: '3', content: 'Old idea', status: 'cancelled' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  messageStore.destroyAllSessions();
});

describe('StatusBarTasks', () => {
  it('lists every task with its state, and counts done ones leaving cancelled ones out', () => {
    render(StatusBarTasks, { sessionId: SID, tasks: TASKS, eventIndex: 7 });

    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Done: Read the code',
      'In progress: Fix the bug',
      'To do: Write tests',
      'Cancelled: Old idea',
    ]);
    expect(within(rows[0]).getByText('Read the code')).toHaveClass('line-through');
    expect(rows[1]).toHaveAttribute('title', 'Fixing the bug');
  });

  it('shows the message that last changed the list in the Thread tab', async () => {
    messageStore.setActiveTab(SID, 'terminal');
    const onjump = vi.fn();
    render(StatusBarTasks, { sessionId: SID, tasks: TASKS, eventIndex: 7, onjump });
    await fireEvent.click(screen.getByRole('button', { name: 'Show in thread' }));

    expect(onjump).toHaveBeenCalledOnce();
    expect(messageStore.getActiveTab(SID)).toBe('activity');
    expect(messageStore.pendingJumpBySession[SID]).toEqual({ eventIndex: 7, uuid: null, bookmarkId: '' });
  });

  it('offers no way to the thread before it knows the message', () => {
    render(StatusBarTasks, { sessionId: SID, tasks: TASKS, eventIndex: null });
    expect(screen.queryByRole('button', { name: 'Show in thread' })).toBeNull();
  });
});
