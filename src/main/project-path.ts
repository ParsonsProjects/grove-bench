import path from 'node:path';
import { git, gitVersion } from './git.js';

/** A `git rev-parse` answer in `dir`, or null when git fails there. */
async function revParse(dir: string, flag: string): Promise<string | null> {
  try {
    return (await git(['rev-parse', flag], dir)).trim();
  } catch {
    return null;
  }
}

/**
 * The project path for a folder the user picked. A folder inside a
 * repository becomes the repository's top-level folder, so `repo/src` adds
 * `repo`. Anything that can't be a project throws a message the renderer
 * shows; returning null there looked the same as cancelling.
 */
export async function projectPathFor(picked: string): Promise<string> {
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
    return norm(root) === norm(picked) ? picked : path.resolve(root);
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
    if (await revParse(picked, '--is-bare-repository') === 'true') return picked;
    throw new Error(`${picked} is inside a .git folder. Pick the project folder that contains it.`);
  }

  if (!(await gitVersion())) {
    throw new Error('Git wasn\'t found, so a project can\'t be added. Install Git 2.17 or later, then try again.');
  }
  throw new Error(`${picked} isn't in a git repository. Pick the folder that contains your project's .git folder, or run "git init" in it first.`);
}
