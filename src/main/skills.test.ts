import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkillFrontmatter, scanSkillsDir, computeSkillsFilter, validateSkillName, skillManifestContent, writeSkill, listSkills, CLAUDE_SKILL_DIRS, SHARED_SKILL_DIRS, readsSharedSkills, skillLinkContent, skillFrontmatter, isSkillLink } from './skills.js';

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

  it('returns empty for a missing directory', async () => {
    expect(await scanSkillsDir(path.join(dir, 'nope'), 'project')).toEqual([]);
  });

  it('lists skills with parsed metadata and manifest path', async () => {
    addSkill('review', '---\nname: code-review\ndescription: Review diffs\n---\n');
    const result = await scanSkillsDir(dir, 'project');
    expect(result).toEqual([{
      name: 'code-review',
      description: 'Review diffs',
      source: 'project',
      path: path.join(dir, 'review', 'SKILL.md'),
    }]);
  });

  it('falls back to the directory name when frontmatter has no name', async () => {
    addSkill('deploy', '---\ndescription: Ship\n---\n');
    expect((await scanSkillsDir(dir, 'user'))[0]).toMatchObject({ name: 'deploy', source: 'user' });
  });

  it('skips directories without a SKILL.md and plain files', async () => {
    fs.mkdirSync(path.join(dir, 'not-a-skill'));
    fs.writeFileSync(path.join(dir, 'stray.md'), 'x');
    addSkill('real', '---\nname: real\n---\n');
    expect((await scanSkillsDir(dir, 'project')).map((s) => s.name)).toEqual(['real']);
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

  const shared = (root: string, name = 'release-notes') => path.join(root, '.agents', 'skills', name, 'SKILL.md');
  const link = (root: string, name = 'release-notes') => path.join(root, '.claude', 'skills', name, 'SKILL.md');

  it('writes a project skill to the shared folder, linked for Claude Code, and returns its info', async () => {
    const info = writeSkill(worktree, def);
    expect(info).toEqual({ name: 'release-notes', description: 'Draft notes', source: 'project', path: shared(worktree) });
    expect(fs.readFileSync(shared(worktree), 'utf-8')).toContain('Do the thing');
    const linkText = fs.readFileSync(link(worktree), 'utf-8');
    expect(isSkillLink(linkText)).toBe(true);
    expect(linkText).toContain('Read that file now');
    expect(linkText).toContain('`.agents/skills/release-notes/SKILL.md`');
    expect(linkText).not.toContain('Do the thing');
    // Claude Code lists the link under the skill's own name and description.
    expect(await listSkills(worktree)).toEqual([{ name: 'release-notes', description: 'Draft notes', source: 'project', path: link(worktree) }]);
  });

  it('writes a user skill under the home directory, its link pointing at the full path', () => {
    const info = writeSkill(worktree, { ...def, scope: 'user' });
    expect(info).toMatchObject({ source: 'user', path: shared(fakeHome) });
    expect(fs.readFileSync(link(fakeHome), 'utf-8')).toContain(`\`${shared(fakeHome)}\``);
  });

  it("links a user skill into a Claude account's own folder when given one", async () => {
    const accountSkills = path.join(fakeHome, '.claude-work', 'skills');
    const dirs = { ...CLAUDE_SKILL_DIRS, user: [accountSkills] };
    const info = writeSkill(worktree, { ...def, scope: 'user' }, dirs);
    expect(info.path).toBe(shared(fakeHome));
    expect((await listSkills(worktree, dirs)).map((s) => s.path)).toEqual([path.join(accountSkills, 'release-notes', 'SKILL.md')]);
    expect(await listSkills(worktree)).toEqual([]);
  });

  it('writes no link for an agent that reads the shared folder', () => {
    writeSkill(worktree, def, SHARED_SKILL_DIRS);
    expect(fs.existsSync(shared(worktree))).toBe(true);
    expect(fs.existsSync(path.join(worktree, '.claude'))).toBe(false);
  });

  it('reads every folder an agent lists, earlier folders and the project winning', async () => {
    const dirs = { project: ['.gemini/skills', '.agents/skills'], user: ['.gemini/skills', '.agents/skills'] };
    const add = (root: string, folder: string, name: string, description: string) => {
      fs.mkdirSync(path.join(root, folder, name), { recursive: true });
      fs.writeFileSync(path.join(root, folder, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n`);
    };
    add(fakeHome, '.agents/skills', 'triage', 'shared user');
    add(fakeHome, '.gemini/skills', 'triage', 'own user');
    add(fakeHome, '.agents/skills', 'deploy', 'shared user');
    add(worktree, '.agents/skills', 'deploy', 'shared project');
    add(worktree, '.agents/skills', 'review', 'shared project');
    add(worktree, '.gemini/skills', 'review', 'own project');
    expect((await listSkills(worktree, dirs)).map((s) => [s.name, s.description, s.source])).toEqual([
      ['deploy', 'shared project', 'project'],
      ['review', 'own project', 'project'],
      ['triage', 'own user', 'user'],
    ]);
    // A new skill goes in the shared folder, not the agent's own first one.
    expect(writeSkill(worktree, { ...def, name: 'notes' }, dirs).path).toBe(shared(worktree, 'notes'));
  });

  it('refuses to overwrite an existing skill or link at the same scope', () => {
    writeSkill(worktree, def);
    expect(() => writeSkill(worktree, def)).toThrow(/already exists/);
    // A Claude Code skill of the same name, not yet shared.
    fs.mkdirSync(path.dirname(link(worktree, 'own')), { recursive: true });
    fs.writeFileSync(link(worktree, 'own'), '---\nname: own\n---\n');
    expect(() => writeSkill(worktree, { ...def, name: 'own' })).toThrow(/already exists/);
    expect(fs.existsSync(shared(worktree, 'own'))).toBe(false);
  });

  it('rejects invalid names and blank description or instructions', () => {
    expect(() => writeSkill(worktree, { ...def, name: 'Bad Name' })).toThrow();
    expect(() => writeSkill(worktree, { ...def, description: '  ' })).toThrow(/description/);
    expect(() => writeSkill(worktree, { ...def, instructions: '' })).toThrow(/instructions/);
  });
});

describe('links', () => {
  it('knows which agents read the shared folder, per level', () => {
    expect(readsSharedSkills(CLAUDE_SKILL_DIRS, 'project')).toBe(false);
    expect(readsSharedSkills(SHARED_SKILL_DIRS, 'user')).toBe(true);
    expect(readsSharedSkills({ project: ['.github/skills', '.agents/skills'], user: ['.copilot/skills'] }, 'project')).toBe(true);
    expect(readsSharedSkills({ project: ['.github/skills', '.agents/skills'], user: ['.copilot/skills'] }, 'user')).toBe(false);
  });

  it("keeps the shared skill's whole frontmatter, so its settings carry over", () => {
    const sharedText = '---\r\nname: deploy\r\ndescription: Ship it\r\ndisable-model-invocation: true\r\n---\r\nSteps\r\n';
    const text = skillLinkContent(sharedText, 'deploy', '.agents/skills/deploy/SKILL.md');
    expect(skillFrontmatter(text)).toBe('name: deploy\ndescription: Ship it\ndisable-model-invocation: true');
    expect(parseSkillFrontmatter(text)).toEqual({ name: 'deploy', description: 'Ship it' });
    expect(text).toContain('Paths in it are relative to `.agents/skills/deploy`.');
    expect(text).not.toContain('Steps');
  });

  it('names a shared skill without frontmatter after its folder', () => {
    expect(skillFrontmatter(skillLinkContent('Just steps', 'triage', '.agents/skills/triage/SKILL.md'))).toBe('name: triage');
  });

  it('tells a link from a skill', () => {
    expect(isSkillLink(skillLinkContent('x', 'a', 'b'))).toBe(true);
    expect(isSkillLink('---\nname: a\n---\nDo things')).toBe(false);
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
