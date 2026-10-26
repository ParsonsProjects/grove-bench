import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// taskkill and ps start in the process host (runToKill), never here.
const mockRun = vi.hoisted(() => vi.fn());
vi.mock('./process-host.js', () => ({ runToKill: mockRun }));
const mockExeca = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: mockExeca }));
const mockFork = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ fork: mockFork }));
const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }));
vi.mock('./logger.js', () => ({ logger }));

import { listProcesses, killDescendants } from './process-tree.js';
import type { ProcessEntry } from './process-tree-kill.js';

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
  mockRun.mockReset();
  mockFork.mockReset();
  setPlatform('linux');
});

afterEach(() => {
  setPlatform(realPlatform);
});

describe('listProcesses', () => {
  it('uses ps, started in the process host', async () => {
    mockRun.mockResolvedValue(psOutput([{ pid: 1, ppid: 0 }]));
    expect(await listProcesses()).toEqual([{ pid: 1, ppid: 0 }]);
    // runToKill: it never waits for a restarting host, and runs again if
    // the host dies under it (process-host-fallback.test.ts).
    expect(mockRun).toHaveBeenCalledWith('ps', ['-A', '-o', 'pid=,ppid='], { timeout: 10_000, reject: false });
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('returns an empty table when the query fails', async () => {
    mockRun.mockRejectedValue(new Error('ps: not found'));
    expect(await listProcesses()).toEqual([]);
  });

  it('returns an empty table when ps fails, and says so', async () => {
    mockRun.mockResolvedValue({ stdout: '', stderr: 'ps: bad option', failed: true, exitCode: 1 });
    expect(await listProcesses()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('[process-tree] could not list processes:', expect.objectContaining({ message: 'ps: bad option' }));
  });

  it('shares one query between concurrent callers', async () => {
    mockRun.mockResolvedValue(psOutput([{ pid: 1, ppid: 0 }]));
    const [a, b] = await Promise.all([listProcesses(), listProcesses()]);
    expect(a).toBe(b);
    expect(mockRun).toHaveBeenCalledOnce();
  });
});

describe('killDescendants on POSIX', () => {
  it('kills everything under the root but not the root', async () => {
    const running = new Set([1, 100, 101, 102]);
    const killed = fakeKill(running);
    mockRun.mockResolvedValue(psOutput([
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
    mockRun.mockResolvedValue({ failed: false, exitCode: 0 });

    expect(await killDescendants(500)).toEqual([700]);

    const [agent, agentArgs] = mockFork.mock.calls[0];
    expect(agent).toMatch(/node-pty[\\/]lib[\\/]conpty_console_list_agent\.js$/);
    expect(agentArgs).toEqual(['500']);
    const [command, args, opts] = mockRun.mock.calls[0];
    expect(command).toMatch(/\\System32\\taskkill\.exe$/i);
    expect(args).toEqual(['/PID', '700', '/T', '/F']);
    expect(opts).toEqual({ timeout: 10_000, reject: false });
  });

  it('logs a taskkill that failed', async () => {
    fakeHelper([9000, 700, 500]);
    mockRun.mockResolvedValue({ failed: true, exitCode: 1, stderr: 'ERROR: Access is denied.' });
    expect(await killDescendants(500)).toEqual([700]);
    expect(logger.warn).toHaveBeenCalledWith('[process-tree] taskkill 700 failed: ERROR: Access is denied.');
  });

  it('runs nothing when only the shell is on the console', async () => {
    fakeHelper([9000, 500]);
    expect(await killDescendants(500)).toEqual([]);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('kills nothing when the console cannot be read', async () => {
    fakeHelper(null);
    expect(await killDescendants(500)).toEqual([]);
    expect(mockRun).not.toHaveBeenCalled();
  });
});
