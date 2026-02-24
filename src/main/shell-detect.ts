import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SHELL_CANDIDATES = ['pwsh.exe', 'powershell.exe', 'cmd.exe'] as const;

export async function detectShell(): Promise<string> {
  for (const shell of SHELL_CANDIDATES) {
    try {
      await execFileAsync('where.exe', [shell]);
      return shell;
    } catch {
      continue;
    }
  }
  return 'cmd.exe';
}
