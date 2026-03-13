import { execa } from 'execa';

export async function git(args: string[], cwd: string): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout;
}

export async function gitVersion(): Promise<{ version: string; major: number; minor: number; patch: number } | null> {
  try {
    const { stdout } = await execa('git', ['--version']);
    const match = stdout.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return {
      version: stdout.trim(),
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
    };
  } catch {
    return null;
  }
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await execa('git', ['rev-parse', '--git-dir'], { cwd: path });
    return true;
  } catch {
    return false;
  }
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    await execa('git', ['rev-parse', '--verify', branch], { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function listBranches(cwd: string): Promise<string[]> {
  const output = await git(['branch', '--format=%(refname:short)'], cwd);
  return output.split('\n').map(l => l.trim()).filter(Boolean);
}

export async function validateBranchName(name: string): Promise<boolean> {
  try {
    await execa('git', ['check-ref-format', '--branch', name]);
    return true;
  } catch {
    return false;
  }
}

export async function mergeNoCommit(cwd: string, branch: string): Promise<{ success: boolean; conflicts?: string[] }> {
  try {
    await git(['merge', '--no-commit', '--no-ff', branch], cwd);
    await git(['commit', '-m', `Merge ${branch}`], cwd);
    return { success: true };
  } catch {
    // Check for conflict markers
    try {
      const status = await git(['status', '--porcelain'], cwd);
      const conflicts = status.split('\n')
        .filter(l => /^(UU|AA|DD|DU|UD|AU|UA)\s/.test(l))
        .map(l => l.slice(3).trim());
      return { success: false, conflicts };
    } catch {
      return { success: false, conflicts: [] };
    }
  }
}

export async function abortMerge(cwd: string): Promise<void> {
  try {
    await git(['merge', '--abort'], cwd);
  } catch { /* no merge in progress */ }
}

export async function branchHasRemote(cwd: string, branch: string): Promise<boolean> {
  try {
    const output = await git(['branch', '-r', '--list', `*/${branch}`], cwd);
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export async function renameBranch(cwd: string, oldName: string, newName: string): Promise<void> {
  await git(['branch', '-m', oldName, newName], cwd);
}
