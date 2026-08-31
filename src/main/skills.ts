/**
 * Skill discovery for agent sessions.
 *
 * Claude Code loads skills from `.claude/skills/<name>/SKILL.md` at two levels:
 * the user's home directory (`~/.claude/skills`) and the project (which for a
 * Grove Bench session is the worktree — project skills are checked into git,
 * so every worktree carries them). Plugin-provided skills have no stable
 * on-disk location we can scan; those are learned from the SDK's system_init
 * message instead (see AgentSessionManager's known-skills registry).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SkillDefinition, SkillInfo } from '../shared/types.js';

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

/** Scan one `.claude/skills` directory for `<name>/SKILL.md` manifests. */
export function scanSkillsDir(dir: string, source: SkillInfo['source']): SkillInfo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // directory absent — no skills at this level
  }
  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, 'SKILL.md');
    let content: string;
    try {
      content = fs.readFileSync(manifestPath, 'utf-8');
    } catch {
      continue; // no manifest — not a skill
    }
    const meta = parseSkillFrontmatter(content);
    skills.push({
      // The CLI identifies a skill by its frontmatter name, falling back to
      // the directory name.
      name: meta.name || entry.name,
      description: meta.description ?? '',
      source,
      path: manifestPath,
    });
  }
  return skills;
}

/**
 * List the skills a session at `worktreePath` can see on disk. Project skills
 * shadow user skills of the same name, matching the CLI's precedence.
 */
export function listSkills(worktreePath: string): SkillInfo[] {
  const project = scanSkillsDir(path.join(worktreePath, '.claude', 'skills'), 'project');
  const user = scanSkillsDir(path.join(os.homedir(), '.claude', 'skills'), 'user');
  const byName = new Map<string, SkillInfo>();
  for (const skill of [...user, ...project]) {
    byName.set(skill.name, skill); // project entries overwrite user entries
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
 * Write a new skill in Claude Code's native format. Project scope writes into
 * the worktree (`<worktree>/.claude/skills`); user scope writes to
 * `~/.claude/skills`. Rejects names that collide with an existing skill at
 * the same scope — overwriting someone's manifest silently would be data loss.
 */
export function writeSkill(worktreePath: string, def: SkillDefinition): SkillInfo {
  validateSkillName(def.name);
  if (!def.description.trim()) throw new Error('Skill description is required');
  if (!def.instructions.trim()) throw new Error('Skill instructions are required');

  const root = def.scope === 'project' ? worktreePath : os.homedir();
  const skillDir = path.join(root, '.claude', 'skills', def.name);
  const manifestPath = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(manifestPath)) {
    throw new Error(`A ${def.scope} skill named "${def.name}" already exists`);
  }
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(manifestPath, skillManifestContent(def));
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
