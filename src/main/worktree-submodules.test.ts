import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSpawnRunner, HostedProcess, type ProcessCommand } from './process-host-spawn.js';

// The submodule setup starts in the agent host (spawnProcess), never here.
const hosted = vi.hoisted(() => ({ spawnProcess: vi.fn() }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// git's config is read through the git host; here, by running git.
vi.mock('./process-host.js', async () => {
  const { execa } = await import('execa');
  return {
    spawnProcess: hosted.spawnProcess,
    runProcess: (file: string, args: string[], options: { cwd?: string }) => execa(file, args, { cwd: options.cwd }),
    isSkipped: () => false,
  };
});

import {
  commandLine, GitOutput, hasSubmodules, initSubmodules, readSubmoduleConfig, submoduleArgs, submoduleEnv, SUBMODULE_IDLE_MS,
} from './worktree-submodules.js';

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

const ARGS = submoduleArgs('all');
const ENV = { GIT_TERMINAL_PROMPT: '0' };

describe('submoduleArgs', () => {
  it('marks every submodule active for this command only, rather than writing --init into the config', () => {
    expect(submoduleArgs('all')).toEqual(['-c', 'submodule.active=.', 'submodule', 'update', '--progress', '--recursive']);
    expect(submoduleArgs('top')).toEqual(['-c', 'submodule.active=.', 'submodule', 'update', '--progress']);
  });

  it("keeps to the project's submodule.active pathspecs", () => {
    expect(submoduleArgs('top', ['libs/a', ':(exclude)libs/b'])).toEqual(['-c', 'submodule.active=.', 'submodule', 'update', '--progress', '--', 'libs/a', ':(exclude)libs/b']);
  });

  it('writes the command as it would be typed, quoting what a shell would split', () => {
    expect(commandLine(submoduleArgs('top', ['libs/my lib', ':(exclude)x']))).toBe('git -c submodule.active=. submodule update --progress -- "libs/my lib" ":(exclude)x"');
  });
});

describe('submoduleEnv', () => {
  const none = { active: [], sshCommand: false };

  it('has no terminal prompt, and ssh asks nothing either', () => {
    expect(submoduleEnv({ PATH: '/bin' }, none)).toEqual({ PATH: '/bin', GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' });
  });

  it("leaves the user's own ssh alone", () => {
    expect(submoduleEnv({ GIT_SSH_COMMAND: 'ssh -i key' }, none).GIT_SSH_COMMAND).toBe('ssh -i key');
    expect(submoduleEnv({ GIT_SSH: 'plink.exe' }, none)).not.toHaveProperty('GIT_SSH_COMMAND');
    expect(submoduleEnv({}, { active: [], sshCommand: true })).not.toHaveProperty('GIT_SSH_COMMAND');
  });
});

describe('GitOutput', () => {
  it("keeps git's errors, not its progress or the clones that worked", () => {
    const out = new GitOutput();
    out.add("Cloning into '/wt/vendor/a'...\nremote: Enumerating objects: 12, done.\nremote: Counting objects:  50% (6/12)\rremote: Counting objects: 100% (12/12), done.\n");
    out.add('remote: Total 12 (delta 0), reused 0 (delta 0), pack-reused 0\nReceiving objects:  10% (1/12)\rReceiving objects: 100% (12/12), 4.00 KiB | 4.00 MiB/s, done.\n');
    out.add("Cloning into '/wt/vendor/b'...\ngit@example.com: Permission denied (publickey).\r\nfatal: Could not read from remote repo");
    out.add("sitory.\nfatal: clone of 'git@example.com:b.git' into submodule path '/wt/vendor/b' failed");
    expect(out.text()).toBe([
      'git@example.com: Permission denied (publickey).',
      'fatal: Could not read from remote repository.',
      "fatal: clone of 'git@example.com:b.git' into submodule path '/wt/vendor/b' failed",
    ].join('\n'));
  });

  it('keeps the last lines only', () => {
    const out = new GitOutput();
    for (let i = 1; i <= 100; i++) out.add(`error: ${i}\n`);
    const lines = out.text().split('\n');
    expect(lines).toHaveLength(20);
    expect(lines.at(-1)).toBe('error: 100');
  });
});

describe('initSubmodules', () => {
  it('runs git in the agent host, in the worktree, as not an agent', async () => {
    const git = fakeGit();
    const done = initSubmodules('/wt', ARGS, ENV, new AbortController().signal);
    git.started();
    git.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenCalledWith('git', ARGS, { cwd: '/wt', env: ENV, stdout: 'ignore', agentOutput: false });
  });

  it("rejects with git's error output when it fails", async () => {
    const git = fakeGit();
    const done = initSubmodules('/wt', ARGS, ENV, new AbortController().signal);
    git.started();
    git.stderr("Cloning into '/wt/lib'...\nfatal: repository 'https://example.com/lib.git/' not found\n");
    // Stream data comes on the next tick, as from the host.
    await new Promise((r) => setImmediate(r));
    git.exit(128);
    await expect(done).rejects.toMatchObject({ name: 'SubmoduleSetupError', exitCode: 128, message: "fatal: repository 'https://example.com/lib.git/' not found" });
  });

  it('kills the whole tree on abort, and rejects at once', async () => {
    const git = fakeGit();
    git.connect();
    const abort = new AbortController();
    const done = initSubmodules('/wt', ARGS, ENV, abort.signal);
    git.started();

    abort.abort();
    expect(git.sent).toEqual([{ type: 'kill-tree' }]);
    // No answer to the kill, and no exit: it doesn't wait for one.
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('is stopped once git writes nothing for a while, counted from its start and its last output', async () => {
    vi.useFakeTimers();
    const git = fakeGit();
    git.connect();
    const done = initSubmodules('/wt', ARGS, ENV, new AbortController().signal);
    const failed = expect(done).rejects.toThrow(/wrote nothing for 5 minutes, so it was stopped\.\nfatal: early hang up/);

    // Waiting for the host doesn't count.
    await vi.advanceTimersByTimeAsync(SUBMODULE_IDLE_MS);
    git.started();
    await vi.advanceTimersByTimeAsync(SUBMODULE_IDLE_MS - 1000);
    git.stderr('fatal: early hang up\nReceiving objects:  10% (1/12)\r');
    await vi.advanceTimersByTimeAsync(SUBMODULE_IDLE_MS - 1000);
    expect(git.sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(git.sent).toEqual([{ type: 'kill-tree' }]);
    // It rejects without waiting for git to end.
    await failed;
  });
});

describe('with real git', () => {
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    stdio: 'pipe',
  }).toString();

  /** A repo with one commit holding `file`. */
  function repo(dir: string, file: string): string {
    fs.mkdirSync(dir);
    run(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, file), `${file}\n`);
    run(dir, 'add', '.');
    run(dir, 'commit', '-qm', file);
    return dir;
  }

  /** A project with a submodule at vendor/lib, by a relative URL, which has
   *  one of its own at deep; its clone's .git/config with no submodule in
   *  it; and a new worktree of it, at wt. */
  function project() {
    // A submodule at a local path needs the file protocol allowed (git
    // refuses it by default since 2.38.1); a real project's are URLs.
    const g = (cwd: string, ...args: string[]) => run(cwd, '-c', 'protocol.file.allow=always', ...args);
    const lib = repo(path.join(tmp, 'lib'), 'index.ts');
    g(lib, 'submodule', '--quiet', 'add', repo(path.join(tmp, 'inner'), 'deep.ts'), 'deep');
    run(lib, 'commit', '-qm', 'deep');
    run(tmp, 'clone', '-q', '--bare', lib, 'lib.git');
    const origin = repo(path.join(tmp, 'origin'), 'README');
    run(tmp, 'clone', '-q', '--bare', origin, 'app.git');
    run(tmp, 'clone', '-q', 'app.git', 'app');
    const app = path.join(tmp, 'app');
    g(app, 'submodule', '--quiet', 'add', '../lib.git', 'vendor/lib');
    run(app, 'commit', '-qm', 'submodule');
    // As if cloned without --recurse-submodules.
    run(app, 'config', '--remove-section', 'submodule.vendor/lib');
    const wt = path.join(tmp, 'wt');
    run(app, 'worktree', 'add', '-q', '-b', 'feat', wt);
    return { app, wt };
  }

  async function setUp(wt: string, mode: 'all' | 'top') {
    spawnForReal();
    const config = await readSubmoduleConfig(wt);
    const env = { ...submoduleEnv(process.env, config), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always' };
    await initSubmodules(wt, submoduleArgs(mode, config.active), env, new AbortController().signal);
  }

  const submoduleConfig = (app: string) => run(app, 'config', '--local', '--list').split('\n').filter((l) => l.startsWith('submodule.'));

  it("fills the empty folders git worktree add leaves, every level, without changing the project's config", async () => {
    const { app, wt } = project();
    expect(fs.readdirSync(path.join(wt, 'vendor/lib'))).toEqual([]);
    expect(submoduleConfig(app)).toEqual([]);

    await setUp(wt, 'all');

    expect(fs.readdirSync(path.join(wt, 'vendor/lib'))).toContain('index.ts');
    expect(fs.readdirSync(path.join(wt, 'vendor/lib/deep'))).toContain('deep.ts');
    expect(submoduleConfig(app)).toEqual([]);
    // Its clone is the worktree's own.
    expect(fs.existsSync(path.join(app, '.git/worktrees/wt/modules/vendor/lib'))).toBe(true);
  });

  it('checks out the top level only, when asked', async () => {
    const { wt } = project();
    await setUp(wt, 'top');
    expect(fs.readdirSync(path.join(wt, 'vendor/lib'))).toContain('index.ts');
    expect(fs.readdirSync(path.join(wt, 'vendor/lib/deep'))).toEqual([]);
  });

  it("leaves out what the project's submodule.active leaves out", async () => {
    const { app, wt } = project();
    run(app, 'config', 'submodule.active', ':(exclude)vendor/lib');
    run(app, 'config', 'core.sshCommand', 'ssh -i key');
    expect(await readSubmoduleConfig(wt)).toEqual({ active: [':(exclude)vendor/lib'], sshCommand: true });

    await setUp(wt, 'all');
    expect(fs.readdirSync(path.join(wt, 'vendor/lib'))).toEqual([]);
  });
});
