import path from 'node:path';
import { gitVersion, isGitRepo, repoRoot } from './git.js';

/**
 * The project path for a folder the user picked. A folder inside a
 * repository becomes the repository's top-level folder, so `repo/src` adds
 * `repo`. A folder that isn't in a git repository throws a message the
 * renderer shows; returning null there looked the same as cancelling.
 */
export async function projectPathFor(picked: string): Promise<string> {
  const root = await repoRoot(picked);
  if (root) {
    const norm = (p: string) => {
      const resolved = path.resolve(p);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    // Keep the dialog's spelling when it is the root, so the same folder
    // picked twice doesn't become two projects.
    return norm(root) === norm(picked) ? picked : path.resolve(root);
  }
  // Not in a work tree. A bare repository still passes the older check, so
  // keep accepting what was accepted before.
  if (await isGitRepo(picked)) return picked;
  if (!(await gitVersion())) {
    throw new Error('Git wasn\'t found, so a project can\'t be added. Install Git 2.17 or later, then try again.');
  }
  throw new Error(`${picked} isn't in a git repository. Pick the folder that contains your project's .git folder, or run "git init" in it first.`);
}
