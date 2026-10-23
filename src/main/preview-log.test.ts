import { describe, it, expect } from 'vitest';
import { PreviewLog, consoleLevel, formatLogEntries } from './preview-log.js';

describe('consoleLevel', () => {
  it('maps Electron levels 0-3', () => {
    expect([0, 1, 2, 3].map(consoleLevel)).toEqual(['debug', 'info', 'warning', 'error']);
    expect(consoleLevel(9)).toBe('info');
  });
});

describe('PreviewLog', () => {
  it('returns only unread entries from takeUnread', () => {
    const log = new PreviewLog();
    log.add({ kind: 'console', level: 'info', text: 'a' });
    log.add({ kind: 'console', level: 'error', text: 'b' });
    expect(log.takeUnread().entries.map((e) => e.text)).toEqual(['a', 'b']);
    expect(log.takeUnread().entries).toEqual([]);
    log.add({ kind: 'network', level: 'error', text: 'c' });
    expect(log.takeUnread().entries.map((e) => e.text)).toEqual(['c']);
  });

  it('keeps the newest entries within the limit and counts unread ones dropped', () => {
    const log = new PreviewLog(3);
    for (const t of ['1', '2', '3', '4', '5']) log.add({ kind: 'console', level: 'info', text: t });
    expect(log.all().map((e) => e.text)).toEqual(['3', '4', '5']);
    const { entries, dropped } = log.takeUnread();
    expect(entries.map((e) => e.text)).toEqual(['3', '4', '5']);
    expect(dropped).toBe(2);
    log.add({ kind: 'console', level: 'info', text: '6' });
    expect(log.takeUnread()).toEqual({ entries: [expect.objectContaining({ text: '6' })], dropped: 0 });
  });

  it('returns entries after a seq', () => {
    const log = new PreviewLog();
    log.add({ kind: 'console', level: 'info', text: 'old' });
    const mark = log.lastSeq;
    log.add({ kind: 'console', level: 'error', text: 'new' });
    expect(log.since(mark).map((e) => e.text)).toEqual(['new']);
  });

  it('marks everything read on clear', () => {
    const log = new PreviewLog();
    log.add({ kind: 'console', level: 'info', text: 'x' });
    log.clear();
    expect(log.all()).toEqual([]);
    expect(log.takeUnread()).toEqual({ entries: [], dropped: 0 });
  });

  it('truncates very long messages', () => {
    const log = new PreviewLog();
    const entry = log.add({ kind: 'console', level: 'info', text: 'x'.repeat(5000) });
    expect(entry.text.length).toBeLessThan(2100);
    expect(entry.text.endsWith('…')).toBe(true);
  });
});

describe('formatLogEntries', () => {
  const at = new Date(2026, 0, 1, 9, 5, 7).getTime();

  it('formats console and network entries', () => {
    const text = formatLogEntries([
      { seq: 1, time: at, kind: 'console', level: 'warning', text: 'Deprecated', source: 'http://localhost:5173/main.js:3' },
      { seq: 2, time: at, kind: 'network', level: 'error', text: 'GET http://localhost:5173/api → 500' },
    ]);
    expect(text).toBe(
      '09:05:07 [console.warn] Deprecated  (http://localhost:5173/main.js:3)\n'
      + '09:05:07 [network error] GET http://localhost:5173/api → 500',
    );
  });

  it('can show errors only', () => {
    const text = formatLogEntries([
      { seq: 1, time: at, kind: 'console', level: 'info', text: 'hello' },
      { seq: 2, time: at, kind: 'console', level: 'error', text: 'boom' },
    ], { errorsOnly: true });
    expect(text).toBe('09:05:07 [console.error] boom');
  });
});
