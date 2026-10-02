/**
 * Console and network log for the agent's Preview page. The agent reads it with
 * the preview_logs tool, which by default returns only what it hasn't seen.
 */

export type PreviewLogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface PreviewLogEntry {
  seq: number;
  time: number;
  /** console: console.* and uncaught errors. network: failed or 4xx/5xx
   *  requests. page: load failures, crashes, blocked navigations. */
  kind: 'console' | 'network' | 'page';
  level: PreviewLogLevel;
  text: string;
  /** Script URL and line for console entries. */
  source?: string;
}

const MAX_TEXT = 2000;

/** Electron's console-message levels, 0-3. */
export function consoleLevel(level: number): PreviewLogLevel {
  return (['debug', 'info', 'warning', 'error'] as const)[level] ?? 'info';
}

export class PreviewLog {
  private entries: PreviewLogEntry[] = [];
  private seq = 0;
  /** Seq of the newest entry takeUnread has returned. */
  private readSeq = 0;

  constructor(private readonly limit = 300) {}

  add(entry: Omit<PreviewLogEntry, 'seq' | 'time'> & { time?: number }): PreviewLogEntry {
    const text = entry.text.length > MAX_TEXT ? entry.text.slice(0, MAX_TEXT) + ' …' : entry.text;
    const full: PreviewLogEntry = { ...entry, text, seq: ++this.seq, time: entry.time ?? Date.now() };
    this.entries.push(full);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    return full;
  }

  /** Seq of the newest entry, or 0 when empty. */
  get lastSeq(): number {
    return this.seq;
  }

  /** Entries added after `seq`. */
  since(seq: number): PreviewLogEntry[] {
    return this.entries.filter((e) => e.seq > seq);
  }

  all(): PreviewLogEntry[] {
    return [...this.entries];
  }

  /** Entries not returned by an earlier call, plus how many of those were
   *  dropped from the buffer before they could be read. */
  takeUnread(): { entries: PreviewLogEntry[]; dropped: number } {
    const entries = this.since(this.readSeq);
    const firstKept = this.entries[0]?.seq ?? this.seq + 1;
    const dropped = Math.max(0, firstKept - this.readSeq - 1);
    this.readSeq = this.seq;
    return { entries, dropped };
  }

  clear(): void {
    this.entries = [];
    this.readSeq = this.seq;
  }
}

function clock(time: number): string {
  const d = new Date(time);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/** One line per entry, oldest first, for the agent to read. */
export function formatLogEntries(entries: PreviewLogEntry[], opts: { errorsOnly?: boolean } = {}): string {
  const shown = opts.errorsOnly ? entries.filter((e) => e.level === 'error') : entries;
  return shown
    .map((e) => {
      const tag = e.kind === 'console' ? `console.${e.level === 'warning' ? 'warn' : e.level}` : `${e.kind} ${e.level}`;
      const where = e.source ? `  (${e.source})` : '';
      return `${clock(e.time)} [${tag}] ${e.text}${where}`;
    })
    .join('\n');
}
