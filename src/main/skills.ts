/**
 * Skill discovery for agent sessions.
 *
 * Skills follow the open Agent Skills format: a `<name>/SKILL.md` folder
 * with YAML frontmatter, which Claude Code, Gemini CLI, Copilot, OpenCode and
 * Codex all read. Each keeps them under its own folder names at two levels:
 * the user's home directory and the project (which for a Grove Bench session
 * is the worktree — project skills are checked into git, so every worktree
 * carries them). Each adapter passes its folders (SkillDirs); Claude Code's
 * is `.claude/skills`. Plugin-provided skills have no stable on-disk
 * location we can scan; the Skills drawer shows those from the agent's
 * system_init report instead.
 *
 * Grove writes new skills to the shared folder, `.agents/skills`, which every
 * agent it knows reads except Claude Code. Claude Code sees each through a
 * link in its own folder (skillLinkContent; skill-sharing.ts keeps links up
 * to date).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SkillDefinition, SkillFile, SkillInfo } from '../shared/types.js';
import { skillDescriptionProblem, skillNameProblem } from '../shared/skill-name.js';

/** Where an agent looks for skills, relative to the project and to the
 *  user's home directory (often the same, e.g. `.claude/skills`). A user
 *  folder may be an absolute path instead, such as a Claude account's own.
 *  Most agents read several (their own and the shared `.agents/skills`): the
 *  first is where Grove writes a new skill, and an earlier folder's skill
 *  wins over a later one of the same name. */
export interface SkillDirs {
  project: readonly string[];
  user: readonly string[];
  /** A user skill wins over a project skill of the same name, as in Claude
   *  Code ("personal over project", code.claude.com/docs/en/skills).
   *  Otherwise the project's wins, as in Gemini CLI (workspace over user). */
  userFirst?: boolean;
  /** Other user folders that see personal shared skills only through links:
   *  every Claude account's (each its own agent), filled in by IPC. Grove
   *  keeps a link in each, as in the agent's own, so a personal skill
   *  reaches every Claude thread whichever account it runs on. */
  userLinks?: readonly string[];
}

/** A user-level skills folder, made absolute. */
function userSkillsDir(dir: string): string {
  return path.isAbsolute(dir) ? dir : path.join(os.homedir(), dir);
}

/** Claude Code's skill folders. */
export const CLAUDE_SKILL_DIRS: SkillDirs = {
  project: [path.join('.claude', 'skills')],
  user: [path.join('.claude', 'skills')],
  userFirst: true,
};

/** The Agent Skills folder every agent Grove knows reads except Claude Code,
 *  in the project and in the home directory. Grove keeps skills here so any
 *  agent can use them. */
export const SHARED_SKILLS_DIR = path.join('.agents', 'skills');

/** An agent that reads only the shared folder. */
export const SHARED_SKILL_DIRS: SkillDirs = {
  project: [SHARED_SKILLS_DIR],
  user: [SHARED_SKILLS_DIR],
};

export type SkillScope = SkillDefinition['scope'];

/** Whether an agent reads the shared folder at a level. One that doesn't
 *  (Claude Code) sees a shared skill through a link in its first folder. */
export function readsSharedSkills(dirs: SkillDirs, scope: SkillScope): boolean {
  return dirs[scope].some((dir) => !path.isAbsolute(dir) && path.normalize(dir) === SHARED_SKILLS_DIR);
}

/** A skills folder made absolute: in the project, or in the home directory. */
export function skillsRoot(worktreePath: string, scope: SkillScope, dir: string): string {
  return scope === 'project' ? path.join(worktreePath, dir) : userSkillsDir(dir);
}

// ─── Links ───
//
// A link is a SKILL.md in Claude Code's folder that stands in for a shared
// skill: the shared skill's own frontmatter, so Claude Code lists it under
// the same name and description and with the same settings, and a body that
// sends the agent to the shared file. It is a plain file, so it works in git
// on Windows, where symlinks are checked out as text by default.

const LINK_MARKER = 'grove-bench:skill-link';

/** Where a link points, as written in it: from the project root for a
 *  project skill, so a teammate's copy of the repository finds it too, and
 *  absolute for a user one. */
export function skillLinkTarget(scope: SkillScope, dirName: string): string {
  return scope === 'project'
    ? ['.agents', 'skills', dirName, 'SKILL.md'].join('/')
    : path.join(userSkillsDir(SHARED_SKILLS_DIR), dirName, 'SKILL.md');
}

/** A SKILL.md's text with LF line endings and no byte order mark, as git
 *  on Windows may check it out with CRLF. */
export function skillText(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

/** A SKILL.md's frontmatter, without its `---` lines and with LF line
 *  endings; null when it has none. */
export function skillFrontmatter(content: string): string | null {
  return skillText(content).match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] ?? null;
}

/** The note a link carries for whoever opens it. Older Grove versions
 *  worded it differently; sameLink ignores it, so rewording it doesn't
 *  rewrite every link already made. */
const LINK_NOTE_START = '<!-- Grove Bench made this link';
const LINK_NOTE = /^<!-- Grove Bench made this link.*-->\n/m;

/** The link to a shared skill, given its SKILL.md content. */
export function skillLinkContent(sharedContent: string, dirName: string, target: string): string {
  const folder = target.replace(/[\\/]SKILL\.md$/, '');
  return [
    '---',
    skillFrontmatter(sharedContent) ?? `name: ${dirName}`,
    '---',
    '',
    `<!-- ${LINK_MARKER} ${target} -->`,
    `${LINK_NOTE_START} so Claude Code can use a skill kept for every agent. Edit the skill in ${target}; Grove updates this copy when a thread starts and when its Skills drawer opens. -->`,
    '',
    `This skill is kept in \`${target}\`, where every coding agent can find it. Read that file now and follow its instructions. Paths in it are relative to \`${folder}\`.`,
    '',
  ].join('\n');
}

/** Whether a SKILL.md is a link Grove made. */
export function isSkillLink(content: string): boolean {
  return content.includes(`<!-- ${LINK_MARKER} `);
}

/** Whether a link on disk says what `link` says, line endings and the note
 *  aside. */
export function sameLink(current: string, link: string): boolean {
  return skillText(current).replace(LINK_NOTE, '') === link.replace(LINK_NOTE, '');
}

/** The folders, made absolute, where links to a level's shared skills go:
 *  the agent's own first one when it doesn't read the shared folder, and at
 *  the user level every Claude account's (userLinks). */
export function linkRoots(worktreePath: string, dirs: SkillDirs, scope: SkillScope): string[] {
  const roots = readsSharedSkills(dirs, scope) ? [] : [skillsRoot(worktreePath, scope, dirs[scope][0])];
  if (scope === 'user') roots.push(...(dirs.userLinks ?? []).map(userSkillsDir));
  return [...new Map(roots.map((root) => [path.resolve(root), root])).values()];
}

/**
 * Bring the link to a shared skill up to date in each folder: written where
 * it's missing or out of date, unless `onlyExisting`. A folder's own skill of
 * that name is left alone. Best effort: a link that can't be written is
 * tried again when a thread starts or the Skills drawer opens (linkSkills).
 */
export function writeLinks(roots: readonly string[], scope: SkillScope, dirName: string, sharedContent: string, onlyExisting = false): void {
  const link = skillLinkContent(sharedContent, dirName, skillLinkTarget(scope, dirName));
  for (const root of roots) {
    const linkPath = path.join(root, dirName, 'SKILL.md');
    try {
      const current = fs.existsSync(linkPath) ? fs.readFileSync(linkPath, 'utf-8') : null;
      if (current === null ? onlyExisting : !isSkillLink(current) || sameLink(current, link)) continue;
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      fs.writeFileSync(linkPath, link);
    } catch { /* tried again by linkSkills */ }
  }
}

/** A flow scalar's value: unquoted and unescaped, as a YAML parser reads it. */
function yamlScalar(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, c: string) => {
      if (c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
      return ({ n: '\n', t: '\t', r: '\r', '0': '\0' } as Record<string, string>)[c] ?? c;
    });
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

/**
 * Extract `name` and `description` from a SKILL.md YAML frontmatter block,
 * as the agents read them: quoted values unescaped, and a value over several
 * lines (a `>` or `|` block, or indented lines after the key) joined. Only
 * those two top-level keys are read, so a full YAML parser isn't pulled
 * into the main process.
 */
export function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const block = skillFrontmatter(content);
  if (block === null) return {};
  const result: { name?: string; description?: string } = {};
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(name|description):\s*(.*)$/);
    if (!kv) continue;
    const first = kv[2].trim();
    // The value's further lines: indented, or blank inside a block.
    const more: string[] = [];
    while (i + 1 < lines.length && /^(\s|$)/.test(lines[i + 1])) more.push(lines[++i].trim());
    while (more.length > 0 && more[more.length - 1] === '') more.pop();
    let value: string;
    if (/^[>|][+-]?\d?$/.test(first)) {
      // A literal block keeps its lines; a folded one joins them.
      value = first.startsWith('|') ? more.join('\n') : more.filter(Boolean).join(' ');
    } else {
      value = yamlScalar([first, ...more].filter(Boolean).join(' '));
    }
    if (value) result[kv[1] as 'name' | 'description'] = value;
  }
  return result;
}

/** A `<dir>/SKILL.md` in a skills folder. */
export interface SkillFolder {
  /** The skill's folder name, which links and moves go by. */
  dir: string;
  path: string;
  content: string;
}

/** The `<dir>/SKILL.md` manifests in a skills folder, in directory order.
 *  A folder may be a symlink (or a Windows junction) to one elsewhere, as
 *  Claude Code allows. Reads without blocking: it runs on the main process
 *  each time a thread's Skills count shows, across up to five folders per
 *  agent. */
export async function readSkillFolders(root: string): Promise<SkillFolder[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return []; // directory absent: no skills at this level
  }
  const found = await Promise.all(entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map(async (e): Promise<SkillFolder | null> => {
    const manifestPath = path.join(root, e.name, 'SKILL.md');
    try {
      return { dir: e.name, path: manifestPath, content: await fs.promises.readFile(manifestPath, 'utf-8') };
    } catch {
      return null; // no manifest (or a link to a file): not a skill
    }
  }));
  return found.filter((m) => m !== null);
}

/** Scan one skills directory for `<name>/SKILL.md` manifests, in directory
 *  order. */
export async function scanSkillsDir(dir: string, source: SkillInfo['source']): Promise<SkillInfo[]> {
  return (await readSkillFolders(dir)).map((folder) => {
    const meta = parseSkillFrontmatter(folder.content);
    return {
      // The CLI identifies a skill by its frontmatter name, falling back to
      // the directory name.
      name: meta.name || folder.dir,
      description: meta.description ?? '',
      source,
      path: folder.path,
    };
  });
}

/**
 * List the skills a session at `worktreePath` can see on disk. Of two with
 * the same name, the one the agent uses is listed: the user's or the
 * project's (SkillDirs.userFirst), and at one level an earlier folder's.
 */
export async function listSkills(worktreePath: string, dirs: SkillDirs = CLAUDE_SKILL_DIRS): Promise<SkillInfo[]> {
  const [user, project] = await Promise.all([
    Promise.all(dirs.user.map((dir) => scanSkillsDir(userSkillsDir(dir), 'user'))).then((lists) => lists.flat()),
    Promise.all(dirs.project.map((dir) => scanSkillsDir(path.join(worktreePath, dir), 'project'))).then((lists) => lists.flat()),
  ]);
  const byName = new Map<string, SkillInfo>();
  // Lowest precedence first, so each later entry overwrites: the losing
  // level's later folders, then its earlier ones, then the winning level's
  // the same way.
  const [lower, higher] = dirs.userFirst ? [project, user] : [user, project];
  for (const skill of [...lower.reverse(), ...higher.reverse()]) {
    byName.set(skill.name, skill);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Mark the project skills a worktree has that the project folder doesn't:
 * new on the thread's branch, or not committed. A new thread starts from
 * the commit the project folder has checked out, so one started for such a
 * skill (Run, a schedule) wouldn't find it. A link counts by the shared
 * skill it stands for, as Grove links that in any worktree that has it.
 */
export async function markWorktreeOnly(skills: SkillInfo[], worktreePath: string, repoPath: string): Promise<SkillInfo[]> {
  if (path.resolve(worktreePath) === path.resolve(repoPath)) return skills;
  return Promise.all(skills.map(async (skill) => {
    if (skill.source !== 'project' || !skill.path) return skill;
    const own = path.dirname(skill.path);
    const raw = await fs.promises.readFile(skill.path, 'utf-8').catch(() => '');
    const folder = isSkillLink(raw) ? path.join(worktreePath, SHARED_SKILLS_DIR, path.basename(own)) : own;
    const rel = path.relative(worktreePath, folder);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return skill;
    const inProject = await fs.promises.access(path.join(repoPath, rel, 'SKILL.md')).then(() => true, () => false);
    return inProject ? skill : { ...skill, worktreeOnly: true };
  }));
}

/** A skill name as the Agent Skills format has it (shared/skill-name.ts). */
export function validateSkillName(name: string): void {
  const problem = skillNameProblem(name);
  if (problem) throw new Error(problem);
}

/** Serialize a neutral SkillDefinition into SKILL.md content. The description
 *  is double-quoted so colons and other YAML-significant characters survive
 *  a real YAML parser, not just our line-based reader. */
export function skillManifestContent(def: SkillDefinition): string {
  const description = `"${def.description.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return [
    '---',
    `name: ${def.name}`,
    `description: ${description}`,
    '---',
    '',
    def.instructions.trim(),
    '',
  ].join('\n');
}

/**
 * Write a new skill as `<name>/SKILL.md` in the shared folder, so every agent
 * can use it, plus a link in the agent's own folder when it doesn't read the
 * shared one (Claude Code). Project scope writes into the worktree; user
 * scope under the home directory. Rejects names that collide with an existing
 * skill (or link) at the same scope — overwriting someone's manifest silently
 * would be data loss.
 */
export function writeSkill(worktreePath: string, def: SkillDefinition, dirs: SkillDirs = CLAUDE_SKILL_DIRS): SkillInfo {
  validateSkillName(def.name);
  const descriptionProblem = skillDescriptionProblem(def.description);
  if (descriptionProblem) throw new Error(descriptionProblem);
  if (!def.instructions.trim()) throw new Error('Skill instructions are required');

  const manifestPath = path.join(skillsRoot(worktreePath, def.scope, SHARED_SKILLS_DIR), def.name, 'SKILL.md');
  const linkPath = readsSharedSkills(dirs, def.scope)
    ? null
    : path.join(skillsRoot(worktreePath, def.scope, dirs[def.scope][0]), def.name, 'SKILL.md');
  if (fs.existsSync(manifestPath) || (linkPath && fs.existsSync(linkPath))) {
    throw new Error(`A ${def.scope} skill named "${def.name}" already exists`);
  }
  const content = skillManifestContent(def);
  const folder = path.dirname(manifestPath);
  const newFolder = !fs.existsSync(folder);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(manifestPath, content);
  if (linkPath) {
    try {
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      fs.writeFileSync(linkPath, skillLinkContent(content, def.name, skillLinkTarget(def.scope, def.name)));
    } catch (err) {
      // Claude Code can't see the skill without its link: take back what
      // was written, so the error leaves nothing behind and a retry works.
      fs.rmSync(newFolder ? folder : manifestPath, { recursive: true, force: true });
      throw err;
    }
  }
  // A personal one for every other Claude account too.
  writeLinks(linkRoots(worktreePath, dirs, def.scope), def.scope, def.name, content);
  return {
    name: def.name,
    description: def.description,
    source: def.scope,
    path: manifestPath,
  };
}

// ─── Editing ───
//
// The Skills drawer edits a skill's SKILL.md as text. It names the skill by
// the path listSkills gave it, so only a file listSkills finds can be read or
// written. A Claude Code link stands in for a shared skill, so the shared
// file is the one edited, and Save brings the link in line with it.

/** The listed skill whose SKILL.md is at `skillPath`. */
export async function listedSkill(worktreePath: string, dirs: SkillDirs, skillPath: string): Promise<SkillInfo & { path: string; source: SkillScope }> {
  const wanted = path.resolve(skillPath);
  const skill = (await listSkills(worktreePath, dirs)).find((s) => s.path && path.resolve(s.path) === wanted);
  if (!skill?.path || skill.source === 'session') throw new Error("That skill isn't in this thread's skill folders any more");
  return { ...skill, path: skill.path, source: skill.source };
}

interface EditTarget {
  /** The file edited: the skill's own, or the shared one its link stands in for. */
  path: string;
  raw: string;
  /** The link, when the listed file is one Grove made. */
  link?: { path: string; raw: string };
}

/** Where a listed skill's text lives. A link's shared file is found by its
 *  folder name, as Link does, not from the path written in the link. */
export async function editTarget(worktreePath: string, skill: { name: string; path: string; source: SkillScope }): Promise<EditTarget> {
  const raw = await fs.promises.readFile(skill.path, 'utf-8');
  if (!isSkillLink(raw)) return { path: skill.path, raw };
  const dirName = path.basename(path.dirname(skill.path));
  const sharedPath = path.join(skillsRoot(worktreePath, skill.source, SHARED_SKILLS_DIR), dirName, 'SKILL.md');
  try {
    return { path: sharedPath, raw: await fs.promises.readFile(sharedPath, 'utf-8'), link: { path: skill.path, raw } };
  } catch {
    throw new Error(`"${skill.name}" is a link to ${sharedPath}, which is gone. Grove removes the link when a thread starts or the Skills drawer opens.`);
  }
}

/** A listed skill's SKILL.md, to edit. */
export async function readSkillFile(worktreePath: string, dirs: SkillDirs, skillPath: string): Promise<SkillFile> {
  const target = await editTarget(worktreePath, await listedSkill(worktreePath, dirs, skillPath));
  return { path: target.path, content: skillText(target.raw), ...(target.link ? { linkPath: target.link.path } : {}) };
}

/**
 * Save a listed skill's SKILL.md. `expected` is the text readSkillFile gave:
 * if the file has changed since (the agent edited it, say), nothing is
 * written. The name can't change, as schedules, the turned-off list and
 * links go by it. The file keeps its line endings and byte order mark, so
 * git shows only what changed.
 */
export async function saveSkillFile(worktreePath: string, dirs: SkillDirs, skillPath: string, expected: string, content: string): Promise<SkillInfo> {
  const skill = await listedSkill(worktreePath, dirs, skillPath);
  const target = await editTarget(worktreePath, skill);
  if (skillText(target.raw) !== expected) {
    throw new Error(`${skill.name}'s SKILL.md changed after you opened it. Reload to see the change, then edit again.`);
  }
  const text = skillText(content);
  if (!text.trim()) throw new Error("SKILL.md can't be empty");
  const dirName = path.basename(path.dirname(target.path));
  const name = parseSkillFrontmatter(target.raw).name || dirName;
  const meta = parseSkillFrontmatter(text);
  if ((meta.name || dirName) !== name) {
    throw new Error(`Keep the name "${name}": renaming a skill isn't supported here`);
  }
  const eol = target.raw.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text;
  await fs.promises.writeFile(target.path, target.raw.startsWith('\uFEFF') ? `\uFEFF${eol}` : eol);
  // A shared skill's links, in the agent's folder and every Claude
  // account's, take its new name line and description. The skill is saved
  // by now, so one that can't be written is left for Link.
  const sharedRoot = skillsRoot(worktreePath, skill.source, SHARED_SKILLS_DIR);
  if (target.link || path.resolve(path.dirname(path.dirname(target.path))) === path.resolve(sharedRoot)) {
    const roots = linkRoots(worktreePath, dirs, skill.source);
    if (target.link) roots.push(path.dirname(path.dirname(target.link.path)));
    writeLinks(roots, skill.source, dirName, text, true);
  }
  return { name, description: meta.description ?? '', source: skill.source, path: skill.path };
}

/**
 * Copy a listed project skill to the user's own folders, so every project has
 * it. For every agent, it's kept as a new personal skill is (writeSkill): in
 * `~/.agents/skills`, linked for an agent that doesn't read that folder
 * (Claude Code). For Claude Code only, it goes in the thread's Claude
 * account's own folder instead. The project keeps its copy for the team.
 * The whole folder is copied, scripts and references with it; for a Claude
 * Code link, the shared skill's. Refuses when a personal skill has the name
 * already.
 */
export async function copySkillToUser(worktreePath: string, dirs: SkillDirs, skillPath: string, agents: 'all' | 'claude' = 'all'): Promise<SkillInfo> {
  const skill = await listedSkill(worktreePath, dirs, skillPath);
  if (skill.source !== 'project') throw new Error(`"${skill.name}" is a personal skill already`);
  if (agents === 'claude' && readsSharedSkills(dirs, 'user')) throw new Error("Only Claude Agent's skills can be kept for it alone");
  const target = await editTarget(worktreePath, skill);
  const from = path.dirname(target.path);
  const dirName = path.basename(from);
  const ownRoot = skillsRoot(worktreePath, 'user', dirs.user[0]);
  const to = agents === 'claude' ? path.join(ownRoot, dirName) : path.join(skillsRoot(worktreePath, 'user', SHARED_SKILLS_DIR), dirName);
  const linkPath = agents === 'claude' || readsSharedSkills(dirs, 'user') ? null : path.join(ownRoot, dirName, 'SKILL.md');
  const personal = (await Promise.all([...dirs.user, SHARED_SKILLS_DIR].map((dir) => scanSkillsDir(userSkillsDir(dir), 'user')))).flat();
  if (personal.some((s) => s.name === skill.name) || fs.existsSync(to) || (linkPath && fs.existsSync(linkPath))) {
    throw new Error(`You have a personal skill named "${skill.name}" already`);
  }
  await fs.promises.cp(from, to, { recursive: true, errorOnExist: true, force: false });
  if (linkPath) {
    await fs.promises.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.promises.writeFile(linkPath, skillLinkContent(target.raw, dirName, skillLinkTarget('user', dirName)));
  }
  if (agents === 'all') writeLinks(linkRoots(worktreePath, dirs, 'user'), 'user', dirName, target.raw);
  return { name: skill.name, description: parseSkillFrontmatter(target.raw).description ?? '', source: 'user', path: linkPath ?? path.join(to, 'SKILL.md') };
}
