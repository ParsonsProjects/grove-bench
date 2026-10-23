import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { readJsonFile, readJsonFileAsync, writeFileAtomic, writeFileAtomicSync } from './json-file.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-json-'));
  file = path.join(dir, 'state.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const lockError = () => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });

describe('readJsonFile', () => {
  it('reads a JSON file', () => {
    fs.writeFileSync(file, '{"a":1}');
    expect(readJsonFile(file)).toEqual({ kind: 'ok', value: { a: 1 } });
  });

  it('tells a missing file apart', () => {
    expect(readJsonFile(file)).toEqual({ kind: 'missing' });
  });

  it('keeps a copy of a damaged file before anything replaces it', () => {
    fs.writeFileSync(file, '{"a":');
    expect(readJsonFile(file)).toEqual({ kind: 'corrupt' });
    expect(fs.readFileSync(`${file}.corrupt`, 'utf8')).toBe('{"a":');
  });

  it('reports a file that stays locked as unreadable, not missing', () => {
    fs.writeFileSync(file, '{"a":1}');
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw lockError(); });
    expect(readJsonFile(file)).toMatchObject({ kind: 'unreadable' });
  });

  it('rides out a brief lock', () => {
    fs.writeFileSync(file, '{"a":1}');
    vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw lockError(); });
    expect(readJsonFile(file)).toEqual({ kind: 'ok', value: { a: 1 } });
  });
});

describe('writeFileAtomicSync', () => {
  it('replaces the file and leaves no temp file', () => {
    fs.writeFileSync(file, 'old');
    writeFileAtomicSync(file, 'new');
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
    expect(fs.readdirSync(dir)).toEqual(['state.json']);
  });

  it('leaves the old file intact and cleans up when the rename fails', () => {
    fs.writeFileSync(file, 'old');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); });
    expect(() => writeFileAtomicSync(file, 'new')).toThrow('EXDEV');
    expect(fs.readFileSync(file, 'utf8')).toBe('old');
    expect(fs.readdirSync(dir)).toEqual(['state.json']);
  });

  it('retries a rename blocked by a brief lock', () => {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync')
      .mockImplementationOnce(() => { throw lockError(); })
      .mockImplementation((from, to) => rename(from, to));
    writeFileAtomicSync(file, 'new');
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
  });
});

describe('readJsonFileAsync', () => {
  it('reads a JSON file, and tells a missing one apart', async () => {
    expect(await readJsonFileAsync(file)).toEqual({ kind: 'missing' });
    fs.writeFileSync(file, '{"a":1}');
    expect(await readJsonFileAsync(file)).toEqual({ kind: 'ok', value: { a: 1 } });
  });

  it('keeps a copy of a damaged file', async () => {
    fs.writeFileSync(file, '{"a":');
    expect(await readJsonFileAsync(file)).toEqual({ kind: 'corrupt' });
    expect(fs.readFileSync(`${file}.corrupt`, 'utf8')).toBe('{"a":');
  });

  it('rides out a lock with timers, and reports one that stays as unreadable', async () => {
    fs.writeFileSync(file, '{"a":1}');
    vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(lockError());
    expect(await readJsonFileAsync(file)).toEqual({ kind: 'ok', value: { a: 1 } });

    vi.useFakeTimers();
    try {
      vi.spyOn(fs.promises, 'readFile').mockRejectedValue(lockError());
      const read = readJsonFileAsync(file);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await read).toMatchObject({ kind: 'unreadable' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('writeFileAtomic', () => {
  /** Hold fs.promises.rename until the returned function is called. */
  function holdRename(): () => void {
    const rename = fs.promises.rename.bind(fs.promises);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      await gate;
      return rename(from, to);
    });
    return release;
  }

  it('replaces the file and leaves no temp file', async () => {
    fs.writeFileSync(file, 'old');
    expect(await writeFileAtomic(file, 'new').done).toBe('written');
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
    expect(fs.readdirSync(dir)).toEqual(['state.json']);
  });

  it('leaves the old file intact and cleans up when the rename fails', async () => {
    fs.writeFileSync(file, 'old');
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('EXDEV'), { code: 'EXDEV' }));
    await expect(writeFileAtomic(file, 'new').done).rejects.toThrow('EXDEV');
    expect(fs.readFileSync(file, 'utf8')).toBe('old');
    expect(fs.readdirSync(dir)).toEqual(['state.json']);
  });

  it('retries a rename blocked by a brief lock', async () => {
    const rename = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, 'rename')
      .mockRejectedValueOnce(lockError())
      .mockImplementation((from, to) => rename(from, to));
    expect(await writeFileAtomic(file, 'new').done).toBe('written');
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
  });

  it('cancelled before its rename, it leaves the file alone', async () => {
    fs.writeFileSync(file, 'old');
    const write = writeFileAtomic(file, 'new');
    expect(write.cancel()).toBe(true);
    expect(await write.done).toBe('cancelled');
    expect(fs.readFileSync(file, 'utf8')).toBe('old');
    expect(fs.readdirSync(dir)).toEqual(['state.json']);
  });

  it('cancelled with its rename on the way, it can\'t land over a write made after', async () => {
    fs.writeFileSync(file, 'old');
    const release = holdRename();
    const write = writeFileAtomic(file, 'stale');
    await vi.waitFor(() => expect(fs.promises.rename).toHaveBeenCalled());

    expect(write.cancel()).toBe(true);
    writeFileAtomicSync(file, 'latest');
    release();
    expect(await write.done).toBe('cancelled');
    expect(fs.readFileSync(file, 'utf8')).toBe('latest');
    expect(fs.readdirSync(dir)).toEqual(['state.json']);
  });

  it('says so when its temp file stays locked and it can\'t be stopped', async () => {
    const release = holdRename();
    const write = writeFileAtomic(file, 'stale');
    await vi.waitFor(() => expect(fs.promises.rename).toHaveBeenCalled());
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw lockError(); });

    expect(write.cancel()).toBe(false);
    release();
    expect(await write.done).toBe('written');
    expect(fs.readFileSync(file, 'utf8')).toBe('stale');
  });
});
