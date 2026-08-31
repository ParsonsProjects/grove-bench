import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkillFrontmatter, scanSkillsDir, computeSkillsFilter } from './skills.js';

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
