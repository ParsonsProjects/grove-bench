/**
 * Skills kept for every agent. Grove keeps them in the shared folder,
 * `.agents/skills` (in the project and in the home directory), which every
 * agent it knows reads except Claude Code. Claude Code sees each through a
 * link in its own folder (skillLinkContent in skills.ts).
 *
 * Nothing here runs by itself: the Skills drawer offers Share (move Claude
 * Code's own skills to the shared folder, leaving links behind) and Link
 * (add, update or remove links to match the shared folder). Both change
 * files in the project, so the person chooses when.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SkillChanges, SkillInfo, SkillSharing } from '../shared/types.js';
import {
  isSkillLink,
  parseSkillFrontmatter,
  readsSharedSkills,
  SHARED_SKILLS_DIR,
  skillLinkContent,
  skillLinkTarget,
  skillsRoot,
  skillText,
  type SkillDirs,
  type SkillScope,
} from './skills.js';

const SCOPES: readonly SkillScope[] = ['project', 'user'];

interface Manifest {
  /** The skill's folder name, which links and moves go by. */
  dir: string;
  path: string;
  content: string;
}

/** The `<dir>/SKILL.md` manifests in a skills folder, by folder name. */
async function readManifests(root: string): Promise<Map<string, Manifest>> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return new Map();
  }
  const found = await Promise.all(entries.filter((e) => e.isDirectory()).map(async (e): Promise<Manifest | null> => {
    const manifestPath = path.join(root, e.name, 'SKILL.md');
    try {
      return { dir: e.name, path: manifestPath, content: await fs.promises.readFile(manifestPath, 'utf-8') };
    } catch {
      return null;
    }
  }));
  return new Map(found.filter((m) => m !== null).map((m) => [m.dir, m]));
}

function infoOf(m: Manifest, scope: SkillScope): SkillInfo {
  const meta = parseSkillFrontmatter(m.content);
  return { name: meta.name || m.dir, description: meta.description ?? '', source: scope, path: m.path };
}

interface LevelPlan {
  scope: SkillScope;
  /** Claude Code's folder at this level, where links go. */
  ownRoot: string;
  sharedRoot: string;
  toShare: Manifest[];
  /** Shared skills whose link is missing or out of date, with the link
   *  each should have. */
  toLink: { shared: Manifest; link: string }[];
  /** Links whose shared skill is gone. */
  broken: Manifest[];
}

/** What Share and Link would do at each level the agent needs links at. */
async function plan(worktreePath: string, dirs: SkillDirs): Promise<LevelPlan[]> {
  const levels = SCOPES.filter((scope) => !readsSharedSkills(dirs, scope));
  return Promise.all(levels.map(async (scope): Promise<LevelPlan> => {
    const ownRoot = skillsRoot(worktreePath, scope, dirs[scope][0]);
    const sharedRoot = skillsRoot(worktreePath, scope, SHARED_SKILLS_DIR);
    const [own, shared] = await Promise.all([readManifests(ownRoot), readManifests(sharedRoot)]);
    const level: LevelPlan = { scope, ownRoot, sharedRoot, toShare: [], toLink: [], broken: [] };
    for (const m of own.values()) {
      if (isSkillLink(m.content)) {
        if (!shared.has(m.dir)) level.broken.push(m);
      } else if (!shared.has(m.dir)) {
        // One in both folders under the same name stays as it is: Claude
        // Code uses its own, the others the shared one.
        level.toShare.push(m);
      }
    }
    for (const m of shared.values()) {
      const current = own.get(m.dir);
      if (current && !isSkillLink(current.content)) continue;
      const link = skillLinkContent(m.content, m.dir, skillLinkTarget(scope, m.dir));
      // Git on Windows may check the link out with CRLF line endings.
      if (!current || skillText(current.content) !== link) level.toLink.push({ shared: m, link });
    }
    return level;
  }));
}

/**
 * What the Skills drawer offers, for an agent that needs links (`dirs` are
 * Claude Code's folders): its own skills other agents can't see, shared
 * skills it can't see (or sees an old copy of), and links to deleted skills.
 */
export async function skillSharing(worktreePath: string, dirs: SkillDirs): Promise<SkillSharing> {
  const levels = await plan(worktreePath, dirs);
  return {
    toShare: levels.flatMap((l) => l.toShare.map((m) => infoOf(m, l.scope))),
    toLink: levels.flatMap((l) => l.toLink.map(({ shared }) => infoOf(shared, l.scope))),
    broken: levels.flatMap((l) => l.broken.map((m) => infoOf(m, l.scope))),
  };
}

/** Move a skill's folder, copying when it can't be renamed across drives
 *  (a Claude account's folder on another drive). */
async function moveFolder(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.promises.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await fs.promises.rm(from, { recursive: true, force: true });
  }
}

function reasonOf(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EPERM' || code === 'EBUSY') return 'a file in it is open in another program';
  return err instanceof Error ? err.message : String(err);
}

/** Move the agent's own skills to the shared folder, each leaving a link so
 *  the agent still finds it: all of them, or only the one whose SKILL.md is
 *  at `onlyPath` (as skillSharing listed it). */
export async function shareSkills(worktreePath: string, dirs: SkillDirs, onlyPath?: string): Promise<SkillChanges> {
  const result: SkillChanges = { done: [], skipped: [] };
  const only = onlyPath === undefined ? null : path.resolve(onlyPath);
  for (const level of await plan(worktreePath, dirs)) {
    for (const m of level.toShare) {
      if (only !== null && path.resolve(m.path) !== only) continue;
      const name = infoOf(m, level.scope).name;
      const from = path.dirname(m.path);
      const to = path.join(level.sharedRoot, m.dir);
      try {
        // Checked again: on Linux a rename replaces an empty folder.
        if (fs.existsSync(to)) throw new Error('the shared folder already has one by that name');
        await fs.promises.mkdir(level.sharedRoot, { recursive: true });
        await moveFolder(from, to);
        await fs.promises.mkdir(from, { recursive: true });
        await fs.promises.writeFile(m.path, skillLinkContent(m.content, m.dir, skillLinkTarget(level.scope, m.dir)));
        result.done.push(name);
      } catch (err) {
        result.skipped.push({ name, reason: reasonOf(err) });
      }
    }
  }
  return result;
}

/** Add or update a link for each shared skill, and remove links to skills
 *  that are gone. Only links Grove made are changed. */
export async function linkSkills(worktreePath: string, dirs: SkillDirs): Promise<SkillChanges> {
  const result: SkillChanges = { done: [], skipped: [] };
  for (const level of await plan(worktreePath, dirs)) {
    for (const { shared, link } of level.toLink) {
      const name = infoOf(shared, level.scope).name;
      const linkPath = path.join(level.ownRoot, shared.dir, 'SKILL.md');
      try {
        await fs.promises.mkdir(path.dirname(linkPath), { recursive: true });
        await fs.promises.writeFile(linkPath, link);
        result.done.push(name);
      } catch (err) {
        result.skipped.push({ name, reason: reasonOf(err) });
      }
    }
    for (const m of level.broken) {
      const name = infoOf(m, level.scope).name;
      try {
        await fs.promises.rm(m.path);
        // The folder goes too when the link was all it held.
        await fs.promises.rmdir(path.dirname(m.path)).catch(() => {});
        result.done.push(name);
      } catch (err) {
        result.skipped.push({ name, reason: reasonOf(err) });
      }
    }
  }
  return result;
}
