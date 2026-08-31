import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkillFrontmatter, scanSkillsDir, computeSkillsFilter, validateSkillName, skillManifestContent, writeSkill } from './skills.js';

describe('parseSkillFrontmatter', () => {
  it('reads name and description from a frontmatter block', () => {
    const md = '---\nname: code-review\ndescription: Review the current diff\n---\n\n# Body\n';
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'code-review', description: 'Review the current diff' });
  });

  it('strips matching quotes around values', () => {
    const md = '---\nname: "deploy"\ndescription: \'Ship it\'\n---\n';
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'deploy', description: 'Ship it' });
  });

  it('handles CRLF line endings', () => {
    const md = '---\r\nname: win-skill\r\ndescription: Windows manifest\r\n---\r\nbody';
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'win-skill', description: 'Windows manifest' });
  });

  it('returns empty for content without frontmatter', () => {
    expect(parseSkillFrontmatter('# Just a heading\n')).toEqual({});
  });

  it('ignores keys other than name and description', () => {
    const md = '---\nname: x\nallowed-tools: Bash\n---\n';
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'x' });
  });

  it('keeps a description containing colons intact', () => {
    const md = '---\ndescription: Use when: reviewing, or fixing\n---\n';
    expect(parseSkillFrontmatter(md)).toEqual({ description: 'Use when: reviewing, or fixing' });
  });
});

describe('scanSkillsDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-skills-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function addSkill(folder: string, content: string) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
    fs.writeFileSync(path.join(dir, folder, 'SKILL.md'), content);
  }

  it('returns empty for a missing directory', () => {
    expect(scanSkillsDir(path.join(dir, 'nope'), 'project')).toEqual([]);
  });

  it('lists skills with parsed metadata and manifest path', () => {
    addSkill('review', '---\nname: code-review\ndescription: Review diffs\n---\n');
    const result = scanSkillsDir(dir, 'project');
    expect(result).toEqual([{
      name: 'code-review',
      description: 'Review diffs',
      source: 'project',
      path: path.join(dir, 'review', 'SKILL.md'),
    }]);
  });

  it('falls back to the directory name when frontmatter has no name', () => {
    addSkill('deploy', '---\ndescription: Ship\n---\n');
    expect(scanSkillsDir(dir, 'user')[0]).toMatchObject({ name: 'deploy', source: 'user' });
  });

  it('skips directories without a SKILL.md and plain files', () => {
    fs.mkdirSync(path.join(dir, 'not-a-skill'));
    fs.writeFileSync(path.join(dir, 'stray.md'), 'x');
    addSkill('real', '---\nname: real\n---\n');
    expect(scanSkillsDir(dir, 'project').map((s) => s.name)).toEqual(['real']);
  });
});

describe('validateSkillName', () => {
  it('accepts kebab-case names', () => {
    expect(() => validateSkillName('release-notes')).not.toThrow();
    expect(() => validateSkillName('pdf2')).not.toThrow();
  });

  it('rejects uppercase, spaces, leading dashes, and path characters', () => {
    for (const bad of ['Release', 'my skill', '-lead', '../escape', 'a/b', '']) {
      expect(() => validateSkillName(bad)).toThrow();
    }
  });
});

describe('skillManifestContent', () => {
  it('round-trips through the frontmatter parser, colons included', () => {
    const md = skillManifestContent({
      name: 'deploy',
      description: 'Use when: shipping fixes',
      instructions: '# Steps\n\n1. Build',
      scope: 'project',
    });
    expect(parseSkillFrontmatter(md)).toEqual({
      name: 'deploy',
      description: 'Use when: shipping fixes',
    });
    expect(md).toContain('# Steps');
    expect(md.startsWith('---\nname: deploy\n')).toBe(true);
  });

  it('quotes the description so YAML-significant characters survive', () => {
    const md = skillManifestContent({
      name: 'x', description: 'He said "go"', instructions: 'i', scope: 'user',
    });
    expect(md).toContain('description: "He said \\"go\\""');
  });
});

describe('writeSkill', () => {
  let worktree: string;
  let fakeHome: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-home-'));
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  const def = { name: 'release-notes', description: 'Draft notes', instructions: 'Do the thing', scope: 'project' as const };

  it('writes a project skill into the worktree and returns its info', () => {
    const info = writeSkill(worktree, def);
    const manifestPath = path.join(worktree, '.claude', 'skills', 'release-notes', 'SKILL.md');
    expect(info).toEqual({ name: 'release-notes', description: 'Draft notes', source: 'project', path: manifestPath });
    expect(scanSkillsDir(path.join(worktree, '.claude', 'skills'), 'project')[0]).toMatchObject({
      name: 'release-notes',
      description: 'Draft notes',
    });
  });

  it('writes a user skill under the home directory', () => {
    const info = writeSkill(worktree, { ...def, scope: 'user' });
    expect(info.path).toBe(path.join(fakeHome, '.claude', 'skills', 'release-notes', 'SKILL.md'));
    expect(info.source).toBe('user');
  });

  it('refuses to overwrite an existing skill at the same scope', () => {
    writeSkill(worktree, def);
    expect(() => writeSkill(worktree, def)).toThrow(/already exists/);
  });

  it('rejects invalid names and blank description or instructions', () => {
    expect(() => writeSkill(worktree, { ...def, name: 'Bad Name' })).toThrow();
    expect(() => writeSkill(worktree, { ...def, description: '  ' })).toThrow(/description/);
    expect(() => writeSkill(worktree, { ...def, instructions: '' })).toThrow(/instructions/);
  });
});

describe('computeSkillsFilter', () => {
  it('returns undefined when nothing is disabled (CLI defaults apply)', () => {
    expect(computeSkillsFilter(['a', 'b'], [])).toBeUndefined();
  });

  it('returns every known skill minus the disabled ones, sorted', () => {
    expect(computeSkillsFilter(['pdf', 'docx', 'deploy'], ['deploy'])).toEqual(['docx', 'pdf']);
  });

  it('dedupes known names and tolerates disabling an unknown skill', () => {
    expect(computeSkillsFilter(['a', 'a', 'b'], ['ghost'])).toEqual(['a', 'b']);
  });

  it('can produce an empty allowlist when everything is disabled', () => {
    expect(computeSkillsFilter(['a'], ['a'])).toEqual([]);
  });
});
