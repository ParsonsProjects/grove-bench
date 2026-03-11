import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
interface ShellInfo {
  id: string;
  name: string;
  path: string;
}

const execFileAsync = promisify(execFile);

interface ShellCandidate {
  id: string;
  name: string;
  /** Executable name for `where.exe` lookup, or absolute path. */
  exe: string;
}

const CANDIDATES: ShellCandidate[] = [
  { id: 'pwsh',       name: 'PowerShell 7',      exe: 'pwsh.exe' },
  { id: 'powershell', name: 'Windows PowerShell', exe: 'powershell.exe' },
  { id: 'cmd',        name: 'Command Prompt',     exe: 'cmd.exe' },
  { id: 'gitbash',    name: 'Git Bash',           exe: 'bash.exe' },
];

/** Well-known Git Bash install paths when `where.exe` doesn't find bash. */
const GIT_BASH_PATHS = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
];

async function which(exe: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('where.exe', [exe]);
    return stdout.trim().split('\n')[0].trim();
  } catch {
    return null;
  }
}

let cachedShells: ShellInfo[] | null = null;

export async function detectShells(): Promise<ShellInfo[]> {
  if (cachedShells) return cachedShells;

  const found: ShellInfo[] = [];

  for (const candidate of CANDIDATES) {
    let resolvedPath: string | null = null;

    if (candidate.id === 'gitbash') {
      // Try `where.exe bash.exe` first, then check known paths
      resolvedPath = await which(candidate.exe);
      if (!resolvedPath) {
        for (const p of GIT_BASH_PATHS) {
          try {
            await access(p);
            resolvedPath = p;
            break;
          } catch { /* not here */ }
        }
      }
    } else {
      resolvedPath = await which(candidate.exe);
    }

    if (resolvedPath) {
      found.push({ id: candidate.id, name: candidate.name, path: resolvedPath });
    }
  }

  cachedShells = found;
  return found;
}

export interface ResolvedShell {
  path: string;
  args: string[];
}

/** Shell-specific launch arguments to match VS Code's terminal behaviour. */
const SHELL_ARGS: Record<string, string[]> = {
  gitbash:    ['--login', '-i'],
  pwsh:       ['-NoLogo'],
  powershell: ['-NoLogo'],
  cmd:        [],
};

/** Resolve a shell id to its executable path and launch args. Falls back to first available. */
export async function resolveShell(shellId?: string): Promise<ResolvedShell> {
  const shells = await detectShells();
  let match: ShellInfo | undefined;
  if (shellId) {
    match = shells.find((s) => s.id === shellId);
  }
  if (!match) {
    match = shells[0];
  }
  const id = match?.id ?? 'cmd';
  return {
    path: match?.path ?? 'cmd.exe',
    args: SHELL_ARGS[id] ?? [],
  };
}

/** For backwards compat — returns the best available shell path. */
export async function detectShell(): Promise<string> {
  const resolved = await resolveShell();
  return resolved.path;
}
