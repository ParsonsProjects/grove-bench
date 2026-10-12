/**
 * Limits that pause a thread and ask before it goes on: spend (per thread
 * and per day) and how long one turn may run (tool calls, minutes). Shared
 * by main, which checks them before each tool call, and the renderer, which
 * shows the pause and the settings.
 */

export type LimitKind = 'dailySpend' | 'threadSpend' | 'turnToolCalls' | 'turnMinutes';

/** The limit settings, 0 meaning off (see GroveBenchSettings). */
export interface LimitSettings {
  dailySpendLimitUsd: number;
  threadSpendLimitUsd: number;
  turnToolCallLimit: number;
  turnMinutesLimit: number;
}

/** What has been used so far, and where each limit now stands for it. An
 *  allowance is set once the user chose to continue past the limit; the
 *  limit is then whichever of it and the setting is higher, so raising the
 *  setting later still counts. Null means the setting applies. */
export interface LimitUsage {
  dailySpendUsd: number;
  dailyAllowanceUsd: number | null;
  threadSpendUsd: number;
  threadAllowanceUsd: number | null;
  /** Tool calls started this turn, the one asking included. */
  turnToolCalls: number;
  turnToolAllowance: number | null;
  /** How long this turn has run, not counting time spent waiting on the user. */
  turnMs: number;
  turnMsAllowance: number | null;
}

/** A limit that was reached: how much was used, the point it was reached
 *  at, and how far Continue lets the thread go. Minutes are in minutes. */
export interface ReachedLimit {
  limit: LimitKind;
  used: number;
  reachedAt: number;
  /** The new point to stop at if the user continues. */
  nextAllowance: number;
}

const MINUTE_MS = 60_000;

/**
 * The first limit `usage` has reached, or null. Spend comes first: it is
 * the one that costs money. Continuing grants another round of the setting
 * from where the thread stands (another $5, another 100 tool calls).
 */
export function reachedLimit(settings: LimitSettings, usage: LimitUsage): ReachedLimit | null {
  const daily = settings.dailySpendLimitUsd;
  if (daily > 0) {
    const at = Math.max(usage.dailyAllowanceUsd ?? 0, daily);
    if (usage.dailySpendUsd >= at) {
      return { limit: 'dailySpend', used: usage.dailySpendUsd, reachedAt: at, nextAllowance: usage.dailySpendUsd + daily };
    }
  }
  const thread = settings.threadSpendLimitUsd;
  if (thread > 0) {
    const at = Math.max(usage.threadAllowanceUsd ?? 0, thread);
    if (usage.threadSpendUsd >= at) {
      return { limit: 'threadSpend', used: usage.threadSpendUsd, reachedAt: at, nextAllowance: usage.threadSpendUsd + thread };
    }
  }
  const tools = settings.turnToolCallLimit;
  if (tools > 0) {
    const at = Math.max(usage.turnToolAllowance ?? 0, tools);
    // The call asking is counted, so the limit itself still runs.
    const made = usage.turnToolCalls - 1;
    if (made >= at) {
      return { limit: 'turnToolCalls', used: made, reachedAt: at, nextAllowance: made + tools };
    }
  }
  const minutes = settings.turnMinutesLimit;
  if (minutes > 0) {
    const atMs = Math.max(usage.turnMsAllowance ?? 0, minutes * MINUTE_MS);
    if (usage.turnMs >= atMs) {
      return {
        limit: 'turnMinutes',
        used: usage.turnMs / MINUTE_MS,
        reachedAt: atMs / MINUTE_MS,
        nextAllowance: (usage.turnMs + minutes * MINUTE_MS) / MINUTE_MS,
      };
    }
  }
  return null;
}

/** The setting behind a limit, in the units its event carries. */
export function limitSetting(settings: LimitSettings, limit: LimitKind): number {
  switch (limit) {
    case 'dailySpend': return settings.dailySpendLimitUsd;
    case 'threadSpend': return settings.threadSpendLimitUsd;
    case 'turnToolCalls': return settings.turnToolCallLimit;
    case 'turnMinutes': return settings.turnMinutesLimit;
  }
}

/** Dollars for a limit: estimates, so cents are enough. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Why the thread paused, in a sentence. */
export function limitReachedText(limit: LimitKind, used: number, reachedAt: number): string {
  switch (limit) {
    case 'dailySpend':
      return `Today's spend across threads is about ${formatUsd(used)}, which reached your daily limit of ${formatUsd(reachedAt)}.`;
    case 'threadSpend':
      return `This thread has spent about ${formatUsd(used)}, which reached your limit of ${formatUsd(reachedAt)}.`;
    case 'turnToolCalls':
      return `This turn has made ${plural(Math.round(used), 'tool call', 'tool calls')}, your limit for one turn.`;
    case 'turnMinutes':
      return `This turn has run for ${plural(Math.floor(used), 'minute', 'minutes')}, your limit for one turn.`;
  }
}

/** What Continue grants, for its button. */
export function limitGrantText(limit: LimitKind, setting: number): string {
  switch (limit) {
    case 'dailySpend':
    case 'threadSpend':
      return `another ${formatUsd(setting)}`;
    case 'turnToolCalls':
      return `another ${plural(setting, 'tool call', 'tool calls')}`;
    case 'turnMinutes':
      return `another ${plural(setting, 'minute', 'minutes')}`;
  }
}

/** Short name for a limit, for notifications. */
export function limitName(limit: LimitKind): string {
  switch (limit) {
    case 'dailySpend': return 'daily spend limit';
    case 'threadSpend': return 'thread spend limit';
    case 'turnToolCalls': return 'tool call limit';
    case 'turnMinutes': return 'time limit';
  }
}

/** The local calendar day of `now`, as YYYY-MM-DD: daily spend starts again
 *  at local midnight. */
export function localDay(now = Date.now()): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
