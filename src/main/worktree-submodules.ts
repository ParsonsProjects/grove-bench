/**
 * Submodules in a new worktree. `git worktree add` checks out the project's
 * files but leaves its submodules as empty folders: "the support for
 * submodules is incomplete" (git-worktree, Bugs). A thread would then start
 * on an incomplete copy, with missing imports and failing builds, and an
 * agent might "fix" those by writing the missing code itself. So when the
 * project has a .gitmodules file, and Settings > Git & worktrees asks for it
 * (it is off by default: checkpoints and rewind don't cover the files inside
 * a submodule yet), this checks them out in the worktree, with --recursive
 * for submodules inside submodules.
 *
 * Without `--init`, which would write each submodule's url and `active`
 * into the project's .git/config, shared by the project folder and every
 * worktree. `-c submodule.active=.` marks them all active for this command
 * only, and git takes the url from .gitmodules, relative ones included, when
 * the config has none (git since 2.13; Grove needs 2.23). git hands `-c` on
 * to the nested levels, whose own config is fresh, so they are all checked
 * out too. A project that has `submodule.active` set (git clone
 * --recurse-submodules=<pathspec> does that) gets those pathspecs passed on,
 * so only the submodules it picked are checked out, as `--init` would. A
 * submodule's own clone lives under the worktree's git dir
 * (.git/worktrees/<id>/modules), so worktrees never share one, and setups
 * running at once don't contend for a lock.
 *
 * It fetches each submodule from its URL, so it can take a while and may
 * need the network or a sign-in. Like a dependency install it starts in the
 * agent host (spawnProcess), so the launch can't hold up the window, and an
 * abort (the thread deleted during setup) kills the whole tree. There is no
 * terminal prompt (GIT_TERMINAL_PROMPT=0) and, unless the user picked their
 * own ssh, ssh asks nothing either (BatchMode): a question nobody can answer
 * would hang it. A credential manager's own sign-in window still shows. With
 * --progress git keeps writing while a clone downloads, so it is stopped
 * once it has written nothing for SUBMODULE_IDLE_MS, however long a big
 * clone takes.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnProcess } from './process-host.js';
import { git } from './git.js';
import { logger } from './logger.js';
import type { SubmoduleSetup } from '../shared/types.js';

/** How long git may write nothing before the setup is stopped. */
export const SUBMODULE_IDLE_MS = 5 * 60_000;

/** The most lines of git's output a failure shows. */
const MAX_ERROR_LINES = 20;

/** What a failed setup rejects with. Its message, git's output without its
 *  progress, is what the thread shows. */
export class SubmoduleSetupError extends Error {
  constructor(message: string, readonly exitCode?: number) {
    super(message);
    this.name = 'SubmoduleSetupError';
  }
}

/** Whether the worktree's project lists submodules (a .gitmodules file). */
export async function hasSubmodules(cwd: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(cwd, '.gitmodules'))).isFile();
  } catch {
    return false;
  }
}

/** The settings in the project's git config that change how it runs. */
export interface SubmoduleConfig {
  /** `submodule.active`'s pathspecs: which submodules the project wants. */
  active: string[];
  /** Whether `core.sshCommand` is set: the user's own ssh, left as it is. */
  sshCommand: boolean;
}

/** Read them, from the worktree. None set (git exits 1) reads as none. */
export async function readSubmoduleConfig(cwd: string): Promise<SubmoduleConfig> {
  let out = '';
  try {
    // --null: "key\nvalue\0", so a value may hold spaces or newlines. Keys
    // come back in lower case.
    out = await git(['config', '--null', '--get-regexp', '^(submodule\\.active|core\\.sshcommand)$'], cwd);
  } catch { /* none set */ }
  const config: SubmoduleConfig = { active: [], sshCommand: false };
  for (const entry of out.split('\0')) {
    const newline = entry.indexOf('\n');
    const key = newline === -1 ? entry : entry.slice(0, newline);
    const value = newline === -1 ? '' : entry.slice(newline + 1);
    if (key === 'submodule.active' && value) config.active.push(value);
    else if (key === 'core.sshcommand') config.sshCommand = true;
  }
  return config;
}

/** git's arguments for `mode`: every level ('all') or the top one only,
 *  limited to the project's `submodule.active` pathspecs when it has any. */
export function submoduleArgs(mode: Exclude<SubmoduleSetup, 'off'>, active: string[] = []): string[] {
  return [
    '-c', 'submodule.active=.', 'submodule', 'update', '--progress',
    ...(mode === 'all' ? ['--recursive'] : []),
    ...(active.length > 0 ? ['--', ...active] : []),
  ];
}

/** The environment git runs in: no prompts. ssh's own questions (host key,
 *  key passphrase) are turned off too, unless the user runs their own ssh
 *  (GIT_SSH_COMMAND, GIT_SSH or core.sshCommand), which is left alone. */
export function submoduleEnv(env: NodeJS.ProcessEnv, config: SubmoduleConfig): Record<string, string | undefined> {
  const ownSsh = Boolean(env.GIT_SSH_COMMAND || env.GIT_SSH || config.sshCommand);
  return { ...env, GIT_TERMINAL_PROMPT: '0', ...(ownSsh ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }) };
}

/** The command, as the user would type it in the Terminal tab. */
export function commandLine(args: string[]): string {
  return ['git', ...args.map((a) => (/^[\w./:=@+-]+$/.test(a) ? a : `"${a}"`))].join(' ');
}

/** Progress git rewrites in place ("Receiving objects:  45% (450/1000)"),
 *  the server's counts ("remote: Total 12 (delta 0)…") and the lines a
 *  clone that worked writes. In git's own words, so other languages keep
 *  theirs, which does no harm. */
const NOISE = [
  /^(remote: )?[^:]+: +\d+% \(\d+\/\d+\)/,
  /^remote: [^:]+: +\d+(, done\.)?$/,
  /^remote: Total \d+/,
  /^Cloning into '.*'\.\.\.$/,
  /^done\.$/,
];

/** Keeps the lines of git's error output worth showing: not its progress,
 *  and not those for clones that worked. Fed as it arrives. */
export class GitOutput {
  private lines: string[] = [];
  private partial = '';

  add(chunk: string): void {
    const parts = (this.partial + chunk).split('\n');
    this.partial = parts.pop() ?? '';
    for (const part of parts) this.keep(part);
  }

  /** What was kept, its last MAX_ERROR_LINES lines. */
  text(): string {
    if (this.partial) this.keep(this.partial);
    this.partial = '';
    return this.lines.slice(-MAX_ERROR_LINES).join('\n');
  }

  private keep(line: string): void {
    // A line rewritten with \r shows its last version.
    const shown = line.split('\r').filter((s) => s.trim()).pop()?.trim();
    if (!shown || NOISE.some((re) => re.test(shown))) return;
    this.lines.push(shown);
    // Only the last ones are shown.
    if (this.lines.length > MAX_ERROR_LINES * 2) this.lines = this.lines.slice(-MAX_ERROR_LINES);
  }
}

/**
 * Check out the submodules in a new worktree with `args` (submoduleArgs).
 * Rejects with a SubmoduleSetupError, holding git's output without its
 * progress, when git fails or writes nothing for SUBMODULE_IDLE_MS, and
 * with the signal's reason when aborted. Both of those reject at once,
 * without waiting for git to end: should the kill fail, the setup goes on
 * all the same.
 */
export function initSubmodules(cwd: string, args: string[], env: Record<string, string | undefined>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  // stdout 'ignore': git writes its progress and errors to stderr.
  // agentOutput false: git isn't an agent, so the health line leaves it out.
  const proc = spawnProcess('git', args, { cwd, env, stdout: 'ignore', agentOutput: false });
  const output = new GitOutput();
  const kill = () => {
    proc.killTree().catch((e: unknown) => logger.warn(`Failed to stop the submodule setup in ${cwd}:`, e));
  };
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      proc.off('spawn', idle);
      if (error) reject(error);
      else resolve();
    };
    // The idle time counts from git's start, not while the agent host
    // starts (spawnProcess bounds that wait), and from its last output.
    const idle = () => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        kill();
        const minutes = SUBMODULE_IDLE_MS / 60_000;
        const text = output.text();
        settle(new SubmoduleSetupError(`git wrote nothing for ${minutes} minutes, so it was stopped.${text ? `\n${text}` : ''}`));
      }, SUBMODULE_IDLE_MS);
    };
    const onAbort = () => {
      kill();
      settle(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (proc.pid !== undefined) idle();
    else proc.once('spawn', idle);
    proc.stderr.on('data', (chunk: string) => {
      output.add(chunk);
      if (timer !== undefined) idle();
    });
    let startError: Error | undefined;
    proc.on('error', (e: Error) => { startError ??= e; });
    proc.once('close', (code: number | null, closeSignal: NodeJS.Signals | null) => {
      if (startError) settle(startError);
      else if (code === 0) settle();
      else {
        const text = output.text();
        const how = code === null ? `git was stopped${closeSignal ? ` (${closeSignal})` : ''}.` : `git exited with code ${code}.`;
        settle(new SubmoduleSetupError(text || how, code ?? undefined));
      }
    });
  });
}
