/**
 * Every turn's cost, tokens, time and models, across all threads, for the
 * Usage dialog. One line per turn in usage-ledger.jsonl, appended when the
 * turn ends, so a thread's figures stay after it is removed, rewound or
 * cleared (its own history doesn't keep them through those).
 *
 * Turns from before the ledger began are added once, the first time it is
 * read, from the threads' event logs: their results carry no `at` (main
 * stamps every result now), which also keeps them apart from the turns
 * recorded live meanwhile. Those have no models and are dated by the prompt
 * before them, when it has a time.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { app } from 'electron';
import type { AgentEvent, ModelTurnUsage, UsageRecord, UsageSummary, UsageTotals } from '../shared/types.js';
import { nonNegative } from '../shared/limits.js';
import { turnSpend, turnTokens } from './session-limits.js';
import { logger } from './logger.js';

/** Lines parsed between yields, so a long ledger doesn't hold up main. */
const PARSE_CHUNK = 2000;

/** The line that says older history has been added. */
interface BackfillMark {
  backfilledAt: number;
}

/** What the ledger knows of a thread that still exists. */
export interface ThreadLabel {
  title: string;
  repoPath: string;
  agent?: string;
}

const emptyTotals = (): UsageTotals => ({ usd: 0, input: 0, output: 0, ms: 0, turns: 0 });

function add(to: UsageTotals, r: { usd: number; tokens: { input: number; output: number }; ms: number }): void {
  to.usd += r.usd;
  to.input += r.tokens.input;
  to.output += r.tokens.output;
  to.ms += r.ms;
  to.turns++;
}

const biggestFirst = (a: UsageTotals, b: UsageTotals) => b.usd - a.usd || (b.input + b.output) - (a.input + a.output) || b.ms - a.ms;

/** The ledger record for a result, or null when it reports nothing at all
 *  (no cost, tokens or time). */
export function recordOf(result: AgentEvent, thread: { id: string; agent: string; repoPath?: string; title?: string }): UsageRecord | null {
  if (result.type !== 'result') return null;
  const usd = turnSpend(result);
  const tokens = turnTokens(result);
  const ms = nonNegative(result.durationMs);
  if (usd === 0 && tokens.input === 0 && tokens.output === 0 && ms === 0) return null;
  const models = result.models?.filter((m) => typeof m.model === 'string' && m.model);
  return {
    ...(result.at !== undefined ? { at: result.at } : {}),
    thread: thread.id,
    ...(thread.repoPath ? { repoPath: thread.repoPath } : {}),
    ...(thread.title ? { title: thread.title } : {}),
    agent: thread.agent,
    usd,
    tokens,
    ms,
    ...(models?.length ? { models } : {}),
    ...(result.shortenedTokens ? { shortenedTokens: nonNegative(result.shortenedTokens) } : {}),
  };
}

/** A model's part of a record's cost and tokens: its own share where the
 *  record has a split, the whole turn under model '' where it hasn't. */
function modelShares(r: UsageRecord): ModelTurnUsage[] {
  if (!r.models?.length) return [{ model: '', input: r.tokens.input, output: r.tokens.output, costUsd: r.usd }];
  return r.models;
}

/**
 * Add up `records` from `since` (epoch ms; null for all time). Records with
 * no date count only toward all time. `labels`: each thread that still
 * exists; the rest show as removed, under the title they last had.
 */
export function summarize(
  records: readonly UsageRecord[],
  since: number | null,
  labels: ReadonlyMap<string, ThreadLabel>,
): Omit<UsageSummary, 'backfilling'> {
  const total = emptyTotals();
  const undated = emptyTotals();
  const byModel = new Map<string, UsageSummary['byModel'][number]>();
  const byThread = new Map<string, UsageSummary['byThread'][number]>();
  /** When the name a removed thread shows was recorded (undated: -1). */
  const namedAt = new Map<string, number>();
  let recordingSince: number | null = null;
  let shortenedTokens = 0;

  for (const r of records) {
    if (!r.backfilled && r.at !== undefined && (recordingSince === null || r.at < recordingSince)) recordingSince = r.at;
    if (r.at === undefined) {
      if (since !== null) continue;
      add(undated, r);
    } else if (since !== null && r.at < since) {
      continue;
    }
    add(total, r);
    shortenedTokens += nonNegative(r.shortenedTokens);

    const shares = modelShares(r);
    shares.forEach((share, i) => {
      const key = `${r.agent}\u0000${share.model}`;
      const row = byModel.get(key) ?? { model: share.model, agent: r.agent, ...emptyTotals() };
      row.usd += nonNegative(share.costUsd);
      row.input += nonNegative(share.input);
      row.output += nonNegative(share.output);
      // A turn's time and the turn itself go to the thread's main model,
      // listed first.
      if (i === 0) {
        row.ms += r.ms;
        row.turns++;
      }
      byModel.set(key, row);
    });

    const label = labels.get(r.thread);
    const row = byThread.get(r.thread) ?? {
      thread: r.thread,
      title: label?.title || r.title || '',
      repoPath: label?.repoPath || r.repoPath || '',
      agent: label?.agent || r.agent,
      removed: !label,
      ...emptyTotals(),
    };
    add(row, r);
    if (r.at !== undefined && (row.lastAt === undefined || r.at > row.lastAt)) row.lastAt = r.at;
    // A removed thread shows the title and project it last had: from its
    // latest record, whatever order the ledger holds them in.
    const at = r.at ?? -1;
    if (!label && (r.title || r.repoPath) && at >= (namedAt.get(r.thread) ?? -Infinity)) {
      namedAt.set(r.thread, at);
      if (r.title) row.title = r.title;
      if (r.repoPath) row.repoPath = r.repoPath;
    }
    byThread.set(r.thread, row);
  }

  return {
    total,
    byModel: [...byModel.values()].sort(biggestFirst),
    byThread: [...byThread.values()].sort(biggestFirst),
    undated,
    recordingSince,
    shortenedTokens,
  };
}

/**
 * The turns in one thread's event log from before results were stamped,
 * read line by line (a log can be large) and parsed only where a line can
 * matter. `agent`: the thread's agent now, for turns before any switch.
 */
export async function backfillThread(logPath: string, thread: Omit<BackfillSource, 'logPath'>): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  /** Records from before the first agent switch, whose agent is the one
   *  it switched from. */
  let beforeSwitch: UsageRecord[] | null = [];
  let agent: string | undefined;
  let promptAt: number | undefined;
  const lines = readline.createInterface({ input: fs.createReadStream(logPath, { encoding: 'utf-8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"type":"result"') && !line.includes('"type":"user_message"') && !line.includes('"type":"agent_changed"')) continue;
    let event: AgentEvent;
    try {
      event = JSON.parse(line) as AgentEvent;
    } catch {
      continue;
    }
    if (event.type === 'user_message') {
      promptAt = typeof event.at === 'number' ? event.at : undefined;
    } else if (event.type === 'agent_changed') {
      if (beforeSwitch) for (const r of beforeSwitch) r.agent = event.from;
      beforeSwitch = null;
      agent = event.to;
    } else if (event.type === 'result' && event.at === undefined) {
      const record = recordOf(event, { id: thread.id, agent: agent ?? '', repoPath: thread.repoPath, title: thread.title });
      if (!record) continue;
      // The prompt's time stands in for the turn's end. Once only: a turn
      // the agent started itself has no prompt of its own, and is better
      // left undated than given an older prompt's day.
      if (promptAt !== undefined) record.at = promptAt;
      promptAt = undefined;
      record.backfilled = true;
      records.push(record);
      beforeSwitch?.push(record);
    }
  }
  if (beforeSwitch) for (const r of beforeSwitch) r.agent = thread.agent ?? '';
  return records;
}

/** A thread whose event log the ledger adds up once. */
export interface BackfillSource {
  id: string;
  logPath: string;
  agent?: string;
  repoPath?: string;
  title?: string;
}

/** Every event log in `dir`, removed threads' included, with what
 *  `labels` knows of the thread each belongs to. */
export async function eventLogSources(dir: string, labels: ReadonlyMap<string, ThreadLabel>): Promise<BackfillSource[]> {
  let files: string[];
  try {
    files = await fs.promises.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return files.filter((f) => f.endsWith('.jsonl')).map((f) => {
    const id = f.slice(0, -'.jsonl'.length);
    const label = labels.get(id);
    return { id, logPath: path.join(dir, f), ...(label ? { agent: label.agent, repoPath: label.repoPath, title: label.title } : {}) };
  });
}

/** A ledger line as a record, its figures cleaned (a line written by hand
 *  or cut short can hold anything), or null when it isn't one. */
function cleanRecord(raw: unknown): UsageRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof UsageRecord, unknown>>;
  if (typeof r.thread !== 'string' || !r.thread) return null;
  const tokens = (r.tokens && typeof r.tokens === 'object' ? r.tokens : {}) as Partial<Record<'input' | 'output', unknown>>;
  const models = Array.isArray(r.models)
    ? (r.models as unknown[]).flatMap((m): ModelTurnUsage[] => {
      if (!m || typeof m !== 'object') return [];
      const { model, input, output, costUsd } = m as Partial<Record<keyof ModelTurnUsage, unknown>>;
      if (typeof model !== 'string' || !model) return [];
      return [{ model, input: nonNegative(input), output: nonNegative(output), ...(costUsd !== undefined ? { costUsd: nonNegative(costUsd) } : {}) }];
    })
    : [];
  return {
    ...(typeof r.at === 'number' && Number.isFinite(r.at) ? { at: r.at } : {}),
    thread: r.thread,
    ...(typeof r.repoPath === 'string' && r.repoPath ? { repoPath: r.repoPath } : {}),
    ...(typeof r.title === 'string' && r.title ? { title: r.title } : {}),
    agent: typeof r.agent === 'string' ? r.agent : '',
    usd: nonNegative(r.usd),
    tokens: { input: nonNegative(tokens.input), output: nonNegative(tokens.output) },
    ms: nonNegative(r.ms),
    ...(models.length > 0 ? { models } : {}),
    ...(r.backfilled === true ? { backfilled: true as const } : {}),
    ...(nonNegative(r.shortenedTokens) > 0 ? { shortenedTokens: nonNegative(r.shortenedTokens) } : {}),
  };
}

const yieldToMain = () => new Promise<void>((resolve) => setImmediate(resolve));

export class UsageLedger {
  /** Loaded on first read; until then turns are only appended. In file
   *  order, so a launch sees them as the last one did. */
  private records: UsageRecord[] | null = null;
  private backfilled = false;
  /** The ledger's folder exists (made on the first append). */
  private madeDir = false;
  private backfill: Promise<void> | null = null;
  /** Appends and the first read, in order, so a turn is never in memory
   *  twice or not at all. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: () => string,
    /** The event logs to add up the first time, and what's known of each
     *  thread they belong to. */
    private readonly sources: () => Promise<BackfillSource[]>,
  ) {}

  /** Add a turn. */
  record(record: UsageRecord): void {
    this.enqueue(async () => {
      await this.append(JSON.stringify(record) + '\n');
      this.records?.push(record);
    }).catch(() => { /* logged by the queue */ });
  }

  /** Everything recorded, the older history added first if it hasn't been.
   *  `backfilling`: still being added; ask again when it's done. Rejects
   *  when the ledger can't be read, and tries again on the next read: a
   *  backfill over a ledger it couldn't see would add the older turns twice. */
  async read(): Promise<{ records: readonly UsageRecord[]; backfilling: boolean }> {
    await this.enqueue(async () => {
      if (!this.records) await this.load();
    });
    if (!this.backfilled) this.backfill ??= this.runBackfill().finally(() => { this.backfill = null; });
    return { records: this.records ?? [], backfilling: !this.backfilled };
  }

  /** Wait for the older history to be added (tests, and callers that want
   *  the full figures). */
  async settled(): Promise<void> {
    await this.read();
    await this.backfill;
  }

  /** Run `work` after what is already queued. The returned promise
   *  rejects with its error; the queue goes on either way. */
  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work);
    this.queue = next.catch((e: unknown) => logger.warn('[usage-ledger]', e));
    return next;
  }

  private async append(text: string): Promise<void> {
    if (!this.madeDir) {
      await fs.promises.mkdir(path.dirname(this.file()), { recursive: true });
      this.madeDir = true;
    }
    await fs.promises.appendFile(this.file(), text, 'utf-8');
  }

  private async load(): Promise<void> {
    let data = '';
    try {
      data = await fs.promises.readFile(this.file(), 'utf-8');
    } catch (e) {
      // None yet is an empty ledger; any other failure (the file held open
      // by a scanner) leaves it unread, to try again.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const records: UsageRecord[] = [];
    let backfilled = false;
    const lines = data.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0 && i % PARSE_CHUNK === 0) await yieldToMain();
      const line = lines[i];
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        logger.warn('[usage-ledger] skipping a corrupt line');
        continue;
      }
      if (parsed && typeof (parsed as Partial<BackfillMark>).backfilledAt === 'number') {
        backfilled = true;
        continue;
      }
      const record = cleanRecord(parsed);
      if (record) records.push(record);
    }
    this.records = records;
    this.backfilled ||= backfilled;
  }

  /** Add the turns in every thread's log from before the ledger began,
   *  with the mark that says so in the same write, so they're added once. */
  private async runBackfill(): Promise<void> {
    const started = Date.now();
    const found: UsageRecord[] = [];
    try {
      for (const source of await this.sources()) {
        try {
          found.push(...await backfillThread(source.logPath, source));
        } catch (e) {
          logger.warn(`[usage-ledger] could not add up the history of ${source.id}:`, e);
        }
        await yieldToMain();
      }
    } catch (e) {
      // Try again next time the ledger is read.
      logger.warn('[usage-ledger] could not list the threads to add up:', e);
      return;
    }
    const mark: BackfillMark = { backfilledAt: Date.now() };
    await this.enqueue(async () => {
      if (this.backfilled) return;
      await this.append(found.map((r) => JSON.stringify(r) + '\n').join('') + JSON.stringify(mark) + '\n');
      // On disk now: whatever happens next, it mustn't be added again.
      this.backfilled = true;
      // After the turns already read, as in the file.
      if (this.records) this.records = this.records.concat(found);
      logger.info(`[usage-ledger] added ${found.length} older turns in ${Date.now() - started} ms`);
    }).catch(() => { /* logged by the queue; tried again on the next read */ });
  }
}

export const usageLedgerPath = () => path.join(app.getPath('userData'), 'usage-ledger.jsonl');
