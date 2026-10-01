import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordTrace, lastTracePath, TRACE_CONFIG, type TraceDeps } from './perf-trace.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-trace-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Deps whose recorder writes `bytes` to the file when stopped. */
function fakeDeps(over: Partial<TraceDeps> = {}, bytes = 2048) {
  const lines: string[] = [];
  const tracing = {
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(async (file?: string) => { fs.writeFileSync(file!, 'x'.repeat(bytes)); return file!; }),
  };
  const deps: TraceDeps = {
    tracing,
    wait: vi.fn(async () => {}),
    dir: () => dir,
    date: () => new Date('2026-10-01T12:34:56.789Z'),
    write: (line) => lines.push(line),
    ...over,
  };
  return { deps, tracing, lines };
}

describe('recordTrace', () => {
  it('records for the given time, then saves the trace in the traces folder', async () => {
    const { deps, tracing, lines } = fakeDeps({}, 3 * 1024 * 1024);
    const result = await recordTrace(10, deps);

    expect(tracing.startRecording).toHaveBeenCalledWith(TRACE_CONFIG);
    expect(deps.wait).toHaveBeenCalledWith(10_000);
    const file = path.join(dir, 'trace-2026-10-01T12-34-56-789Z.json');
    expect(tracing.stopRecording).toHaveBeenCalledWith(file);
    expect(result).toEqual({ name: 'trace-2026-10-01T12-34-56-789Z.json', sizeBytes: 3 * 1024 * 1024, seconds: 10 });
    expect(lastTracePath()).toBe(file);
    expect(lines).toEqual(['recording for 10 s', 'saved trace-2026-10-01T12-34-56-789Z.json (3.0 MB)']);
  });

  it('runs one recording at a time', async () => {
    let finishWait!: () => void;
    const { deps, tracing } = fakeDeps({ wait: () => new Promise<void>((r) => { finishWait = r; }) });
    const first = recordTrace(10, deps);
    const second = recordTrace(10, deps);
    await vi.waitFor(() => expect(finishWait).toBeTypeOf('function'));
    finishWait();

    expect(await second).toEqual(await first);
    expect(tracing.startRecording).toHaveBeenCalledOnce();
  });

  it('stops recording even when the wait fails, and can record again', async () => {
    const { deps, tracing } = fakeDeps({ wait: async () => { throw new Error('interrupted'); } });
    await expect(recordTrace(10, deps)).rejects.toThrow('interrupted');
    expect(tracing.stopRecording).toHaveBeenCalledOnce();

    const again = fakeDeps();
    await expect(recordTrace(10, again.deps)).resolves.toMatchObject({ seconds: 10 });
  });

  it('keeps the newest five traces', async () => {
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(dir, `trace-2026-09-0${i + 1}T00-00-00-000Z.json`), '{}');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'kept');
    const { deps } = fakeDeps();
    await recordTrace(10, deps);

    expect(fs.readdirSync(dir).sort()).toEqual([
      'notes.txt',
      'trace-2026-09-03T00-00-00-000Z.json',
      'trace-2026-09-04T00-00-00-000Z.json',
      'trace-2026-09-05T00-00-00-000Z.json',
      'trace-2026-09-06T00-00-00-000Z.json',
      'trace-2026-10-01T12-34-56-789Z.json',
    ]);
  });
});
