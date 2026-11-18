import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent, UsageRecord } from '../shared/types.js';
import { UsageLedger, backfillThread, eventLogSources, recordOf, summarize, type ThreadLabel } from './usage-ledger.js';

type Result = Extract<AgentEvent, { type: 'result' }>;
const result = (extra: Partial<Result> = {}): Result => ({ type: 'result', subtype: 'success', isError: false, ...extra });
const costed = (usd: number, extra: Partial<Result> = {}) => result({ totalCostUsd: usd, sessionCostUsd: usd, ...extra });

const rec = (extra: Partial<UsageRecord> = {}): UsageRecord => ({
  thread: 't1', agent: 'claude-code', usd: 1, tokens: { input: 100, output: 10 }, ms: 1000, ...extra,
});

describe('recordOf', () => {
  const thread = { id: 't1', agent: 'claude-code', repoPath: '/r', title: 'Fix it' };

  it('records a turn\'s cost, tokens, time, models and end', () => {
    const models = [{ model: 'claude-opus-5-5', input: 100, output: 10, costUsd: 0.5 }];
    expect(recordOf(costed(0.5, { turnTokens: { input: 100, output: 10 }, durationMs: 1200, models, at: 5 }), thread)).toEqual({
      at: 5, thread: 't1', repoPath: '/r', title: 'Fix it', agent: 'claude-code', usd: 0.5, tokens: { input: 100, output: 10 }, ms: 1200, models,
    });
  });

  it('counts cost the way the spend limits do', () => {
    // Before costs were per turn, results carried no running total and
    // their figure was the conversation's.
    expect(recordOf(result({ totalCostUsd: 9, durationMs: 10 }), thread)?.usd).toBe(0);
  });

  it('skips a result that reports nothing, and other events', () => {
    expect(recordOf(result(), thread)).toBeNull();
    expect(recordOf({ type: 'status', message: 'hi' }, thread)).toBeNull();
  });
});

describe('summarize', () => {
  const labels = new Map<string, ThreadLabel>([['t1', { title: 'Now named', repoPath: '/r', agent: 'claude-code' }]]);

  it('adds up a range, leaving out older and undated turns', () => {
    const records = [rec({ at: 100 }), rec({ at: 50 }), rec({}), rec({ at: 200, usd: 2 })];
    const s = summarize(records, 100, labels);
    expect(s.total).toEqual({ usd: 3, input: 200, output: 20, ms: 2000, turns: 2 });
    expect(s.undated.turns).toBe(0);
  });

  it('counts undated turns in all time only, and says so', () => {
    const s = summarize([rec({ at: 100 }), rec({})], null, labels);
    expect(s.total.turns).toBe(2);
    expect(s.undated).toEqual({ usd: 1, input: 100, output: 10, ms: 1000, turns: 1 });
  });

  it('splits by model, giving the turn and its time to the model that did most', () => {
    const records = [
      rec({ at: 1, usd: 1, tokens: { input: 100, output: 10 }, ms: 1000, models: [
        { model: 'opus', input: 80, output: 8, costUsd: 0.9 },
        { model: 'haiku', input: 20, output: 2, costUsd: 0.1 },
      ] }),
      rec({ at: 2, usd: 0.5, ms: 500 }),
    ];
    const s = summarize(records, null, labels);
    expect(s.byModel).toEqual([
      { model: 'opus', agent: 'claude-code', usd: 0.9, input: 80, output: 8, ms: 1000, turns: 1 },
      { model: '', agent: 'claude-code', usd: 0.5, input: 100, output: 10, ms: 500, turns: 1 },
      { model: 'haiku', agent: 'claude-code', usd: 0.1, input: 20, output: 2, ms: 0, turns: 0 },
    ]);
  });

  it('keeps one model apart by agent', () => {
    const s = summarize([rec({ models: [{ model: 'm', input: 1, output: 1 }] }), rec({ agent: 'other', models: [{ model: 'm', input: 1, output: 1 }] })], null, labels);
    expect(s.byModel.map((m) => m.agent).sort()).toEqual(['claude-code', 'other']);
  });

  it('names threads as they are now, and removed ones as they last were', () => {
    const records = [
      rec({ at: 1, title: 'Old name' }),
      rec({ at: 3, thread: 'gone', title: 'First', repoPath: '/a', usd: 5 }),
      rec({ at: 4, thread: 'gone', title: 'Last', repoPath: '/b', usd: 1 }),
    ];
    const s = summarize(records, null, labels);
    expect(s.byThread.map((t) => [t.thread, t.title, t.repoPath, t.removed, t.lastAt])).toEqual([
      ['gone', 'Last', '/b', true, 4],
      ['t1', 'Now named', '/r', false, 1],
    ]);
  });

  it('names a removed thread from its latest record, in any order', () => {
    const s = summarize([
      rec({ thread: 'gone', at: 9, title: 'Latest', repoPath: '/new' }),
      rec({ thread: 'gone', at: 2, title: 'Older', repoPath: '/old' }),
      rec({ thread: 'gone', title: 'Undated', backfilled: true }),
    ], null, labels);
    expect(s.byThread[0]).toMatchObject({ title: 'Latest', repoPath: '/new', removed: true });
  });

  it('says when live recording began, not counting backfilled turns', () => {
    expect(summarize([rec({ at: 1, backfilled: true }), rec({ at: 7 }), rec({ at: 5 })], 6, labels).recordingSince).toBe(5);
    expect(summarize([rec({ at: 1, backfilled: true })], null, labels).recordingSince).toBeNull();
  });
});

describe('the ledger on disk', () => {
  let dir: string;
  const line = (e: AgentEvent) => JSON.stringify(e) + '\n';

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-ledger-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('backfills a log\'s unstamped turns, dated by their prompt, under the agent of the time', async () => {
    const log = path.join(dir, 't1.jsonl');
    fs.writeFileSync(log, [
      line({ type: 'user_message', text: 'one', at: 1000 }),
      line(costed(1, { turnTokens: { input: 10, output: 1 }, durationMs: 5 })),
      line({ type: 'agent_changed', from: 'claude-code', to: 'codex', fromName: 'Claude', toName: 'Codex', transcript: true }),
      line({ type: 'user_message', text: 'two' }),
      line(costed(2, { durationMs: 6 })),
      // Stamped: already in the ledger, recorded when it ended.
      line(costed(3, { at: 9000, durationMs: 7 })),
      'not json\n',
    ].join(''));
    const records = await backfillThread(log, { id: 't1', agent: 'codex', title: 'T' });
    expect(records).toEqual([
      { at: 1000, thread: 't1', title: 'T', agent: 'claude-code', usd: 1, tokens: { input: 10, output: 1 }, ms: 5, backfilled: true },
      { thread: 't1', title: 'T', agent: 'codex', usd: 2, tokens: { input: 0, output: 0 }, ms: 6, backfilled: true },
    ]);
  });

  it('dates a turn by its own prompt only, leaving one the agent started undated', async () => {
    const log = path.join(dir, 't1.jsonl');
    fs.writeFileSync(log, [
      line({ type: 'user_message', text: 'one', at: 1000 }),
      line(costed(1, { durationMs: 5 })),
      // A background task finished and the agent went on by itself.
      line(costed(2, { durationMs: 6 })),
    ].join(''));
    expect((await backfillThread(log, { id: 't1', agent: 'claude-code' })).map((r) => r.at)).toEqual([1000, undefined]);
  });

  it('gives turns the thread\'s agent when it never switched', async () => {
    const log = path.join(dir, 't1.jsonl');
    fs.writeFileSync(log, line(costed(1, { durationMs: 5 })));
    expect((await backfillThread(log, { id: 't1', agent: 'gemini-cli' }))[0].agent).toBe('gemini-cli');
  });

  it('lists every log, with what is known of its thread', async () => {
    const events = path.join(dir, 'events');
    fs.mkdirSync(events);
    fs.writeFileSync(path.join(events, 'a.jsonl'), '');
    fs.writeFileSync(path.join(events, 'gone.jsonl'), '');
    fs.writeFileSync(path.join(events, 'notes.txt'), '');
    const sources = await eventLogSources(events, new Map([['a', { title: 'A', repoPath: '/r', agent: 'claude-code' }]]));
    expect(sources.sort((x, y) => x.id.localeCompare(y.id))).toEqual([
      { id: 'a', logPath: path.join(events, 'a.jsonl'), title: 'A', repoPath: '/r', agent: 'claude-code' },
      { id: 'gone', logPath: path.join(events, 'gone.jsonl') },
    ]);
    expect(await eventLogSources(path.join(dir, 'missing'), new Map())).toEqual([]);
  });

  it('keeps turns recorded before and after the first read, once each', async () => {
    const file = path.join(dir, 'usage-ledger.jsonl');
    const ledger = new UsageLedger(() => file, async () => []);
    ledger.record(rec({ at: 1 }));
    await ledger.settled();
    ledger.record(rec({ at: 2 }));
    const { records } = await ledger.read();
    expect(records.map((r) => r.at)).toEqual([1, 2]);
    // A new launch reads the same from the file.
    const again = new UsageLedger(() => file, async () => { throw new Error('backfilled already'); });
    await again.settled();
    expect((await again.read()).records.map((r) => r.at)).toEqual([1, 2]);
  });

  it('adds older history once, after what was recorded, as the file has it', async () => {
    const file = path.join(dir, 'usage-ledger.jsonl');
    const log = path.join(dir, 't1.jsonl');
    fs.writeFileSync(log, line(costed(1, { durationMs: 5 })));
    let listed = 0;
    const sources = async () => { listed++; return [{ id: 't1', logPath: log, agent: 'claude-code' }]; };
    const ledger = new UsageLedger(() => file, sources);
    ledger.record(rec({ at: 50 }));
    expect((await ledger.read()).backfilling).toBe(true);
    await ledger.settled();
    const { records, backfilling } = await ledger.read();
    expect(backfilling).toBe(false);
    expect(records.map((r) => [r.at, r.backfilled])).toEqual([[50, undefined], [undefined, true]]);
    expect(listed).toBe(1);

    // A new launch reads them back in the same order, and adds nothing more.
    const again = new UsageLedger(() => file, sources);
    await again.settled();
    expect((await again.read()).records.map((r) => [r.at, r.backfilled])).toEqual([[50, undefined], [undefined, true]]);
    expect(listed).toBe(1);
  });

  it('won\'t add older history over a ledger it couldn\'t read, and reads it again next time', async () => {
    const file = path.join(dir, 'usage-ledger.jsonl');
    // A folder where the file should be: reading fails, but not as missing.
    fs.mkdirSync(file);
    let listed = 0;
    const ledger = new UsageLedger(() => file, async () => { listed++; return []; });
    await expect(ledger.read()).rejects.toThrow();
    expect(listed).toBe(0);

    fs.rmdirSync(file);
    fs.writeFileSync(file, JSON.stringify(rec({ at: 1 })) + '\n' + JSON.stringify({ backfilledAt: 1 }) + '\n');
    const { records, backfilling } = await ledger.read();
    expect(records.map((r) => r.at)).toEqual([1]);
    expect(backfilling).toBe(false);
    expect(listed).toBe(0);
  });

  it('cleans a line\'s figures, so a bad line can\'t make the totals NaN', async () => {
    const file = path.join(dir, 'usage-ledger.jsonl');
    fs.writeFileSync(file, [
      '{"thread":"t1","tokens":{}}',
      '{"thread":"t2","usd":"lots","ms":-5,"tokens":{"input":10,"output":null},"models":[{"model":"m","input":"x"},{"input":3}],"at":"soon"}',
      '{"tokens":{"input":1,"output":1}}',
      '[1,2]',
      '{"backfilledAt":1}',
    ].join('\n') + '\n');
    const ledger = new UsageLedger(() => file, async () => []);
    const { records } = await ledger.read();
    expect(records).toEqual([
      { thread: 't1', agent: '', usd: 0, tokens: { input: 0, output: 0 }, ms: 0 },
      { thread: 't2', agent: '', usd: 0, tokens: { input: 10, output: 0 }, ms: 0, models: [{ model: 'm', input: 0, output: 0 }] },
    ]);
    expect(summarize(records, null, new Map()).total).toEqual({ usd: 0, input: 10, output: 0, ms: 0, turns: 2 });
  });

  it('tries the backfill again next time when the threads can\'t be listed', async () => {
    const file = path.join(dir, 'usage-ledger.jsonl');
    let fail = true;
    const ledger = new UsageLedger(() => file, async () => { if (fail) throw new Error('no manifest'); return []; });
    await ledger.settled();
    expect((await ledger.read()).backfilling).toBe(true);
    fail = false;
    await ledger.settled();
    expect((await ledger.read()).backfilling).toBe(false);
  });
});
