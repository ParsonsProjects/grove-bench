import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSpawnRunner, HostedProcess, type ProcessCommand } from './process-host-spawn.js';

// The submodule setup starts in the agent host (spawnProcess), never here.
const hosted = vi.hoisted(() => ({ spawnProcess: vi.fn() }));
vi.mock('./process-host.js', () => ({ spawnProcess: hosted.spawnProcess }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { hasSubmodules, initSubmodules, submoduleArgs, SUBMODULE_TIMEOUT_MS } from './worktree-submodules.js';

/** A running `git submodule update`, driven by the test as the host would
 *  drive it, and what it was sent once `connect`ed. */
function fakeGit() {
  const proc = new HostedProcess('git submodule update');
  hosted.spawnProcess.mockReturnValue(proc);
  const send = (event: Parameters<HostedProcess['receive']>[0]) => proc.receive(event);
  const sent: ProcessCommand[] = [];
  return {
    proc,
    sent,
    connect: () => proc.connect((command) => sent.push(command)),
    started: () => send({ type: 'spawned', id: 1, pid: 4321, launchMs: 5 }),
    stderr: (data: string) => send({ type: 'stderr', id: 1, data }),
    exit: (code: number | null, signal: string | null = null) => {
      send({ type: 'exit', id: 1, code, signal });
      send({ type: 'close', id: 1 });
    },
  };
}

/** spawnProcess as the agent host's fallback runs it: for real, here. */
function spawnForReal() {
  hosted.spawnProcess.mockImplementation((file: string, args: string[], options: object) => {
    const proc = new HostedProcess(file);
    const runner = createSpawnRunner((event) => proc.receive(event), () => Promise.resolve(undefined), spawn);
    runner.handle({ type: 'spawn', id: 1, file, args, ...options });
    proc.connect((command) => runner.handle({ ...command, id: 1 }));
    return proc;
  });
}

let tmp: string;
beforeEach(() => {
  vi.clearAllMocks();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-submodules-'));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('hasSubmodules', () => {
  it('is true only when the worktree has a .gitmodules file', async () => {
    expect(await hasSubmodules(tmp)).toBe(false);
    fs.mkdirSync(path.join(tmp, '.gitmodules'));
    expect(await hasSubmodules(tmp)).toBe(false);
    fs.rmdirSync(path.join(tmp, '.gitmodules'));
    fs.writeFileSync(path.join(tmp, '.gitmodules'), '[submodule "lib"]\n');
    expect(await hasSubmodules(tmp)).toBe(true);
  });
});

describe('initSubmodules', () => {
  it('checks out every level, or the top one only', () => {
    expect(submoduleArgs('all')).toEqual(['submodule', 'update', '--init', '--recursive']);
    expect(submoduleArgs('top')).toEqual(['submodule', 'update', '--init']);
  });

  it('runs git in the agent host, in the worktree, with no terminal prompt', async () => {
    const git = fakeGit();
    const done = initSubmodules('/wt', 'all', new AbortController().signal);
    git.started();
    git.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenCalledWith('git', ['submodule', 'update', '--init', '--recursive'], {
      cwd: '/wt', env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0' }), stdout: 'ignore',
    });
  });

  it("rejects with git's error output when it fails", async () => {
    const git = fakeGit();
    const done = initSubmodules('/wt', 'all', new AbortController().signal);
    git.started();
    git.stderr("fatal: repository 'https://example.com/lib.git/' not found");
    // Stream data comes on the next tick, as from the host.
    await new Promise((r) => setImmediate(r));
    git.exit(128);
    await expect(done).rejects.toMatchObject({ exitCode: 128, stderr: "fatal: repository 'https://example.com/lib.git/' not found" });
  });

  it('kills the whole tree on abort and rejects with the abort', async () => {
    const git = fakeGit();
    git.connect();
    const abort = new AbortController();
    const done = initSubmodules('/wt', 'all', abort.signal);
    git.started();

    abort.abort();
    expect(git.sent).toEqual([{ type: 'kill-tree' }]);
    git.proc.receive({ type: 'tree-killed', id: 1, killed: true });
    git.exit(null, 'SIGKILL');

    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('is stopped after the time limit, and says so', async () => {
    vi.useFakeTimers();
    const git = fakeGit();
    git.connect();
    const done = initSubmodules('/wt', 'all', new AbortController().signal);
    const failed = expect(done).rejects.toThrow(/took over 10 minutes/);
    git.started();

    await vi.advanceTimersByTimeAsync(SUBMODULE_TIMEOUT_MS);
    expect(git.sent).toEqual([{ type: 'kill-tree' }]);
    git.exit(null, 'SIGKILL');

    await failed;
  });

  it('fills the empty submodule folders git worktree add leaves (real git)', async () => {
    spawnForReal();
    const run = (cwd: string, ...args: string[]) => execFileSync('git', args, {
      cwd,
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
      stdio: 'pipe',
    });
    const lib = path.join(tmp, 'lib');
    const app = path.join(tmp, 'app');
    const wt = path.join(tmp, 'wt');
    fs.mkdirSync(lib);
    run(lib, 'init', '-q');
    fs.writeFileSync(path.join(lib, 'index.ts'), 'export const x = 1;\n');
    run(lib, 'add', '.');
    run(lib, 'commit', '-qm', 'lib');
    fs.mkdirSync(app);
    run(app, 'init', '-q');
    fs.writeFileSync(path.join(app, 'README'), 'app\n');
    run(app, 'add', '.');
    run(app, 'commit', '-qm', 'app');
    // A submodule at a local path needs the file protocol allowed (git
    // refuses it by default since 2.38.1); a real project's are URLs.
    run(app, '-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', lib, 'vendor/lib');
    run(app, 'commit', '-qm', 'submodule');
    run(app, 'worktree', 'add', '-q', '-b', 'feat', wt);
    expect(fs.readdirSync(path.join(wt, 'vendor/lib'))).toEqual([]);

    const env = { GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0 };
    Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always' });
    try {
      await initSubmodules(wt, 'all', new AbortController().signal);
    } finally {
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(fs.readdirSync(path.join(wt, 'vendor/lib'))).toContain('index.ts');
  });
});
