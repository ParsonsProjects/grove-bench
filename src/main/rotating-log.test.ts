import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRotatingLog, type RotatingLog } from './rotating-log.js';

let dir: string;
let file: string;
let log: RotatingLog | null = null;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotating-log-'));
  file = path.join(dir, 'app.log');
});

afterEach(async () => {
  await log?.close();
  log = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf-8');

describe('createRotatingLog', () => {
  it('appends lines, with the header at the top of each stream', async () => {
    fs.writeFileSync(file, 'earlier\n');
    log = createRotatingLog({ path: () => file, maxSize: 1000, maxFiles: 2, header: () => 'build x\n' });
    log.write('one\n');
    log.write('two\n');
    await log.close();
    expect(read('app.log')).toBe('earlier\nbuild x\none\ntwo\n');
  });

  it('rotates a file already over the limit when it opens', async () => {
    fs.writeFileSync(file, 'x'.repeat(100));
    log = createRotatingLog({ path: () => file, maxSize: 100, maxFiles: 2 });
    log.write('new\n');
    await log.close();
    expect(read('app.log')).toBe('new\n');
    expect(read('app.log.1')).toBe('x'.repeat(100));
  });

  it('rotates while running, once the file passes the limit', async () => {
    log = createRotatingLog({ path: () => file, maxSize: 50, maxFiles: 2, checkEvery: 5 });
    const line = (i: number) => `line ${i} ${'x'.repeat(10)}\n`;
    const lines = (n: number) => Array.from({ length: n }, (_, i) => line(i)).join('');
    for (let i = 0; i < 5; i++) log.write(line(i));
    // The size is read from disk: let the first five land before the check.
    await vi.waitFor(() => expect(fs.statSync(file).size).toBe(Buffer.byteLength(lines(5))));
    for (let i = 5; i < 10; i++) log.write(line(i));
    // The tenth write's check ended that stream; close waits for it too.
    await log.close();
    expect(read('app.log')).toBe(lines(10));
    log.write('after\n');
    await log.close();

    expect(read('app.log.1')).toBe(lines(10));
    expect(read('app.log')).toBe('after\n');
  });

  it('waits for a stream an earlier close is still closing', async () => {
    log = createRotatingLog({ path: () => file, maxSize: 1000, maxFiles: 2 });
    log.write('one\n');
    void log.close(); // as at quit, unawaited
    await log.close();
    expect(read('app.log')).toBe('one\n');
  });

  it('keeps at most maxFiles files', async () => {
    for (const [name, text] of [['app.log', 'a'.repeat(10)], ['app.log.1', 'b'], ['app.log.2', 'c']]) {
      fs.writeFileSync(path.join(dir, name), text);
    }
    log = createRotatingLog({ path: () => file, maxSize: 10, maxFiles: 3 });
    log.write('new\n');
    await log.close();
    expect(fs.readdirSync(dir).sort()).toEqual(['app.log', 'app.log.1', 'app.log.2']);
    expect(read('app.log.1')).toBe('a'.repeat(10));
    expect(read('app.log.2')).toBe('b');
  });

  it('survives a file that cannot be written, and tries again on the next write', async () => {
    const later = path.join(dir, 'later', 'app.log'); // its folder doesn't exist yet: the stream errors
    const opened: fs.WriteStream[] = [];
    const create = fs.createWriteStream;
    const spy = vi.spyOn(fs, 'createWriteStream').mockImplementation(((...args: Parameters<typeof create>) => {
      const s = create(...args);
      opened.push(s);
      return s;
    }) as typeof create);
    log = createRotatingLog({ path: () => later, maxSize: 1000, maxFiles: 2 });
    log.write('lost\n');
    // A failed stream closes once its error is out. (events.once would
    // reject on that error.)
    if (!opened[0].closed) await new Promise<void>((resolve) => opened[0].once('close', () => resolve()));
    spy.mockRestore();
    fs.mkdirSync(path.dirname(later));
    log.write('kept\n');
    await log.close();
    expect(fs.readFileSync(later, 'utf-8')).toBe('kept\n');
  });
});
