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
 * location we can scan; those are learned from the agent's system_init
 * message instead (see AgentSessionManager's known-skills registry).
 *
 * Grove writes new skills to the shared folder, `.agents/skills`, which every
 * agent it knows reads except Claude Code. Claude Code sees each through a
 * link in its own folder (skillLinkContent; skill-sharing.ts keeps links up
 * to date).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SkillDefinition, SkillInfo } from '../shared/types.js';

/** Where an agent looks for skills, relative to the project and to the
 *  user's home directory (often the same, e.g. `.claude/skills`). A user
 *  folder may be an absolute path instead, such as a Claude account's own.
 *  Most agents read several (their own and the shared `.agents/skills`): the
 *  first is where Grove writes a new skill, and an earlier folder's skill
 *  wins over a later one of the same name. */
export interface SkillDirs {
  project: readonly string[];
  user: readonly string[];
}

/** A user-level skills folder, made absolute. */
function userSkillsDir(dir: string): string {
  return path.isAbsolute(dir) ? dir : path.join(os.homedir(), dir);
}

/** Claude Code's skill folders. */
export const CLAUDE_SKILL_DIRS: SkillDirs = {
  project: [path.join('.claude', 'skills')],
  user: [path.join('.claude', 'skills')],
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

/** A SKILL.md's frontmatter, without its `---` lines and with LF line
 *  endings; null when it has none. */
export function skillFrontmatter(content: string): string | null {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  return normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] ?? null;
}

/** The link to a shared skill, given its SKILL.md content. */
export function skillLinkContent(sharedContent: string, dirName: string, target: string): string {
  const folder = target.replace(/[\\/]SKILL\.md$/, '');
  return [
    '---',
    skillFrontmatter(sharedContent) ?? `name: ${dirName}`,
    '---',
    '',
    `<!-- ${LINK_MARKER} ${target} -->`,
    `<!-- Grove Bench made this link so Claude Code can use a skill kept for every agent. Edit the skill in ${target}; Link in Grove's Skills drawer updates this copy. -->`,
    '',
    `This skill is kept in \`${target}\`, where every coding agent can find it. Read that file now and follow its instructions. Paths in it are relative to \`${folder}\`.`,
    '',
  ].join('\n');
}

/** Whether a SKILL.md is a link Grove made. */
export function isSkillLink(content: string): boolean {
  return content.includes(`<!-- ${LINK_MARKER} `);
}

/**
 * Extract `name` and `description` from a SKILL.md YAML frontmatter block.
 * Only flat single-line `key: value` pairs are read — enough for the skill
 * manifest format — so a full YAML parser isn't pulled into the main process.
 */
export function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const normalized = content.replace(/^﻿/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(name|description):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    // Strip one layer of matching quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) result[kv[1] as 'name' | 'description'] = value;
  }
  return result;
}

/** Scan one skills directory for `<name>/SKILL.md` manifests, in directory
 *  order. Reads without blocking: it runs on the main process each time a
 *  thread's Skills count shows, across up to five folders per agent. */
export async function scanSkillsDir(dir: string, source: SkillInfo['source']): Promise<SkillInfo[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // directory absent — no skills at this level
  }
  const found = await Promise.all(entries.filter((e) => e.isDirectory()).map(async (entry): Promise<SkillInfo | null> => {
    const manifestPath = path.join(dir, entry.name, 'SKILL.md');
    let content: string;
    try {
      content = await fs.promises.readFile(manifestPath, 'utf-8');
    } catch {
      return null; // no manifest — not a skill
    }
    const meta = parseSkillFrontmatter(content);
    return {
      // The CLI identifies a skill by its frontmatter name, falling back to
      // the directory name.
      name: meta.name || entry.name,
      description: meta.description ?? '',
      source,
      path: manifestPath,
    };
  }));
  return found.filter((s) => s !== null);
}

/**
 * List the skills a session at `worktreePath` can see on disk. Project skills
 * shadow user skills of the same name, matching the CLI's precedence, and an
 * earlier folder's shadow a later one's at the same level.
 */
export async function listSkills(worktreePath: string, dirs: SkillDirs = CLAUDE_SKILL_DIRS): Promise<SkillInfo[]> {
  const [user, project] = await Promise.all([
    Promise.all(dirs.user.map((dir) => scanSkillsDir(userSkillsDir(dir), 'user'))).then((lists) => lists.flat()),
    Promise.all(dirs.project.map((dir) => scanSkillsDir(path.join(worktreePath, dir), 'project'))).then((lists) => lists.flat()),
  ]);
  const byName = new Map<string, SkillInfo>();
  // Lowest precedence first, so each later entry overwrites: later user
  // folders, then earlier ones, then project folders the same way.
  for (const skill of [...user.reverse(), ...project.reverse()]) {
    byName.set(skill.name, skill);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Kebab-case identifier the CLI accepts as a skill directory name. */
export function validateSkillName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error('Skill name must be kebab-case: lowercase letters, digits, and dashes (e.g. "release-notes")');
  }
  if (name.length > 64) {
    throw new Error('Skill name must be 64 characters or fewer');
  }
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
  if (!def.description.trim()) throw new Error('Skill description is required');
  if (!def.instructions.trim()) throw new Error('Skill instructions are required');

  const manifestPath = path.join(skillsRoot(worktreePath, def.scope, SHARED_SKILLS_DIR), def.name, 'SKILL.md');
  const linkPath = readsSharedSkills(dirs, def.scope)
    ? null
    : path.join(skillsRoot(worktreePath, def.scope, dirs[def.scope][0]), def.name, 'SKILL.md');
  if (fs.existsSync(manifestPath) || (linkPath && fs.existsSync(linkPath))) {
    throw new Error(`A ${def.scope} skill named "${def.name}" already exists`);
  }
  const content = skillManifestContent(def);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, content);
  if (linkPath) {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.writeFileSync(linkPath, skillLinkContent(content, def.name, skillLinkTarget(def.scope, def.name)));
  }
  return {
    name: def.name,
    description: def.description,
    source: def.scope,
    path: manifestPath,
  };
}

/**
 * Compute the SDK `skills` allowlist for a session.
 *
 * Returns undefined when nothing is disabled — the option is then omitted so
 * the CLI's own defaults apply (all discovered skills enabled). With disabled
 * names present, the allowlist is every known skill minus the disabled ones.
 * `knownNames` should union on-disk skills with any names previous
 * system_init messages reported (covers plugin skills the scan can't see).
 */
export function computeSkillsFilter(
  knownNames: Iterable<string>,
  disabledNames: string[],
): string[] | undefined {
  if (disabledNames.length === 0) return undefined;
  const disabled = new Set(disabledNames);
  return [...new Set(knownNames)].filter((name) => !disabled.has(name)).sort();
}
