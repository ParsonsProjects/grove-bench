import { describe, it, expect, vi } from 'vitest';
import { followUpToolHandlers, followUpsServer, isAutoAllowedGroveTool } from './grove-tools.js';
import type { FollowUpOperations } from './types.js';
import type { FollowUp } from '../../shared/follow-ups.js';

const HOUR = 3_600_000;
const NOW = 100 * HOUR;

function followUp(extra: Partial<FollowUp> = {}): FollowUp {
  return { id: 'a1b2c3', repoPath: '/repo', title: 'Add tests', details: 'Cover refresh()', createdAt: NOW - 2 * HOUR, ...extra };
}

function fakeOps(overrides: Partial<FollowUpOperations> = {}): FollowUpOperations {
  return {
    add: vi.fn(() => ({ followUp: followUp(), existing: false })),
    list: vi.fn(() => [followUp()]),
    done: vi.fn(() => followUp({ doneAt: NOW })),
    ...overrides,
  };
}

const textOf = (res: { content: Array<{ type: string; text?: string }> }) => res.content.map((c) => c.text).join('');

describe('followUpToolHandlers', () => {
  it('adds one and says where the user finds it', async () => {
    const ops = fakeOps();
    const res = await followUpToolHandlers(ops).add({ title: 'Add tests', details: 'Cover refresh()' });
    expect(ops.add).toHaveBeenCalledWith({ title: 'Add tests', details: 'Cover refresh()' });
    expect(textOf(res)).toBe("Added follow-up a1b2c3: Add tests. The user can start a thread from it in Grove Bench's Follow-ups drawer.");
    expect(res.isError).toBeUndefined();
  });

  it('says when an open one with that title was already listed', async () => {
    const res = await followUpToolHandlers(fakeOps({ add: vi.fn(() => ({ followUp: followUp(), existing: true })) })).add({ title: 'Add tests', details: '' });
    expect(textOf(res)).toContain('already listed: a1b2c3');
  });

  it('lists each with its id, age, origin and details', async () => {
    const ops = fakeOps({ list: vi.fn(() => [
      followUp({ fromLabel: 'Fix login', fromBranch: 'claude/login', startedSessionIds: ['s2'] }),
      followUp({ id: 'ffffff', title: 'Old', details: '', createdAt: NOW - 3 * 24 * HOUR, doneAt: NOW - HOUR, doneNote: 'Removed it' }),
    ]) });
    const res = await followUpToolHandlers(ops, () => NOW).list({ includeDone: true });
    expect(ops.list).toHaveBeenCalledWith({ includeDone: true });
    expect(textOf(res)).toBe([
      '## a1b2c3: Add tests',
      'Added 2 hours ago in "Fix login" (branch claude/login).',
      'A thread was started from it once.',
      '',
      'Cover refresh()',
      '',
      '## ffffff: Old',
      'Added 3 days ago.',
      'Done 1 hour ago: Removed it',
    ].join('\n'));
  });

  it('says when there are none', async () => {
    const handlers = followUpToolHandlers(fakeOps({ list: vi.fn(() => []) }));
    expect(textOf(await handlers.list({}))).toBe('This project has no open follow-ups.');
    expect(textOf(await handlers.list({ includeDone: true }))).toBe('This project has no follow-ups.');
  });

  it('marks one done, passing the note through', async () => {
    const ops = fakeOps();
    const res = await followUpToolHandlers(ops).done({ id: 'a1b2c3', note: 'Added them' });
    expect(ops.done).toHaveBeenCalledWith('a1b2c3', 'Added them');
    expect(textOf(res)).toBe('Marked follow-up a1b2c3 done: Add tests');
  });

  it('turns a thrown error into a tool error the agent reads', async () => {
    const ops = fakeOps({ done: vi.fn(() => { throw new Error('There is no follow-up zzz in this project.'); }) });
    const res = await followUpToolHandlers(ops).done({ id: 'zzz' });
    expect(res).toEqual({ content: [{ type: 'text', text: 'There is no follow-up zzz in this project.' }], isError: true });
  });
});

describe('followUpsServer', () => {
  it('is served as grove-followups with instructions, and every tool runs without a prompt', () => {
    const server = followUpsServer(fakeOps());
    expect(server.name).toBe('grove-followups');
    expect(server.instructions).toContain('followup_add');
    const servers = new Set(['grove-followups'] as const);
    for (const tool of server.tools) {
      expect(isAutoAllowedGroveTool(`mcp__grove-followups__${tool.name}`, servers), tool.name).toBe(true);
    }
  });
});
