import { describe, it, expect, afterEach } from 'vitest';
import { backgroundAgentRunning, threadWorking } from './thread-working.js';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';

const startAgent = (id: string) =>
  backgroundTaskStore.start(id, { type: 'task_started', taskId: 'a1', description: 'Explore', taskType: 'local_agent' });

afterEach(() => {
  store.sessions = [];
  messageStore.isRunning = {};
  backgroundTaskStore.destroy('t1');
});

describe('backgroundAgentRunning', () => {
  it('counts a background agent only while the thread is running', () => {
    startAgent('t1');
    expect(backgroundAgentRunning({ id: 't1', status: 'running' })).toBe(true);
    // Closed, asleep or failed: its agent, and the background agents with it, are gone.
    for (const status of ['stopped', 'sleeping', 'error', 'starting', 'installing'] as const) {
      expect(backgroundAgentRunning({ id: 't1', status }), status).toBe(false);
    }
  });

  it('is false with no agent running', () => {
    expect(backgroundAgentRunning({ id: 't1', status: 'running' })).toBe(false);
  });
});

describe('threadWorking', () => {
  it('is true mid-turn, even for a thread not in the list', () => {
    messageStore.setIsRunning('t1', true);
    expect(threadWorking('t1')).toBe(true);
  });

  it('is true with a background agent running, and only while the thread is running', () => {
    store.sessions = [{ id: 't1', branch: 'a', repoPath: '/r', status: 'running' }] as any;
    expect(threadWorking('t1')).toBe(false);
    startAgent('t1');
    expect(threadWorking('t1')).toBe(true);
    store.sessions = [{ id: 't1', branch: 'a', repoPath: '/r', status: 'stopped' }] as any;
    expect(threadWorking('t1')).toBe(false);
  });
});
