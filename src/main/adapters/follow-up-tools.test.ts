import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
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
    add: vi.fn(async () => ({ followUp: followUp(), existing: false })),
    list: vi.fn(async () => [followUp()]),
    done: vi.fn(() => followUp({ doneAt: NOW })),
    close: vi.fn(() => followUp({ closedAt: NOW })),
    ...overrides,
  };
}

const textOf = (res: { content: Array<{ type: string; text?: string }> }) => res.content.map((c) => c.text).join('');

describe('followUpToolHandlers', () => {
  it('adds one and says where the user finds it', async () => {
    const ops = fakeOps();
    const res = await followUpToolHandlers(ops).add({ title: 'Add tests', details: 'Cover refresh()' });
    expect(ops.add).toHaveBeenCalledWith({ title: 'Add tests', details: 'Cover refresh()' });
    expect(textOf(res)).toBe("Added follow-up a1b2c3 (normal priority): Add tests. The user can start a thread from it in Grove Bench's Follow-ups drawer.");
    expect(res.isError).toBeUndefined();
  });

  it('passes the priority through and says which one it got', async () => {
    const ops = fakeOps({ add: vi.fn(async () => ({ followUp: followUp({ priority: 'high' }), existing: false })) });
    const res = await followUpToolHandlers(ops).add({ title: 'Add tests', priority: 'high' });
    expect(ops.add).toHaveBeenCalledWith({ title: 'Add tests', details: '', priority: 'high' });
    expect(textOf(res)).toContain('a1b2c3 (high priority)');
  });

  it('reads a priority in any case, and makes a word it does not know normal rather than refusing', async () => {
    const ops = fakeOps();
    const handlers = followUpToolHandlers(ops);
    await handlers.add({ title: 'a', priority: ' HIGH ' });
    expect(ops.add).toHaveBeenLastCalledWith({ title: 'a', details: '', priority: 'high' });
    const res = await handlers.add({ title: 'b', priority: 'urgent' });
    expect(ops.add).toHaveBeenLastCalledWith({ title: 'b', details: '', priority: undefined });
    expect(res.isError).toBeUndefined();
    expect(textOf(res)).toContain('(normal priority)');
  });

  it('says when adding one already listed raised its priority', async () => {
    const ops = fakeOps({ add: vi.fn(async () => ({ followUp: followUp({ priority: 'high' }), existing: true, raised: true })) });
    const res = await followUpToolHandlers(ops).add({ title: 'Add tests', priority: 'high' });
    expect(textOf(res)).toBe('An open follow-up with that title is already listed: a1b2c3. It is now high priority; nothing else was changed.');
  });

  it('says when an open one with that title was already listed', async () => {
    const res = await followUpToolHandlers(fakeOps({ add: vi.fn(async () => ({ followUp: followUp(), existing: true })) })).add({ title: 'Add tests', details: '' });
    expect(textOf(res)).toContain('already listed: a1b2c3');
  });

  it('adds one without details, as an empty string', async () => {
    const ops = fakeOps();
    await followUpToolHandlers(ops).add({ title: 'Add tests' });
    expect(ops.add).toHaveBeenCalledWith({ title: 'Add tests', details: '' });
  });

  it('lists each with its id, age, origin and details', async () => {
    const ops = fakeOps({ list: vi.fn(async () => [
      followUp({ fromLabel: 'Fix login', fromBranch: 'claude/login', startedSessionIds: ['s2'] }),
      followUp({ id: 'ffffff', title: 'Old', details: '', priority: 'low', createdAt: NOW - 3 * 24 * HOUR, doneAt: NOW - HOUR, doneNote: 'Removed it' }),
    ]) });
    const res = await followUpToolHandlers(ops, () => NOW).list({ includeDone: true });
    expect(ops.list).toHaveBeenCalledWith({ includeDone: true });
    expect(textOf(res)).toBe([
      '## a1b2c3: Add tests',
      'Normal priority. Added 2 hours ago in "Fix login" (branch claude/login).',
      'A thread was started from it once.',
      '',
      'Cover refresh()',
      '',
      '## ffffff: Old',
      'Low priority. Added 3 days ago.',
      'Done 1 hour ago: Removed it',
    ].join('\n'));
  });

  it('cuts long details when it lists several, and shows one in full by id', async () => {
    const long = 'x'.repeat(300);
    const ops = fakeOps({ list: vi.fn(async () => [followUp({ details: long }), followUp({ id: 'ffffff', title: 'Old', details: 'short' })]) });
    const handlers = followUpToolHandlers(ops, () => NOW);
    const listed = textOf(await handlers.list({}));
    expect(listed).toContain(`${'x'.repeat(200)}…`);
    expect(listed).not.toContain('x'.repeat(201));
    expect(listed).toContain('call followup_list with an id to read one in full');
    const one = textOf(await handlers.list({ id: ' A1B2C3 ' }));
    // Looked for in every project: ids are unique across them.
    expect(ops.list).toHaveBeenLastCalledWith({ includeDone: true, project: 'all' });
    expect(one).toContain(long);
    expect(one).toContain('Normal priority. Project repo. Added');
    expect(one).not.toContain('ffffff');
    expect(await handlers.list({ id: 'zzz' })).toEqual({ content: [{ type: 'text', text: 'There is no follow-up zzz.' }], isError: true });
  });

  it("doesn't add the note about cut details when nothing was cut", async () => {
    expect(textOf(await followUpToolHandlers(fakeOps()).list({}))).not.toContain('cut here');
  });

  it('says when there are none', async () => {
    const handlers = followUpToolHandlers(fakeOps({ list: vi.fn(async () => []) }));
    expect(textOf(await handlers.list({}))).toBe('This project has no open follow-ups.');
    expect(textOf(await handlers.list({ includeDone: true }))).toBe('This project has no follow-ups.');
    expect(textOf(await handlers.list({ project: 'api' }))).toBe('Project api has no open follow-ups.');
    expect(textOf(await handlers.list({ project: 'all', includeDone: true }))).toBe('No project has follow-ups.');
    expect(textOf(await handlers.list({ project: 'ALL' }))).toBe('No project has open follow-ups.');
  });

  it("lists another project's, naming each one's project, and a closed one with why", async () => {
    const ops = fakeOps({ list: vi.fn(async () => [
      followUp({ repoPath: 'C:\\Code\\api', fromLabel: 'Fix login', fromBranch: 'claude/login', fromRepoPath: 'C:\\Code\\web' }),
      followUp({ id: 'ffffff', repoPath: 'C:\\Code\\api', title: 'Old', details: '', closedAt: NOW - HOUR, closeReason: 'Not needed' }),
    ]) });
    const res = await followUpToolHandlers(ops, () => NOW).list({ project: ' api ', includeDone: true });
    expect(ops.list).toHaveBeenCalledWith({ includeDone: true, project: 'api' });
    expect(textOf(res)).toBe([
      '## a1b2c3: Add tests',
      'Normal priority. Project api. Added 2 hours ago in "Fix login" (branch claude/login in project web).',
      '',
      'Cover refresh()',
      '',
      '## ffffff: Old',
      'Normal priority. Project api. Added 2 hours ago.',
      'Closed without being done 1 hour ago: Not needed',
    ].join('\n'));
  });

  it('adds one to another project and says which', async () => {
    const ops = fakeOps({ add: vi.fn(async () => ({ followUp: followUp({ repoPath: '/work/api' }), existing: false })) });
    const res = await followUpToolHandlers(ops).add({ title: 'Add tests', project: 'api' });
    expect(ops.add).toHaveBeenCalledWith({ title: 'Add tests', details: '', project: 'api' });
    expect(textOf(res)).toContain('Added follow-up a1b2c3 (normal priority) in project api: Add tests.');
  });

  it('marks one done, passing the note through', async () => {
    const ops = fakeOps();
    const res = await followUpToolHandlers(ops).done({ id: 'a1b2c3', note: 'Added them' });
    expect(ops.done).toHaveBeenCalledWith('a1b2c3', 'Added them');
    expect(textOf(res)).toBe('Marked follow-up a1b2c3 done: Add tests');
  });

  it('closes one, passing the reason through', async () => {
    const ops = fakeOps();
    const res = await followUpToolHandlers(ops).close({ id: 'a1b2c3', reason: 'Fixed upstream' });
    expect(ops.close).toHaveBeenCalledWith('a1b2c3', 'Fixed upstream');
    expect(textOf(res)).toBe('Closed follow-up a1b2c3 without doing it: Add tests');
  });

  it('says when one it asked to close was done already, and left as it was', async () => {
    const res = await followUpToolHandlers(fakeOps({ close: vi.fn(() => followUp({ doneAt: NOW })) })).close({ id: 'a1b2c3' });
    expect(textOf(res)).toBe('Follow-up a1b2c3 is already done, so it was left as it is: Add tests');
  });

  it('turns a thrown error into a tool error the agent reads', async () => {
    const ops = fakeOps({ done: vi.fn(() => { throw new Error('There is no follow-up zzz.'); }) });
    const res = await followUpToolHandlers(ops).done({ id: 'zzz' });
    expect(res).toEqual({ content: [{ type: 'text', text: 'There is no follow-up zzz.' }], isError: true });
    const failing = fakeOps({ add: vi.fn(async () => { throw new Error('There is no project "web" in Grove Bench.'); }) });
    expect((await followUpToolHandlers(failing).add({ title: 't', project: 'web' })).isError).toBe(true);
  });
});

describe('followUpsServer', () => {
  it('is served as grove-followups, leaving the guidance to the system prompt, and every tool runs without a prompt', () => {
    const server = followUpsServer(fakeOps());
    expect(server.name).toBe('grove-followups');
    expect(server.instructions).toBeUndefined();
    const servers = new Set(['grove-followups'] as const);
    for (const tool of server.tools) {
      expect(isAutoAllowedGroveTool(`mcp__grove-followups__${tool.name}`, servers), tool.name).toBe(true);
    }
  });
});

describe('followup tool inputs', () => {
  it('accepts a title, details and note past the limits, which the store cuts', () => {
    const tools = followUpsServer(fakeOps()).tools;
    const shape = (name: string) => z.object(tools.find((t) => t.name === name)!.shape);
    expect(shape('followup_add').safeParse({ title: 't'.repeat(500), details: 'd'.repeat(9000) }).success).toBe(true);
    expect(shape('followup_add').safeParse({ title: 't' }).success).toBe(true);
    expect(shape('followup_add').safeParse({ title: '' }).success).toBe(false);
    // Any word: one the store doesn't know makes it normal, not a refused call.
    for (const priority of ['high', 'normal', 'low', 'High', 'urgent']) {
      expect(shape('followup_add').safeParse({ title: 't', priority }).success, priority).toBe(true);
    }
    expect(shape('followup_done').safeParse({ id: 'a', note: 'n'.repeat(2000) }).success).toBe(true);
    expect(shape('followup_close').safeParse({ id: 'a', reason: 'r'.repeat(2000) }).success).toBe(true);
    expect(shape('followup_close').safeParse({ id: '' }).success).toBe(false);
    expect(shape('followup_list').safeParse({ project: 'all' }).success).toBe(true);
    expect(shape('followup_add').safeParse({ title: 't', project: 'api' }).success).toBe(true);
  });
});
