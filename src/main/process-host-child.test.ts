/**
 * The process host's own process (process-host-child.ts), on a stand-in for
 * the port Electron gives a utility process. It kills the trees of the
 * processes it starts with taskkill (ps off Windows) run from there, through
 * execa: real here, its calls recorded.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { HOST_READY, isSpawnEvent, type SpawnEvent } from './process-host-protocol.js';
import { isRunning, TREE_SCRIPT } from './__mocks__/process-trees.js';

const execaCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock('execa', async (importOriginal) => {
  // Typed loosely: typeof import('execa') runs ESLint's type-aware lint out
  // of memory.
  const actual = await importOriginal<{ execa: (...args: unknown[]) => unknown }>();
  return { execa: (...args: unknown[]) => { execaCalls.push(args); return actual.execa(...args); } };
});

/** Real processes a test started, to stop if a failed test left them running. */
const startedPids: number[] = [];

afterEach(() => {
  delete (process as { parentPort?: unknown }).parentPort;
  execaCalls.length = 0;
  for (const pid of startedPids.splice(0)) if (isRunning(pid)) process.kill(pid);
});

/** Load the host's script as a utility process runs it: with a port to the
 *  main process, which keeps what the host posts. */
async function startHost() {
  const posted: unknown[] = [];
  let listener: ((event: { data: unknown }) => void) | undefined;
  (process as { parentPort?: unknown }).parentPort = {
    on: (_event: 'message', l: (event: { data: unknown }) => void) => { listener = l; },
    postMessage: (message: unknown) => { posted.push(message); },
  };
  vi.resetModules();
  await import('./process-host-child.js');
  return {
    posted,
    send: (data: unknown) => listener?.({ data }),
    events: () => posted.filter(isSpawnEvent),
  };
}

describe('process host (its own process)', () => {
  it('says it is ready, once it can take requests', async () => {
    const { posted } = await startHost();
    expect(posted).toEqual([HOST_READY]);
  });

  it('kills a process it started, and the process that one started, from here, before the close', async () => {
    const host = await startHost();
    host.send({ type: 'spawn', id: 1, file: process.execPath, args: ['-e', TREE_SCRIPT], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    let child = 0;
    let grandchild = 0;
    await vi.waitFor(() => {
      const spawned = host.events().find((e): e is Extract<SpawnEvent, { type: 'spawned' }> => e.type === 'spawned');
      const printed = host.events().filter((e): e is Extract<SpawnEvent, { data: string }> => e.type === 'stdout').map((e) => e.data).join('');
      if (!spawned || !printed.includes('\n')) throw new Error("The process hasn't printed its child's pid yet");
      child = spawned.pid;
      grandchild = Number(printed.trim());
    }, { timeout: 10_000 });
    expect(grandchild).toBeGreaterThan(0);
    startedPids.push(child, grandchild);

    host.send({ type: 'kill-tree', id: 1 });
    await vi.waitFor(() => expect(host.events().at(-1)).toEqual({ type: 'close', id: 1 }), { timeout: 15_000 });

    expect(host.events()).toContainEqual({ type: 'tree-killed', id: 1, killed: true });
    await expect.poll(() => isRunning(grandchild), { timeout: 5_000 }).toBe(false);
    // With execa, here: the kill's time limit, and its result read however
    // it exits (taskkill exits 128 for a process that has just exited).
    expect(execaCalls).toContainEqual(process.platform === 'win32'
      ? [expect.stringMatching(/\\System32\\taskkill\.exe$/i), ['/PID', String(child), '/T', '/F'], { timeout: 10_000, reject: false }]
      : ['ps', ['-A', '-o', 'pid=,ppid='], { timeout: 10_000, reject: false }]);
  }, 30_000);
});
