import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The logs folder is a fresh temp folder (vi.mock runs before the imports).
const dir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  return mkdtempSync(join(tmpdir(), 'perf-log-'));
});
vi.mock('./logger.js', () => ({ getLogDir: () => dir }));

import { perfLine, perfLogPath, closePerfLog } from './perf-log.js';

/** Close the file and wait until what was written is on disk. */
async function flushed(): Promise<string> {
  closePerfLog();
  await new Promise((resolve) => setTimeout(resolve, 20));
  return fs.readFileSync(perfLogPath(), 'utf-8');
}

beforeEach(async () => {
  closePerfLog();
  await new Promise((resolve) => setTimeout(resolve, 10));
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true });
});

describe('perfLine', () => {
  it('writes timestamped lines to performance.log in the logs folder', async () => {
    perfLine('freeze', "main process didn't run for 196 ms");
    perfLine('health', 'agents 2');
    const text = await flushed();

    expect(perfLogPath()).toBe(path.join(dir, 'performance.log'));
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] \[freeze\] main process didn't run for 196 ms$/);
    expect(lines[1]).toMatch(/\[health\] agents 2$/);
  });

  it('keeps a file grown past 5 MB as performance.log.1 and starts a new one', async () => {
    fs.writeFileSync(perfLogPath(), 'x'.repeat(5 * 1024 * 1024));
    perfLine('trace', 'saved');
    const text = await flushed();

    expect(text).toMatch(/\[trace\] saved\n$/);
    expect(fs.statSync(`${perfLogPath()}.1`).size).toBe(5 * 1024 * 1024);
  });

  it('never throws, even when the logs folder cannot be used', () => {
    fs.mkdirSync(perfLogPath()); // a folder where the file should be
    expect(() => perfLine('freeze', 'lost')).not.toThrow();
  });

  it('adds to a smaller file from an earlier launch', async () => {
    fs.writeFileSync(perfLogPath(), 'earlier\n');
    perfLine('steps', 'later');
    expect(await flushed()).toMatch(/^earlier\n.*\[steps\] later\n$/);
    expect(fs.existsSync(`${perfLogPath()}.1`)).toBe(false);
  });
});

