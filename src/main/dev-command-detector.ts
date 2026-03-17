import * as fs from 'node:fs';
import * as path from 'node:path';

const DEV_SCRIPT_KEYS = ['dev', 'start', 'serve', 'develop'];

const LOCK_FILE_RUNNERS: [string, string][] = [
  ['bun.lockb', 'bun run'],
  ['bun.lock', 'bun run'],
  ['pnpm-lock.yaml', 'pnpm run'],
  ['yarn.lock', 'yarn run'],
  // npm is the fallback
];

async function detectRunner(dir: string): Promise<string> {
  for (const [lockFile, runner] of LOCK_FILE_RUNNERS) {
    try {
      await fs.promises.access(path.join(dir, lockFile));
      return runner;
    } catch { /* not found */ }
  }
  return 'npm run';
}

/** Auto-detect a dev command from package.json scripts in the given directory. */
export async function detectDevCommand(worktreePath: string): Promise<string | null> {
  try {
    const pkgPath = path.join(worktreePath, 'package.json');
    const data = await fs.promises.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(data);
    const scripts: Record<string, string> = pkg.scripts ?? {};
    for (const key of DEV_SCRIPT_KEYS) {
      if (scripts[key]) {
        const runner = await detectRunner(worktreePath);
        return `${runner} ${key}`;
      }
    }
  } catch { /* no package.json or parse error */ }
  return null;
}
