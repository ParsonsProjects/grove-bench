import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  log?.close();
  log = null;
  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Close and wait for the stream to reach the disk. */
async function flush(): Promise<void> {
  log?.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf-8');

describe('createRotatingLog', () => {
  it('appends lines, with the header at the top of each stream', async () => {
    fs.writeFileSync(file, 'earlier\n');
    log = createRotatingLog({ path: () => file, maxSize: 1000, maxFiles: 2, header: () => 'build x\n' });
    log.write('one\n');
    log.write('two\n');
    await flush();
    expect(read('app.log')).toBe('earlier\nbuild x\none\ntwo\n');
  });

  it('rotates a file already over the limit when it opens', async () => {
    fs.writeFileSync(file, 'x'.repeat(100));
    log = createRotatingLog({ path: () => file, maxSize: 100, maxFiles: 2 });
    log.write('new\n');
    await flush();
    expect(read('app.log')).toBe('new\n');
    expect(read('app.log.1')).toBe('x'.repeat(100));
  });

  it('rotates while running, once the file passes the limit', async () => {
    log = createRotatingLog({ path: () => file, maxSize: 50, maxFiles: 2, checkEvery: 5 });
    for (let i = 0; i < 5; i++) log.write(`line ${i} ${'x'.repeat(10)}\n`);
    // The size is read from disk: let the first five land before the check.
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (let i = 5; i < 10; i++) log.write(`line ${i} ${'x'.repeat(10)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    log.write('after\n');
    await flush();

    expect(read('app.log.1')).toContain('line 0');
    expect(read('app.log')).toBe('after\n');
  });

  it('keeps at most maxFiles files', async () => {
    for (const [name, text] of [['app.log', 'a'.repeat(10)], ['app.log.1', 'b'], ['app.log.2', 'c']]) {
      fs.writeFileSync(path.join(dir, name), text);
    }
    log = createRotatingLog({ path: () => file, maxSize: 10, maxFiles: 3 });
    log.write('new\n');
    await flush();
    expect(fs.readdirSync(dir).sort()).toEqual(['app.log', 'app.log.1', 'app.log.2']);
    expect(read('app.log.1')).toBe('a'.repeat(10));
    expect(read('app.log.2')).toBe('b');
  });

  it('survives a file that cannot be written, and tries again on the next write', async () => {
    const later = path.join(dir, 'later', 'app.log'); // its folder doesn't exist yet: the stream errors
    log = createRotatingLog({ path: () => later, maxSize: 1000, maxFiles: 2 });
    log.write('lost\n');
    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.mkdirSync(path.dirname(later));
    log.write('kept\n');
    await flush();
    expect(fs.readFileSync(later, 'utf-8')).toBe('kept\n');
  });
});
