import fs from 'node:fs/promises';
import path from 'node:path';
import { git } from './git.js';
import type { PickedProject, ProjectKind } from '../shared/types.js';

/** Git's message when it refuses a real repository, such as one on a drive
 *  owned by another user ("dubious ownership"). */
const GIT_REFUSAL = /dubious ownership|safe\.directory/i;

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
 * `repo`. A folder outside any repository, or any folder when git isn't
 * installed, comes back as `folder` and is used as it is. A pick git can't
 * work with throws a message the renderer shows.
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
  if (GIT_REFUSAL.test(refusal)) {
    const reason = refusal.replace(/^fatal:\s*/i, '');
    throw new Error(`Git won't open this repository. ${reason.charAt(0).toUpperCase()}${reason.slice(1)}`);
  }

  if (await revParse(picked, '--is-inside-git-dir') === 'true') {
    // A bare repository has no work tree and was accepted before; a `.git`
    // folder (or a folder inside one) is the wrong pick.
    if (await revParse(picked, '--is-bare-repository') === 'true') return { kind: 'git', path: picked };
    throw new Error(`${picked} is inside a .git folder. Pick the project folder that contains it.`);
  }

  return { kind: 'folder', path: picked };
}

/**
 * Whether a project path is a git repository, a plain folder, or gone. It
 * agrees with inspectProjectFolder(): a repository git refuses (for example
 * "dubious ownership") is still a git project, so git's own error shows when
 * a conversation starts rather than the agent quietly editing the checkout in
 * place. Anything else git can't open, including a broken `.git` or any
 * folder when git isn't installed, is a plain folder.
 */
export async function projectKind(dir: string): Promise<ProjectKind> {
  try {
    if (!(await fs.stat(dir)).isDirectory()) return 'missing';
  } catch {
    return 'missing';
  }
  try {
    await git(['rev-parse', '--git-dir'], dir);
    return 'git';
  } catch (e: any) {
    return GIT_REFUSAL.test(String(e?.stderr ?? '')) ? 'git' : 'folder';
  }
}
