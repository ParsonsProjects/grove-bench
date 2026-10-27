/**
 * Skills kept for every agent. Grove keeps them in the shared folder,
 * `.agents/skills` (in the project and in the home directory), which every
 * agent it knows reads except Claude Code. Claude Code sees each through a
 * link in its own folder (skillLinkContent in skills.ts).
 *
 * Links are kept up to date without asking (linkSkills): when a Claude Code
 * thread starts, and when its Skills drawer opens. Moving a skill between
 * Claude Code's folder and the shared one (Share, and its opposite) changes
 * files in the project, so only the person does that, from the drawer.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SkillChanges, SkillReach, SkillSharing } from '../shared/types.js';
import {
  copySkillToUser,
  editTarget,
  isSkillLink,
  listedSkill,
  linkRoots,
  parseSkillFrontmatter,
  readSkillFolders,
  readsSharedSkills,
  sameLink,
  SHARED_SKILLS_DIR,
  skillLinkContent,
  skillLinkTarget,
  skillsRoot,
  writeLinks,
  type SkillDirs,
  type SkillFolder,
  type SkillScope,
} from './skills.js';

const SCOPES: readonly SkillScope[] = ['project', 'user'];

type Manifest = SkillFolder;

/** The `<dir>/SKILL.md` manifests in a skills folder, by folder name. */
async function readManifests(root: string): Promise<Map<string, Manifest>> {
  return new Map((await readSkillFolders(root)).map((m) => [m.dir, m]));
}

function nameOf(m: Manifest): string {
  return parseSkillFrontmatter(m.content).name || m.dir;
}

interface LevelPlan {
  scope: SkillScope;
  sharedRoot: string;
  /** The folders links go in at this level: Claude Code's own, and at the
   *  user level every Claude account's (linkRoots). */
  linkRoots: string[];
  /** The agent's own skills other agents can't see. */
  toShare: Manifest[];
  /** Shared skills whose link in a folder is missing or out of date, with
   *  the link each should have and where. */
  toLink: { shared: Manifest; link: string; linkPath: string }[];
  /** Links whose shared skill is gone. */
  broken: Manifest[];
}

/** What Share and Link would do at each level links are kept at. */
async function plan(worktreePath: string, dirs: SkillDirs): Promise<LevelPlan[]> {
  const levels = SCOPES.map((scope) => ({ scope, roots: linkRoots(worktreePath, dirs, scope) })).filter((l) => l.roots.length > 0);
  return Promise.all(levels.map(async ({ scope, roots }): Promise<LevelPlan> => {
    const sharedRoot = skillsRoot(worktreePath, scope, SHARED_SKILLS_DIR);
    // The agent's own folder, when it needs links, is the first.
    const ownRoot = readsSharedSkills(dirs, scope) ? null : roots[0];
    const [shared, ...linked] = await Promise.all([readManifests(sharedRoot), ...roots.map(readManifests)]);
    const level: LevelPlan = { scope, sharedRoot, linkRoots: roots, toShare: [], toLink: [], broken: [] };
    roots.forEach((root, i) => {
      const own = linked[i];
      for (const m of own.values()) {
        if (isSkillLink(m.content)) {
          if (!shared.has(m.dir)) level.broken.push(m);
        } else if (root === ownRoot && !shared.has(m.dir)) {
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
        if (!current || !sameLink(current.content, link)) level.toLink.push({ shared: m, link, linkPath: path.join(root, m.dir, 'SKILL.md') });
      }
    });
    return level;
  }));
}

/**
 * What the Skills drawer offers, for an agent that needs links (`dirs` are
 * Claude Code's folders): its own skills other agents can't see.
 */
export async function skillSharing(worktreePath: string, dirs: SkillDirs): Promise<SkillSharing> {
  const levels = await plan(worktreePath, dirs);
  return {
    toShare: levels.flatMap((l) => l.toShare.map((m) => {
      const meta = parseSkillFrontmatter(m.content);
      return { name: meta.name || m.dir, description: meta.description ?? '', source: l.scope, path: m.path };
    })),
  };
}

/** Move a skill's folder, copying when it can't be renamed across drives
 *  (a Claude account's folder on another drive). A symlinked folder moves
 *  as a link to the same place: renamed as it is, a relative link would
 *  point somewhere else from its new folder. When this throws, the skill is
 *  still at `from`: a copy that fails partway is cleared from `to`. */
async function moveFolder(from: string, to: string): Promise<void> {
  if ((await fs.promises.lstat(from)).isSymbolicLink()) {
    // 'junction' on Windows, which needs no admin rights; ignored elsewhere.
    await fs.promises.symlink(await fs.promises.realpath(from), to, 'junction');
    try {
      await fs.promises.unlink(from);
    } catch (err) {
      await fs.promises.unlink(to).catch(() => {});
      throw err;
    }
    return;
  }
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    try {
      await fs.promises.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    } catch (copyErr) {
      await fs.promises.rm(to, { recursive: true, force: true }).catch(() => {});
      throw copyErr;
    }
    // Copied: what's left at `from` is clean-up, not the skill.
    await fs.promises.rm(from, { recursive: true, force: true }).catch(() => {});
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
      const name = nameOf(m);
      const from = path.dirname(m.path);
      const to = path.join(level.sharedRoot, m.dir);
      try {
        // Checked again: on Linux a rename replaces an empty folder.
        if (fs.existsSync(to)) throw new Error('the shared folder already has one by that name');
        await fs.promises.mkdir(level.sharedRoot, { recursive: true });
        await moveFolder(from, to);
        await fs.promises.mkdir(from, { recursive: true });
        await fs.promises.writeFile(m.path, skillLinkContent(m.content, m.dir, skillLinkTarget(level.scope, m.dir)));
        // And every other Claude account's, for a personal skill.
        writeLinks(level.linkRoots, level.scope, m.dir, m.content);
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
    for (const { shared, link, linkPath } of level.toLink) {
      const name = nameOf(shared);
      try {
        await fs.promises.mkdir(path.dirname(linkPath), { recursive: true });
        await fs.promises.writeFile(linkPath, link);
        result.done.push(name);
      } catch (err) {
        result.skipped.push({ name, reason: reasonOf(err) });
      }
    }
    for (const m of level.broken) {
      const name = nameOf(m);
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

/**
 * Move a listed shared skill back into the agent's own folder, so only Claude
 * Code sees it: the opposite of Share. The link it was listed by gives way
 * to the skill itself, and its links in other Claude accounts' folders go, as
 * they'd point at nothing.
 */
export async function unshareSkill(worktreePath: string, dirs: SkillDirs, skillPath: string): Promise<void> {
  const skill = await listedSkill(worktreePath, dirs, skillPath);
  if (readsSharedSkills(dirs, skill.source)) throw new Error("Only Claude Agent's skills can be kept for it alone");
  const target = await editTarget(worktreePath, skill);
  if (!target.link) return; // its own already
  const shared = path.dirname(target.path);
  const link = target.link;
  const own = path.dirname(link.path);
  const dirName = path.basename(shared);
  // The skill moves in where its link is, so that folder must hold the link
  // alone. Checked first, so a refusal changes nothing.
  const others = (await fs.promises.readdir(own)).filter((f) => f !== path.basename(link.path));
  if (others.length > 0) throw new Error(`${own} has other files in it, so "${skill.name}" can't be moved there`);
  await fs.promises.rm(link.path);
  try {
    await fs.promises.rmdir(own);
    await moveFolder(shared, own);
  } catch (err) {
    // Still in the shared folder: the link goes back, so Claude Code keeps it.
    if (!fs.existsSync(path.join(own, 'SKILL.md'))) {
      await fs.promises.mkdir(own, { recursive: true }).catch(() => {});
      await fs.promises.writeFile(link.path, link.raw).catch(() => {});
    }
    throw new Error(`Couldn't move "${skill.name}" into ${own}: ${reasonOf(err)}`, { cause: err });
  }
  for (const root of linkRoots(worktreePath, dirs, skill.source)) {
    const other = path.join(root, dirName, 'SKILL.md');
    if (path.resolve(other) === path.resolve(link.path)) continue;
    try {
      if (!isSkillLink(await fs.promises.readFile(other, 'utf-8'))) continue;
      await fs.promises.rm(other);
      await fs.promises.rmdir(path.dirname(other)).catch(() => {});
    } catch { /* none there */ }
  }
}

/**
 * Set who can use a listed skill (SkillReach), doing what it takes:
 * - Every agent: Share, moving it to `.agents/skills` at its level and
 *   leaving links. Claude Agent alone: the opposite (unshareSkill)
 * - All projects, for a project skill: a copy in the user's folders, for
 *   those agents (copySkillToUser). The project keeps its copy for the team
 *   as it is. A personal skill is in all projects already
 */
export async function setSkillReach(worktreePath: string, dirs: SkillDirs, skillPath: string, reach: SkillReach): Promise<void> {
  const skill = await listedSkill(worktreePath, dirs, skillPath);
  if (skill.source === 'user' && reach.projects === 'project') throw new Error(`"${skill.name}" is a personal skill, in all your projects already`);
  if (skill.source === 'project' && reach.projects === 'all') {
    await copySkillToUser(worktreePath, dirs, skillPath, reach.agents);
    return;
  }
  const shared = path.dirname(path.dirname((await editTarget(worktreePath, skill)).path));
  const agents = path.resolve(shared) === path.resolve(skillsRoot(worktreePath, skill.source, SHARED_SKILLS_DIR)) ? 'all' : 'claude';
  if (agents === reach.agents) return;
  if (reach.agents === 'claude') {
    await unshareSkill(worktreePath, dirs, skillPath);
    return;
  }
  if (readsSharedSkills(dirs, skill.source)) throw new Error("Only Claude Agent's skills can be shared from here");
  const { done, skipped } = await shareSkills(worktreePath, dirs, skillPath);
  if (skipped[0]) throw new Error(`Couldn't share "${skipped[0].name}": ${skipped[0].reason}`);
  // Share leaves one alone that the shared folder has a skill of its name for.
  if (done.length === 0) throw new Error(`.agents/skills has a skill named "${skill.name}" already`);
}
