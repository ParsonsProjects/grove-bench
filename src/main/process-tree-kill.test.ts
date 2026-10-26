import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  killTreeWith, listProcessesWith, parseProcessList, taskkillWith, treeOf, type ProcessEntry, type RunCommand,
} from './process-tree-kill.js';
import type { ProcessResult } from './process-host-protocol.js';

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Make process.kill act on a fake process table: SIGKILL removes from it.
 *  Returns the PIDs sent SIGKILL, in order. */
function fakeKill(running: Set<number>): number[] {
  const killed: number[] = [];
  vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
    if (!running.has(pid)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    if (signal === 'SIGKILL') {
      killed.push(pid);
      running.delete(pid);
    }
    return true;
  });
  return killed;
}

function result(fields: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: '', stderr: '', failed: false, timedOut: false, ...fields };
}

function psOutput(entries: ProcessEntry[]): ProcessResult {
  return result({ stdout: entries.map((p) => `${p.pid} ${p.ppid}`).join('\n') });
}

const run = vi.fn<RunCommand>();

beforeEach(() => {
  vi.restoreAllMocks();
  run.mockReset();
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

  it('leaves out a child that its parent check turns down, and what is under it', () => {
    const table = [{ pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 12, ppid: 10 }, { pid: 13, ppid: 12 }];
    expect(treeOf(table, 10, (child) => child.pid !== 12).map((p) => p.pid)).toEqual([10, 11]);
  });

  it('does not loop on a process listed as its own parent', () => {
    expect(treeOf([{ pid: 0, ppid: 0 }, { pid: 4, ppid: 0 }], 0).map((p) => p.pid)).toEqual([0, 4]);
  });
});

describe('listProcessesWith', () => {
  it('reads the table from ps', async () => {
    run.mockResolvedValue(psOutput([{ pid: 1, ppid: 0 }, { pid: 7, ppid: 1 }]));
    expect(await listProcessesWith(run)).toEqual([{ pid: 1, ppid: 0 }, { pid: 7, ppid: 1 }]);
    expect(run).toHaveBeenCalledWith('ps', ['-A', '-o', 'pid=,ppid='], { timeout: 10_000, reject: false });
  });

  it('rejects when ps fails, with what it said', async () => {
    run.mockResolvedValue(result({ failed: true, exitCode: 1, stderr: 'ps: bad option' }));
    await expect(listProcessesWith(run)).rejects.toThrow('ps: bad option');
  });
});

describe('killTreeWith on POSIX', () => {
  it('kills the root and everything under it, parents first', async () => {
    const running = new Set([1, 200, 201, 202, 300]);
    const killed = fakeKill(running);
    run.mockResolvedValue(psOutput([
      { pid: 1, ppid: 0 }, { pid: 200, ppid: 1 }, { pid: 201, ppid: 200 }, { pid: 202, ppid: 201 }, { pid: 300, ppid: 1 },
    ]));

    await expect(killTreeWith(200, run)).resolves.toBeUndefined();
    expect(killed).toEqual([200, 201, 202]);
  });

  it('lists the processes with the list it is given', async () => {
    const killed = fakeKill(new Set([5, 6]));
    const list = vi.fn(() => Promise.resolve([{ pid: 5, ppid: 1 }, { pid: 6, ppid: 5 }]));
    await killTreeWith(5, run, list);
    expect(list).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    expect(killed).toEqual([5, 6]);
  });

  it('still kills the root when processes cannot be listed, and says so', async () => {
    const killed = fakeKill(new Set([400]));
    run.mockRejectedValue(new Error('boom'));

    await expect(killTreeWith(400, run)).resolves.toBe("couldn't list processes, so only 400 was killed: boom");
    expect(killed).toEqual([400]);
  });

  it('never signals PID 0 or its own process', async () => {
    const killed = fakeKill(new Set([0, process.pid]));
    await killTreeWith(0, run);
    await killTreeWith(process.pid, run);
    expect(killed).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('killTreeWith on Windows', () => {
  beforeEach(() => setPlatform('win32'));

  it('kills the tree with System32 taskkill, never PowerShell', async () => {
    run.mockResolvedValue(result({ exitCode: 0 }));

    await expect(killTreeWith(4242, run)).resolves.toBeUndefined();

    expect(run).toHaveBeenCalledOnce();
    const [command, args, opts] = run.mock.calls[0];
    expect(command).toMatch(/\\System32\\taskkill\.exe$/i);
    expect(args).toEqual(['/PID', '4242', '/T', '/F']);
    expect(opts).toEqual({ timeout: 10_000, reject: false });
  });

  it('says so when taskkill fails to run at all', async () => {
    run.mockRejectedValue(new Error('spawn taskkill.exe ENOENT'));
    await expect(killTreeWith(4242, run)).resolves.toBe('taskkill 4242 failed: spawn taskkill.exe ENOENT');
  });

  it('treats a process that already exited as done', async () => {
    run.mockResolvedValue(result({ failed: true, exitCode: 128, stderr: 'ERROR: The process "4242" not found.' }));
    await expect(killTreeWith(4242, run)).resolves.toBeUndefined();
  });

  it('says what any other taskkill failure was', async () => {
    run.mockResolvedValue(result({ failed: true, exitCode: 1, stderr: 'ERROR: Access is denied.' }));
    await expect(killTreeWith(4242, run)).resolves.toBe('taskkill 4242 failed: ERROR: Access is denied.');
  });

  it('says so when taskkill timed out', async () => {
    run.mockResolvedValue(result({ failed: true, timedOut: true }));
    await expect(killTreeWith(4242, run)).resolves.toBe('taskkill 4242 failed: timed out');
  });

  it('never runs taskkill on PID 0 or its own process', async () => {
    await killTreeWith(0, run);
    await killTreeWith(process.pid, run);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('taskkillWith', () => {
  it('kills several trees with one taskkill', async () => {
    run.mockResolvedValue(result({ exitCode: 0 }));
    await taskkillWith([7, 8], run);
    expect(run.mock.calls[0][1]).toEqual(['/PID', '7', '/PID', '8', '/T', '/F']);
  });

  it('runs nothing for no pids', async () => {
    await expect(taskkillWith([], run)).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });
});
