import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { backgroundAgentStore } from './background-agent.svelte.js';
import { agentsStore } from './agents.svelte.js';
import { store } from './sessions.svelte.js';

beforeEach(() => {
  agentsStore.list = [
    { id: 'claude-code', displayName: 'Claude Agent', capabilities: {}, isDefault: true },
    { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} },
  ];
  agentsStore.loaded = true;
  store.sessions = [
    { id: 'here', branch: 'a', repoPath: '/repo', status: 'stopped', agentType: 'gemini-cli' },
    { id: 'gone', branch: 'b', repoPath: '/repo', status: 'stopped', agentType: 'my-agent' },
  ];
});

afterEach(() => {
  backgroundAgentStore.reset();
  agentsStore.list = [];
  agentsStore.loaded = false;
  store.sessions = [];
});

/** Let substituteFor reach its question. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('backgroundAgentStore', () => {
  it("doesn't ask while the thread's own agent is there", async () => {
    expect(await backgroundAgentStore.substituteFor('here', 'write a commit message')).toBeUndefined();
    expect(backgroundAgentStore.ask).toBeNull();
  });

  it('asks which agent to use when it is gone, and keeps the answer for the thread', async () => {
    const answer = backgroundAgentStore.substituteFor('gone', 'write a commit message');
    await settle();
    expect(backgroundAgentStore.ask).toMatchObject({ sessionId: 'gone', agentId: 'my-agent', task: 'write a commit message' });
    backgroundAgentStore.answer('claude-code');
    expect(await answer).toBe('claude-code');
    expect(backgroundAgentStore.ask).toBeNull();
    // Asked once per thread.
    expect(await backgroundAgentStore.substituteFor('gone', 'write a goal')).toBe('claude-code');
  });

  it('runs nothing when the user cancels, and asks again next time', async () => {
    const answer = backgroundAgentStore.substituteFor('gone', 'write a goal');
    await settle();
    backgroundAgentStore.answer(null);
    expect(await answer).toBeNull();
    void backgroundAgentStore.substituteFor('gone', 'write a goal');
    await settle();
    expect(backgroundAgentStore.ask).not.toBeNull();
  });

  it('cancels a question still open when another one comes', async () => {
    const first = backgroundAgentStore.substituteFor('gone', 'write a goal');
    await settle();
    const second = backgroundAgentStore.substituteFor('gone', 'write a commit message');
    await settle();
    expect(await first).toBeNull();
    backgroundAgentStore.answer('gemini-cli');
    expect(await second).toBe('gemini-cli');
  });
});
