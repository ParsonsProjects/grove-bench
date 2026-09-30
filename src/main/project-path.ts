import fs from 'node:fs/promises';
import path from 'node:path';
import { git, gitVersion, getGitIdentity, isGitRepo } from './git.js';
import type { PickedProject, ProjectKind } from '../shared/types.js';

/** A `git rev-parse` answer in `dir`, or null when git fails there. */
async function revParse(dir: string, flag: string): Promise<string | null> {
  try {
    return (await git(['rev-parse', flag], dir)).trim();
  } catch {
    return null;
  }
}

/**
 * What a folder the user picked can be as a project. A folder inside a
 * repository becomes the repository's top-level folder, so `repo/src` adds
 * `repo`. A folder outside any repository comes back as `folder`, for the
 * user to set git up there or use as it is. A pick git can't work with
 * throws a message the renderer shows.
 */
export async function inspectProjectFolder(picked: string): Promise<PickedProject> {
  let root: string | null = null;
  let refusal = '';
  try {
    root = (await git(['rev-parse', '--show-toplevel'], picked)).trim() || null;
  } catch (e: any) {
    refusal = String(e?.stderr ?? '').trim();
  }

  if (root) {
    const norm = (p: string) => {
      const resolved = path.resolve(p);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    // Keep the dialog's spelling when it is the root, so the same folder
    // picked twice doesn't become two projects.
    return { kind: 'git', path: norm(root) === norm(picked) ? picked : path.resolve(root) };
  }

  // Git refuses some real repositories, such as one on a drive owned by
  // another user ("dubious ownership"). Its own message says how to allow it.
  if (/dubious ownership|safe\.directory/i.test(refusal)) {
    const reason = refusal.replace(/^fatal:\s*/i, '');
    throw new Error(`Git won't open this repository. ${reason.charAt(0).toUpperCase()}${reason.slice(1)}`);
  }

  if (await revParse(picked, '--is-inside-git-dir') === 'true') {
    // A bare repository has no work tree and was accepted before; a `.git`
    // folder (or a folder inside one) is the wrong pick.
    if (await revParse(picked, '--is-bare-repository') === 'true') return { kind: 'git', path: picked };
    throw new Error(`${picked} is inside a .git folder. Pick the project folder that contains it.`);
  }

  return { kind: 'folder', path: picked, gitAvailable: !!(await gitVersion()) };
}

/** Whether a project path is a git repository, a plain folder, or gone. */
export async function projectKind(dir: string): Promise<ProjectKind> {
  try {
    if (!(await fs.stat(dir)).isDirectory()) return 'missing';
  } catch {
    return 'missing';
  }
  return (await isGitRepo(dir)) ? 'git' : 'folder';
}

/**
 * Turn a plain folder into a git repository: `git init`, then a first
 * commit of what is there (files matched by a .gitignore are left out), so
 * conversations can work on their own branch in a separate copy. The first
 * commit needs a name and email; without them nothing is changed and the
 * message says how to set them. Never throws.
 */
export async function initGitRepo(dir: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await gitVersion())) {
    return { ok: false, error: 'Git wasn\'t found. Install Git 2.17 or later, then try again.' };
  }
  if (await isGitRepo(dir)) return { ok: true };
  if (!(await getGitIdentity(dir))) {
    return {
      ok: false,
      error: 'Git needs your name and email for the first commit. Run git config --global user.name "Your Name" and git config --global user.email "you@example.com" in a terminal, then try again.',
    };
  }
  try {
    await git(['init', '-q'], dir);
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '--allow-empty', '-m', 'Initial commit'], dir);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.stderr || e?.message || e).trim().slice(0, 500) };
  }
}
