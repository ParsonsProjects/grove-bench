import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('./process-host.js', () => ({ agentHostGaveUp: () => false, runProcessInHost: vi.fn() }));
vi.mock('./process-host-run.js', () => ({ runInAgentHost: vi.fn(), recordCommandPids: () => () => new Set() }));

import {
  measureSystem, parseSystemCounters, resetForTests, SAMPLE_SEC, SLACK_MS, SYSTEM_COUNTERS, systemCounterArgs,
} from './perf-system.js';
import { TYPEPERF_TIMEOUT_MS } from './process-memory.js';

afterEach(() => resetForTests());

const MB = 1024 * 1024;
const csv = (fields: string[]) => fields.map((f) => `"${f}"`).join(',');

/** typeperf's output for `rows` of the counters, in SYSTEM_COUNTERS's order:
 *  cpu, kernel, queue, disk idle, disk s/transfer, free MB, pages in. */
function typeperfOutput(rows: string[][], counters: string[] = Object.values(SYSTEM_COUNTERS)): string {
  const header = ['(PDH-CSV 4.0) (GMT Standard Time)(0)', ...counters.map((c) => `\\\\DESKTOP-1${c}`)];
  const lines = rows.map((r, i) => csv([`11/03/2026 10:15:${String(i * 15).padStart(2, '0')}.369`, ...r]));
  return ['', csv(header), ...lines, '', 'Exiting, please wait...', 'The command completed successfully.', ''].join('\r\n');
}

describe('systemCounterArgs', () => {
  it('reads every counter, sampled SAMPLE_SEC apart, as many times as asked', () => {
    expect(systemCounterArgs(38)).toEqual([...Object.values(SYSTEM_COUNTERS), '-si', String(SAMPLE_SEC), '-sc', '38']);
  });
});

describe('parseSystemCounters', () => {
  it('averages each counter over the samples and keeps its highest', () => {
    const load = parseSystemCounters(typeperfOutput([
      ['40.0', '10.0', '2', '80.0', '0.002', '24000', '10'],
      ['100.0', '30.0', '41', '0.0', '0.220', '21000', '800'],
      ['46.0', '14.0', '0', '95.0', '0.003', '23000', '0'],
    ]));
    expect(load).toEqual({
      samples: 3,
      cpu: { avg: 62, max: 100 },
      kernel: { avg: 18, max: 30 },
      queue: { avg: 43 / 3, max: 41 },
      diskBusy: { avg: (20 + 100 + 5) / 3, max: 100 },
      diskMs: { avg: expect.closeTo(75, 6), max: expect.closeTo(220, 6) },
      freeBytes: 21000 * MB,
      pagesIn: { avg: 270, max: 800 },
    });
  });

  it('skips a value it could not read, and leaves out a counter typeperf turned down', () => {
    // A Windows without the disk counters: typeperf leaves their columns out.
    const counters = [SYSTEM_COUNTERS.cpu, SYSTEM_COUNTERS.freeMB];
    const load = parseSystemCounters(typeperfOutput([[' ', '30000'], ['50.0', '29000']], counters));
    expect(load).toEqual({ samples: 2, cpu: { avg: 50, max: 50 }, freeBytes: 29000 * MB });
  });

  it('keeps a busy share between 0 and 100, as the counters can stray past them', () => {
    const load = parseSystemCounters(typeperfOutput([['100.4', '0', '0', '-1.0', '0', '1000', '0']]));
    expect(load).toMatchObject({ cpu: { max: 100 }, diskBusy: { max: 100 } });
  });

  it('reads a comma as the decimal point, as typeperf prints it in some languages', () => {
    const load = parseSystemCounters(typeperfOutput([['12,5', '1,0', '0', '90,0', '0,001', '5000', '0']]));
    expect(load?.cpu).toEqual({ avg: 12.5, max: 12.5 });
  });

  it('reads values from the time on, when a line has a field more before it, as one run in six did on 4 to 6 Nov', () => {
    // Read by position, these gave "disk busy 100%, 72010 ms per transfer,
    // free memory 919 bytes, paging in 11732 pages/s" and no CPU.
    const shifted = typeperfOutput([['13.0', '7.0', '0', '72.01', '0.000877', '11732', '40']])
      .replace(/^"11\/03/m, '"","11/03');
    expect(parseSystemCounters(shifted)).toEqual({
      samples: 1,
      cpu: { avg: 13, max: 13 },
      kernel: { avg: 7, max: 7 },
      queue: { avg: 0, max: 0 },
      diskBusy: { avg: expect.closeTo(27.99, 6), max: expect.closeTo(27.99, 6) },
      diskMs: { avg: expect.closeTo(0.877, 6), max: expect.closeTo(0.877, 6) },
      freeBytes: 11732 * MB,
      pagesIn: { avg: 40, max: 40 },
    });
  });

  it("skips a line whose values still don't line up with the header, and says how many", () => {
    const output = typeperfOutput([
      ['50.0', '10.0', '1', '50.0', '0.004', '20000', '5'],
      ['50.0', '10.0', '1', '50.0', '0.004', '20000'], // a value short
    ]);
    const load = parseSystemCounters(output);
    expect(load).toMatchObject({ samples: 1, cpu: { avg: 50, max: 50 }, misaligned: { lines: 1 } });
    expect(load?.misaligned?.example).toContain('PDH-CSV');
    const none = parseSystemCounters(typeperfOutput([['50.0', '10.0', '1', '50.0', '0.004', '20000']]));
    expect(none).toMatchObject({ samples: 0, misaligned: { lines: 1 } });
  });

  it('skips a negative value, as PDH gives for a disk transfer now and then', () => {
    const load = parseSystemCounters(typeperfOutput([
      ['50.0', '10.0', '1', '50.0', '-0.0245', '20000', '5'],
      ['50.0', '10.0', '1', '50.0', '0.002', '20000', '5'],
    ]));
    expect(load?.diskMs).toEqual({ avg: 2, max: 2 });
  });

  it('is null with no header, no counter it knows, or no sample', () => {
    expect(parseSystemCounters('Error: No valid counters.\r\n')).toBeNull();
    expect(parseSystemCounters(typeperfOutput([['1']], ['\\Process(node)\\ID Process']))).toBeNull();
    expect(parseSystemCounters(typeperfOutput([]))).toBeNull();
    expect(parseSystemCounters(typeperfOutput([[' ', ' ', ' ', ' ', ' ', ' ', ' ']]))).toBeNull();
  });
});

describe('measureSystem', () => {
  const sample = typeperfOutput([['50.0', '10.0', '1', '50.0', '0.004', '20000', '5']]);

  it('samples the period in the agent host, ending SLACK_MS before it, and says how many cores there are', async () => {
    const run = vi.fn(async () => ({ stdout: sample }));
    const load = await measureSystem(600_000, { run, platform: 'win32', gaveUp: () => false, cores: 16 });
    const samples = Math.floor((600_000 - SLACK_MS) / (SAMPLE_SEC * 1000));
    expect(samples).toBe(38);
    expect(run).toHaveBeenCalledWith(
      expect.stringMatching(/System32[\\/]typeperf\.exe$/),
      systemCounterArgs(samples),
      { timeout: samples * SAMPLE_SEC * 1000 + TYPEPERF_TIMEOUT_MS, hostOnly: true },
    );
    expect(load).toMatchObject({ samples: 1, cores: 16, cpu: { avg: 50, max: 50 } });
  });

  it('uses what typeperf printed when it exits with an error after sampling', async () => {
    const run = vi.fn(async () => { throw Object.assign(new Error('Command failed'), { exitCode: 1, stdout: sample, stderr: '' }); });
    await expect(measureSystem(600_000, { run, platform: 'win32', gaveUp: () => false, cores: 4 })).resolves.toMatchObject({ samples: 1 });
  });

  it('is null off Windows, once the agent host has given up, and for a period too short to sample', async () => {
    const run = vi.fn(async () => ({ stdout: sample }));
    expect(await measureSystem(600_000, { run, platform: 'linux' })).toBeNull();
    expect(await measureSystem(600_000, { run, platform: 'win32', gaveUp: () => true })).toBeNull();
    expect(await measureSystem(SLACK_MS + SAMPLE_SEC * 1000 - 1, { run, platform: 'win32', gaveUp: () => false })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("notes lines that don't line up once, with what typeperf printed, and keeps the rest", async () => {
    const note = vi.fn();
    const good = ['50.0', '10.0', '1', '50.0', '0.004', '20000', '5'];
    const run = async () => ({ stdout: typeperfOutput([good, good.slice(0, 6)]) });
    const opts = { run, platform: 'win32' as const, gaveUp: () => false, cores: 8, note };
    const load = await measureSystem(600_000, opts);
    expect(load).toMatchObject({ samples: 1, cpu: { avg: 50 } });
    expect(load).not.toHaveProperty('misaligned');
    await measureSystem(600_000, opts);
    expect(note).toHaveBeenCalledOnce();
    expect(note.mock.calls[0][0]).toMatch(/^\[perf-system\] typeperf printed 1 sample line\(s\) whose values don't line up with its header, .*PDH-CSV/);
  });

  it('is null when every line is out of line', async () => {
    const run = async () => ({ stdout: typeperfOutput([['50.0', '10.0', '1', '50.0', '0.004', '20000']]) });
    expect(await measureSystem(600_000, { run, platform: 'win32', gaveUp: () => false, note: () => {} })).toBeNull();
  });

  it('is null when typeperf fails, times out or prints no sample, noting the first failure only', async () => {
    const note = vi.fn();
    const opts = { platform: 'win32' as const, gaveUp: () => false, note };
    expect(await measureSystem(600_000, { ...opts, run: async () => { throw Object.assign(new Error('timed out'), { timedOut: true }); } })).toBeNull();
    expect(await measureSystem(600_000, { ...opts, run: async () => ({ stdout: 'Error: No valid counters.' }) })).toBeNull();
    expect(note).toHaveBeenCalledOnce();
    expect(note.mock.calls[0][0]).toMatch(/^\[perf-system\] Couldn't sample the PC's load with typeperf, so the health line leaves it out: timed out$/);
  });
});
