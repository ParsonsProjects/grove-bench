import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnProcess, type HostedProcess } from './process-host.js';
import { logger } from './logger.js';

/** A package manager a new worktree's dependencies are installed with. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** Lockfiles (and pnpm's workspace file) and the package manager each
 *  belongs to, in the order package-manager-detector looks for them, so a
 *  project with two gets the one other tools pick. */
const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['pnpm-workspace.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

const INSTALL_ARGS: Record<PackageManager, readonly string[]> = {
  // --no-audit: npm otherwise sends the whole tree to the registry after
  // the install and waits for the audit report. --no-fund: the funding
  // message nobody sees here.
  npm: ['install', '--prefer-offline', '--no-audit', '--no-fund'],
  pnpm: ['install', '--prefer-offline'],
  // Yarn 4 says --prefer-offline is deprecated for install.
  yarn: ['install'],
  bun: ['install'],
};

function isPackageManager(name: string): name is PackageManager {
  return Object.hasOwn(INSTALL_ARGS, name);
}

/**
 * The package manager a project uses: its lockfile's, else the one
 * package.json names in `packageManager` (`"pnpm@9.1.0"`), else npm. Running
 * npm in a pnpm or Yarn project would resolve every dependency again with no
 * lockfile to go on, and leave a package-lock.json in the worktree.
 */
export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const names = new Set(await fs.readdir(cwd).catch((): string[] => []));
  const lockfile = LOCKFILES.find(([file]) => names.has(file));
  if (lockfile) return lockfile[1];
  try {
    const { packageManager } = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8')) as { packageManager?: unknown };
    const name = typeof packageManager === 'string' ? packageManager.split('@')[0] : '';
    if (isPackageManager(name)) return name;
  } catch { /* unreadable: npm, as before */ }
  return 'npm';
}

/**
 * Install a new worktree's dependencies with `manager`, from the user's own
 * cache: npm's is %LocalAppData%\npm-cache unless they moved it (to a Dev
 * Drive, say), and it already holds what the main checkout installed.
 *
 * It starts in the agent host (spawnProcess), so the launch (cmd.exe running
 * npm's .cmd shim) never holds up the window. That host, unlike the one git
 * runs in, isn't restarted when a command goes unanswered, so a long install
 * isn't stopped by someone else's hung command.
 *
 * Aborting kills the whole install tree, not just the child: on Windows npm
 * runs under cmd.exe, and killing only that would leave npm's node process
 * holding files in a worktree that is about to be removed. Rejects with the
 * signal's reason when aborted.
 */
export async function installDependencies(cwd: string, manager: PackageManager, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const args = [...INSTALL_ARGS[manager]];
  // findCommand: find the package manager on PATH (npm's .cmd shim, say)
  // and run a shim through cmd.exe, its arguments escaped, as execa does.
  // stdout 'ignore': its progress stays in the agent host. Nobody reads it,
  // and sent here it would be timed as agent output in the freeze log and
  // health line.
  const install = spawnProcess(manager, args, { cwd, findCommand: true, stdout: 'ignore' });
  // Killed by the agent host, which has it: before the host says it has
  // started too.
  const onAbort = () => {
    install.killTree().catch((e: unknown) => logger.warn(`Failed to stop ${manager} install in ${cwd}:`, e));
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await finished(install, `${manager} ${args.join(' ')}`);
  } catch (e) {
    // Killed because of the abort: report the cancel, not the kill.
    signal.throwIfAborted();
    throw e;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Wait for a spawned command to end. Resolves when it exits with 0;
 * otherwise rejects as execa did, with `exitCode` and what it wrote to
 * stderr (which the caller shows), or with the error that kept it from
 * starting: `code` ENOENT when the package manager isn't installed, which the
 * caller skips quietly. On Windows too, where cmd.exe runs the missing one
 * and exits 1 ("is not recognized"): the agent host reports that as ENOENT
 * (createSpawnRunner).
 */
function finished(proc: HostedProcess, command: string): Promise<void> {
  let stderr = '';
  proc.stderr.on('data', (chunk: string) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    let startError: Error | undefined;
    proc.on('error', (e: Error) => { startError ??= e; });
    proc.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (startError) {
        reject(startError);
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      const how = code === null ? `was killed${signal ? ` with ${signal}` : ''}` : `failed with exit code ${code}`;
      const output = stderr.trim();
      reject(Object.assign(new Error(`Command ${how}: ${command}${output ? `\n\n${output}` : ''}`), {
        ...(code !== null ? { exitCode: code } : {}),
        ...(signal ? { signal } : {}),
        stderr: output,
      }));
    });
  });
}
