import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const mockExeca = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: mockExeca }));
const mockFork = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ fork: mockFork }));
const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }));
vi.mock('./logger.js', () => ({ logger }));

import {
  parseProcessList, treeOf, listProcesses, killTree, killDescendants,
  type ProcessEntry,
} from './process-tree.js';

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Make process.kill act on a fake process table: SIGKILL removes from it.
 *  Returns the PIDs sent SIGKILL, in order. */
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
  return { stdout: entries.map((p) => `${p.pid} ${p.ppid}`).join('\n') };
}

/** The next fork() returns a console-list helper that replies with `list`
 *  (or fails without replying), then closes. */
function fakeHelper(list: number[] | null, pid = 9000) {
  const helper = Object.assign(new EventEmitter(), { pid, kill: vi.fn() });
  mockFork.mockImplementationOnce(() => {
    setTimeout(() => {
      if (list) helper.emit('message', { consoleProcessList: list });
      helper.emit('close', list ? 0 : 1);
    });
    return helper;
  });
  return helper;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockExeca.mockReset();
  mockFork.mockReset();
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

  it('does not loop on a process listed as its own parent', () => {
    expect(treeOf([{ pid: 0, ppid: 0 }, { pid: 4, ppid: 0 }], 0).map((p) => p.pid)).toEqual([0, 4]);
  });
});

describe('listProcesses', () => {
  it('uses ps', async () => {
    mockExeca.mockResolvedValue(psOutput([{ pid: 1, ppid: 0 }]));
    expect(await listProcesses()).toEqual([{ pid: 1, ppid: 0 }]);
    expect(mockExeca).toHaveBeenCalledWith('ps', ['-A', '-o', 'pid=,ppid='], expect.any(Object));
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

describe('killTree on POSIX', () => {
  it('kills the root and everything under it, parents first', async () => {
    const running = new Set([1, 200, 201, 202, 300]);
    const killed = fakeKill(running);
    mockExeca.mockResolvedValue(psOutput([
      { pid: 1, ppid: 0 }, { pid: 200, ppid: 1 }, { pid: 201, ppid: 200 }, { pid: 202, ppid: 201 }, { pid: 300, ppid: 1 },
    ]));

    await killTree(200);
    expect(killed).toEqual([200, 201, 202]);
  });

  it('still kills the root when processes cannot be listed', async () => {
    const killed = fakeKill(new Set([400]));
    mockExeca.mockRejectedValue(new Error('boom'));

    await killTree(400);
    expect(killed).toEqual([400]);
  });

  it('never signals PID 0 or its own process', async () => {
    const killed = fakeKill(new Set([0, process.pid]));
    await killTree(0);
    await killTree(process.pid);
    expect(killed).toEqual([]);
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('killTree on Windows', () => {
  beforeEach(() => setPlatform('win32'));

  it('kills the tree with System32 taskkill, never PowerShell', async () => {
    mockExeca.mockResolvedValue({ failed: false, exitCode: 0 });

    await killTree(4242);

    expect(mockExeca).toHaveBeenCalledOnce();
    const [command, args, opts] = mockExeca.mock.calls[0];
    expect(command).toMatch(/\\System32\\taskkill\.exe$/i);
    expect(args).toEqual(['/PID', '4242', '/T', '/F']);
    expect(opts).toMatchObject({ windowsHide: true, reject: false });
  });

  it('treats a process that already exited as done', async () => {
    mockExeca.mockResolvedValue({ failed: true, exitCode: 128, stderr: 'ERROR: The process "4242" not found.' });
    await killTree(4242);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs any other taskkill failure', async () => {
    mockExeca.mockResolvedValue({ failed: true, exitCode: 1, stderr: 'ERROR: Access is denied.' });
    await killTree(4242);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('4242'), 'ERROR: Access is denied.');
  });
});

describe('killDescendants on POSIX', () => {
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

describe('killDescendants on Windows', () => {
  beforeEach(() => setPlatform('win32'));

  it("kills the tree of everything on the shell's console, leaving the shell", async () => {
    // Console: the helper itself (9000), a dev server (700) and the shell (500).
    fakeHelper([9000, 700, 500]);
    mockExeca.mockResolvedValue({ failed: false, exitCode: 0 });

    expect(await killDescendants(500)).toEqual([700]);

    const [agent, agentArgs] = mockFork.mock.calls[0];
    expect(agent).toMatch(/node-pty[\\/]lib[\\/]conpty_console_list_agent\.js$/);
    expect(agentArgs).toEqual(['500']);
    const [command, args] = mockExeca.mock.calls[0];
    expect(command).toMatch(/\\System32\\taskkill\.exe$/i);
    expect(args).toEqual(['/PID', '700', '/T', '/F']);
  });

  it('runs nothing when only the shell is on the console', async () => {
    fakeHelper([9000, 500]);
    expect(await killDescendants(500)).toEqual([]);
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('kills nothing when the console cannot be read', async () => {
    fakeHelper(null);
    expect(await killDescendants(500)).toEqual([]);
    expect(mockExeca).not.toHaveBeenCalled();
  });
});
