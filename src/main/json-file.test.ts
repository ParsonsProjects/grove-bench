import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { readJsonFile, writeFileAtomicSync } from './json-file.js';

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
