import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockExeca = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: mockExeca }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  parseProcessList, treeOf, listProcesses, snapshotTree, killSurvivors, killDescendants, waitForExit,
  type ProcessEntry,
} from './process-tree.js';

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Make process.kill act on a fake process table: signal 0 probes it and
 *  SIGKILL removes from it. Returns the PIDs sent SIGKILL, in order. */
function fakeKill(running: Set<number>): number[] {
  const killed: number[] = [];
  vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    if (!running.has(pid)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    if (signal === 'SIGKILL') {
      killed.push(pid);
      running.delete(pid);
    }
    return true;
  }) as typeof process.kill);
  return killed;
}

function psOutput(entries: ProcessEntry[]): { stdout: string } {
  return { stdout: entries.map((p) => `${p.pid} ${p.ppid}${p.startedAt ? ` ${p.startedAt}` : ''}`).join('\n') };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  setPlatform('linux');
});

afterEach(() => {
  setPlatform(realPlatform);
});

describe('parseProcessList', () => {
  it('reads ps output (pid ppid) with padding', () => {
    expect(parseProcessList('    1     0\n  812     1\n')).toEqual([
      { pid: 1, ppid: 0 },
      { pid: 812, ppid: 1 },
    ]);
  });

  it('reads the Windows form with start times and CRLF line endings', () => {
    expect(parseProcessList('4 0 0\r\n9120 700 13370000000000\r\n')).toEqual([
      { pid: 4, ppid: 0 },
      { pid: 9120, ppid: 700, startedAt: 13370000000000 },
    ]);
  });

  it('skips lines that are not a process', () => {
    expect(parseProcessList('\nWARNING: something\n12 3\n')).toEqual([{ pid: 12, ppid: 3 }]);
  });
});

describe('treeOf', () => {
  it('returns the root and all its descendants, parents first', () => {
    const table = [
      { pid: 1, ppid: 0 },
      { pid: 10, ppid: 1 },
      { pid: 11, ppid: 10 },
      { pid: 12, ppid: 10 },
      { pid: 13, ppid: 11 },
      { pid: 20, ppid: 1 },
    ];
    expect(treeOf(table, 10).map((p) => p.pid)).toEqual([10, 11, 12, 13]);
  });

  it('is empty when the root is not running', () => {
    expect(treeOf([{ pid: 1, ppid: 0 }], 99)).toEqual([]);
  });

  it('ignores an orphan whose dead parent had the same PID (Windows PID reuse)', () => {
    const table = [
      { pid: 500, ppid: 1, startedAt: 2_000 },
      { pid: 501, ppid: 500, startedAt: 1_000 }, // started before 500 existed
      { pid: 502, ppid: 500, startedAt: 3_000 },
    ];
    expect(treeOf(table, 500).map((p) => p.pid)).toEqual([500, 502]);
  });

  it('does not loop on a process listed as its own parent', () => {
    expect(treeOf([{ pid: 0, ppid: 0 }, { pid: 4, ppid: 0 }], 0).map((p) => p.pid)).toEqual([0, 4]);
  });
});

describe('listProcesses', () => {
  it('uses ps on POSIX', async () => {
    mockExeca.mockResolvedValue(psOutput([{ pid: 1, ppid: 0 }]));
    expect(await listProcesses()).toEqual([{ pid: 1, ppid: 0 }]);
    expect(mockExeca).toHaveBeenCalledWith('ps', ['-A', '-o', 'pid=,ppid='], expect.any(Object));
  });

  it('uses an encoded PowerShell CIM query on Windows', async () => {
    setPlatform('win32');
    mockExeca.mockResolvedValue({ stdout: '4 0 0\r\n' });
    await listProcesses();

    const [command, args, opts] = mockExeca.mock.calls[0];
    expect(command).toBe('powershell.exe');
    expect(opts).toMatchObject({ windowsHide: true });
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const script = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(script).toContain('Get-CimInstance -ClassName Win32_Process');
  });

  it('returns an empty table when the query fails', async () => {
    mockExeca.mockRejectedValue(new Error('ps: not found'));
    expect(await listProcesses()).toEqual([]);
  });

  it('shares one query between concurrent callers', async () => {
    mockExeca.mockResolvedValue(psOutput([{ pid: 1, ppid: 0 }]));
    const [a, b] = await Promise.all([listProcesses(), listProcesses()]);
    expect(a).toBe(b);
    expect(mockExeca).toHaveBeenCalledOnce();
  });
});

describe('snapshotTree', () => {
  it('falls back to the root alone when processes cannot be listed', async () => {
    mockExeca.mockRejectedValue(new Error('boom'));
    expect(await snapshotTree(77)).toEqual([{ pid: 77, ppid: 0 }]);
  });
});

describe('killDescendants', () => {
  it('kills everything under the root but not the root', async () => {
    const running = new Set([1, 100, 101, 102]);
    const killed = fakeKill(running);
    mockExeca.mockResolvedValue(psOutput([
      { pid: 1, ppid: 0 }, { pid: 100, ppid: 1 }, { pid: 101, ppid: 100 }, { pid: 102, ppid: 101 },
    ]));

    expect(await killDescendants(100)).toEqual([101, 102]);
    expect(killed).toEqual([101, 102]);
    expect(running.has(100)).toBe(true);
  });
});

describe('killSurvivors', () => {
  it('does nothing, without listing processes, when everything already exited', async () => {
    fakeKill(new Set());
    expect(await killSurvivors([{ pid: 200, ppid: 1 }, { pid: 201, ppid: 200 }])).toEqual([]);
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('kills leftovers and anything they started since, parents first', async () => {
    // 200 (the agent) exited; its dev server 201 kept running and has since
    // started 203. Once orphaned, 201 is re-parented to init.
    const running = new Set([1, 201, 203]);
    const killed = fakeKill(running);
    mockExeca.mockResolvedValue(psOutput([{ pid: 1, ppid: 0 }, { pid: 201, ppid: 1 }, { pid: 203, ppid: 201 }]));

    const snapshot = [{ pid: 200, ppid: 1 }, { pid: 201, ppid: 200 }, { pid: 202, ppid: 201 }];
    expect(await killSurvivors(snapshot)).toEqual([201, 203]);
    expect(killed).toEqual([201, 203]);
  });

  it('leaves a PID alone once it belongs to a different process', async () => {
    const running = new Set([300]);
    const killed = fakeKill(running);
    mockExeca.mockResolvedValue(psOutput([{ pid: 300, ppid: 4, startedAt: 9_000 }]));

    expect(await killSurvivors([{ pid: 300, ppid: 250, startedAt: 5_000 }])).toEqual([]);
    expect(killed).toEqual([]);
  });

  it('still kills the known survivors when processes cannot be listed', async () => {
    const running = new Set([400]);
    const killed = fakeKill(running);
    mockExeca.mockRejectedValue(new Error('boom'));

    expect(await killSurvivors([{ pid: 400, ppid: 1 }, { pid: 401, ppid: 400 }])).toEqual([400]);
    expect(killed).toEqual([400]);
  });

  it('never signals PID 0 or its own process', async () => {
    const running = new Set([0, process.pid]);
    const killed = fakeKill(running);
    mockExeca.mockRejectedValue(new Error('boom'));

    await killSurvivors([{ pid: 0, ppid: 0 }, { pid: process.pid, ppid: 0 }]);
    expect(killed).toEqual([]);
  });
});

describe('waitForExit', () => {
  it('resolves true once the process is gone', async () => {
    const running = new Set([500]);
    fakeKill(running);
    setTimeout(() => running.delete(500), 30);
    expect(await waitForExit(500, 1_000, 10)).toBe(true);
  });

  it('resolves false when the process outlives the timeout', async () => {
    fakeKill(new Set([501]));
    expect(await waitForExit(501, 30, 10)).toBe(false);
  });
});
