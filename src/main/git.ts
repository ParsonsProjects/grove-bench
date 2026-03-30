import { execa } from 'execa';

export async function git(args: string[], cwd: string): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout;
}

export async function gitEnv(
  args: string[], cwd: string, env: Record<string, string>
): Promise<string> {
  const result = await execa('git', args, { cwd, env: { ...process.env, ...env } });
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

/** Check if a branch exists locally OR as a remote-tracking ref. */
export async function branchExistsAnywhere(cwd: string, branch: string): Promise<boolean> {
  // Check local first
  if (await branchExists(cwd, branch)) return true;
  // Check remote-tracking refs (e.g. origin/feat/API-1388)
  try {
    const output = await execa('git', ['branch', '-r', '--format=%(refname:short)'], { cwd });
    const remotes = output.stdout.split('\n').map(l => l.trim()).filter(Boolean);
    return remotes.some(ref => {
      // Strip remote name prefix (e.g. "origin/feat/foo" → "feat/foo")
      const slash = ref.indexOf('/');
      return slash !== -1 && ref.slice(slash + 1) === branch;
    });
  } catch {
    return false;
  }
}

export async function listBranches(cwd: string): Promise<string[]> {
  // Fetch latest remote refs (non-blocking — proceed with local cache on failure)
  try { await git(['fetch', '--prune'], cwd); } catch { /* offline or no remote */ }

  // Get remote names so we can strip their prefix from remote-tracking branches
  let remotes: string[] = [];
  try {
    const remotesOut = await git(['remote'], cwd);
    remotes = remotesOut.split('\n').map(r => r.trim()).filter(Boolean);
  } catch { /* no remotes */ }

  const output = await git(['branch', '-a', '--format=%(refname:short)'], cwd);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of output.split('\n')) {
    let name = raw.trim();
    if (!name) continue;
    // Skip HEAD pointers like "origin/HEAD"
    if (name.endsWith('/HEAD')) continue;
    // Strip remote prefix (e.g. "origin/feature/foo" → "feature/foo")
    for (const remote of remotes) {
      if (name.startsWith(`${remote}/`)) {
        name = name.slice(remote.length + 1);
        break;
      }
    }
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
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
  } catch (mergeErr: any) {
    // Check for conflict markers via porcelain status
    try {
      const status = await git(['status', '--porcelain'], cwd);
      const conflicts = status.split('\n')
        .filter(l => /^(UU|AA|DD|DU|UD|AU|UA)\s/.test(l))
        .map(l => l.slice(3).trim());

      if (conflicts.length > 0) {
        return { success: false, conflicts };
      }

      // No UU lines — try to extract conflicted files from diff --name-only --diff-filter=U
      const diffOutput = await git(['diff', '--name-only', '--diff-filter=U'], cwd).catch(() => '');
      const diffConflicts = diffOutput.split('\n').map(l => l.trim()).filter(Boolean);
      if (diffConflicts.length > 0) {
        return { success: false, conflicts: diffConflicts };
      }

      // Still nothing — extract info from the merge error message
      const errMsg = mergeErr?.stderr || mergeErr?.message || String(mergeErr);
      // Look for "CONFLICT (content): Merge conflict in <file>" patterns
      const conflictMatches = [...errMsg.matchAll(/CONFLICT[^:]*:\s*Merge conflict in\s+(.+)/g)];
      if (conflictMatches.length > 0) {
        return { success: false, conflicts: conflictMatches.map((m: RegExpMatchArray) => m[1].trim()) };
      }

      return { success: false, conflicts: [errMsg.slice(0, 200)] };
    } catch {
      const errMsg = mergeErr?.stderr || mergeErr?.message || String(mergeErr);
      return { success: false, conflicts: [errMsg.slice(0, 200)] };
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

/** Read the user's git identity from the repo (or global) config, with fallbacks. */
export async function getGitIdentity(cwd: string): Promise<{ name: string; email: string }> {
  let name = 'Grove Orchestrator';
  let email = 'grove-orchestrator@localhost';
  try {
    name = (await git(['config', 'user.name'], cwd)).trim() || name;
  } catch { /* not set */ }
  try {
    email = (await git(['config', 'user.email'], cwd)).trim() || email;
  } catch { /* not set */ }
  return { name, email };
}
