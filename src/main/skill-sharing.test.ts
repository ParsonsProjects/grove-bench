import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linkSkills, setSkillReach, shareSkills, skillSharing, unshareSkill } from './skill-sharing.js';
import { CLAUDE_SKILL_DIRS, SHARED_SKILL_DIRS, isSkillLink, listSkills, skillLinkContent, writeSkill } from './skills.js';

let worktree: string;
let home: string;

beforeEach(() => {
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-share-wt-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-share-home-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(worktree, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

const claudeFile = (root: string, name: string) => path.join(root, '.claude', 'skills', name, 'SKILL.md');
const sharedFile = (root: string, name: string) => path.join(root, '.agents', 'skills', name, 'SKILL.md');

function put(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const skill = (name: string, description = `About ${name}`) => `---\nname: ${name}\ndescription: ${description}\n---\n\nSteps for ${name}\n`;
const names = (list: { name: string }[]) => list.map((s) => s.name).sort();

describe('skillSharing', () => {
  it("lists Claude Code's own skills, shared skills it can't see, and links to deleted ones", async () => {
    put(claudeFile(worktree, 'own'), skill('own'));
    put(path.join(claudeFile(home, 'mine')), skill('mine'));
    put(sharedFile(worktree, 'team'), skill('team'));
    put(sharedFile(home, 'personal'), skill('personal'));
    writeSkill(worktree, { name: 'linked', description: 'd', instructions: 'i', scope: 'project' });
    put(claudeFile(worktree, 'gone'), skillLinkContent(skill('gone'), 'gone', '.agents/skills/gone/SKILL.md'));

    const sharing = await skillSharing(worktree, CLAUDE_SKILL_DIRS);
    expect(names(sharing.toShare)).toEqual(['mine', 'own']);
    expect(names(sharing.toLink)).toEqual(['personal', 'team']);
    expect(sharing.toLink.find((s) => s.name === 'team')).toEqual({ name: 'team', description: 'About team', source: 'project', path: sharedFile(worktree, 'team') });
    expect(names(sharing.broken)).toEqual(['gone']);
  });

  it('finds a link whose shared skill changed since', async () => {
    writeSkill(worktree, { name: 'deploy', description: 'Old', instructions: 'i', scope: 'project' });
    expect((await skillSharing(worktree, CLAUDE_SKILL_DIRS)).toLink).toEqual([]);
    put(sharedFile(worktree, 'deploy'), skill('deploy', 'New'));
    expect((await skillSharing(worktree, CLAUDE_SKILL_DIRS)).toLink.map((s) => s.description)).toEqual(['New']);
  });

  it('counts a link git checked out with CRLF line endings as up to date', async () => {
    writeSkill(worktree, { name: 'deploy', description: 'd', instructions: 'i', scope: 'project' });
    fs.writeFileSync(claudeFile(worktree, 'deploy'), fs.readFileSync(claudeFile(worktree, 'deploy'), 'utf-8').replace(/\n/g, '\r\n'));
    expect((await skillSharing(worktree, CLAUDE_SKILL_DIRS)).toLink).toEqual([]);
  });

  it('leaves a skill alone that is in both folders under the same name', async () => {
    put(claudeFile(worktree, 'dup'), skill('dup', 'Claude copy'));
    put(sharedFile(worktree, 'dup'), skill('dup', 'Shared copy'));
    expect(await skillSharing(worktree, CLAUDE_SKILL_DIRS)).toEqual({ toShare: [], toLink: [], broken: [] });
  });

  it('has nothing to do for an agent that reads the shared folder', async () => {
    put(sharedFile(worktree, 'team'), skill('team'));
    expect(await skillSharing(worktree, SHARED_SKILL_DIRS)).toEqual({ toShare: [], toLink: [], broken: [] });
  });
});

describe('shareSkills', () => {
  it('moves the whole skill folder to the shared one and leaves a link Claude Code lists the same', async () => {
    put(claudeFile(worktree, 'own'), skill('own'));
    put(path.join(worktree, '.claude', 'skills', 'own', 'scripts', 'run.sh'), 'echo hi');
    put(claudeFile(home, 'mine'), skill('mine'));
    const before = await listSkills(worktree);

    expect(await shareSkills(worktree, CLAUDE_SKILL_DIRS)).toEqual({ done: expect.arrayContaining(['own', 'mine']), skipped: [] });
    expect(fs.readFileSync(sharedFile(worktree, 'own'), 'utf-8')).toBe(skill('own'));
    expect(fs.existsSync(path.join(worktree, '.agents', 'skills', 'own', 'scripts', 'run.sh'))).toBe(true);
    expect(fs.existsSync(path.join(worktree, '.claude', 'skills', 'own', 'scripts'))).toBe(false);
    expect(isSkillLink(fs.readFileSync(claudeFile(worktree, 'own'), 'utf-8'))).toBe(true);
    expect(fs.readFileSync(sharedFile(home, 'mine'), 'utf-8')).toBe(skill('mine'));

    const after = await listSkills(worktree);
    expect(after.map(({ name, description, source }) => ({ name, description, source })))
      .toEqual(before.map(({ name, description, source }) => ({ name, description, source })));
    // Another agent now sees them, and there's nothing left to do.
    expect(names(await listSkills(worktree, SHARED_SKILL_DIRS))).toEqual(['mine', 'own']);
    expect(await skillSharing(worktree, CLAUDE_SKILL_DIRS)).toEqual({ toShare: [], toLink: [], broken: [] });
  });

  it('says which skill it could not move and why, and moves the rest', async () => {
    put(claudeFile(worktree, 'a'), skill('a'));
    put(claudeFile(worktree, 'b'), skill('b'));
    const rename = fs.promises.rename;
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith(`${path.sep}a`)) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return rename(from, to);
    });
    expect(await shareSkills(worktree, CLAUDE_SKILL_DIRS)).toEqual({
      done: ['b'],
      skipped: [{ name: 'a', reason: 'a file in it is open in another program' }],
    });
    expect(fs.readFileSync(claudeFile(worktree, 'a'), 'utf-8')).toBe(skill('a'));
  });

  it('moves only the skill asked for, by its path, even when a personal one has the same name', async () => {
    put(claudeFile(worktree, 'own'), skill('own'));
    put(claudeFile(worktree, 'other'), skill('other'));
    put(claudeFile(home, 'own'), skill('own', 'My own'));

    expect(await shareSkills(worktree, CLAUDE_SKILL_DIRS, claudeFile(worktree, 'own'))).toEqual({ done: ['own'], skipped: [] });
    expect(isSkillLink(fs.readFileSync(claudeFile(worktree, 'own'), 'utf-8'))).toBe(true);
    expect(fs.readFileSync(claudeFile(worktree, 'other'), 'utf-8')).toBe(skill('other'));
    expect(fs.readFileSync(claudeFile(home, 'own'), 'utf-8')).toBe(skill('own', 'My own'));
    expect(names((await skillSharing(worktree, CLAUDE_SKILL_DIRS)).toShare)).toEqual(['other', 'own']);

    // One that has nothing to share (it's already shared): nothing happens.
    expect(await shareSkills(worktree, CLAUDE_SKILL_DIRS, claudeFile(worktree, 'own'))).toEqual({ done: [], skipped: [] });
  });

  it('copies across drives when a rename cannot', async () => {
    put(claudeFile(worktree, 'a'), skill('a'));
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
    expect((await shareSkills(worktree, CLAUDE_SKILL_DIRS)).done).toEqual(['a']);
    expect(fs.readFileSync(sharedFile(worktree, 'a'), 'utf-8')).toBe(skill('a'));
    expect(isSkillLink(fs.readFileSync(claudeFile(worktree, 'a'), 'utf-8'))).toBe(true);
  });
});

describe('every Claude account', () => {
  const work = () => path.join(home, '.claude-work', 'skills');
  const dirs = () => ({ ...CLAUDE_SKILL_DIRS, userLinks: ['.claude/skills', work()] });

  it("finds a personal skill another Claude account can't see, once, and Link adds it there", async () => {
    // Shared from the work account's thread: only it has a link.
    put(sharedFile(home, 'notes'), skill('notes'));
    put(path.join(work(), 'notes', 'SKILL.md'), skillLinkContent(skill('notes'), 'notes', path.join(home, '.agents', 'skills', 'notes', 'SKILL.md')));
    put(path.join(work(), 'gone', 'SKILL.md'), skillLinkContent(skill('gone'), 'gone', path.join(home, '.agents', 'skills', 'gone', 'SKILL.md')));

    const sharing = await skillSharing(worktree, dirs());
    expect(names(sharing.toLink)).toEqual(['notes']);
    expect(names(sharing.broken)).toEqual(['gone']);

    await linkSkills(worktree, dirs());
    expect(isSkillLink(fs.readFileSync(claudeFile(home, 'notes'), 'utf-8'))).toBe(true);
    expect(fs.existsSync(path.join(work(), 'gone'))).toBe(false);
    expect(await skillSharing(worktree, dirs())).toEqual({ toShare: [], toLink: [], broken: [] });
  });

  it("links a shared personal skill for every account, and shares only the thread's own", async () => {
    put(claudeFile(home, 'mine'), skill('mine'));
    put(path.join(work(), 'theirs', 'SKILL.md'), skill('theirs'));
    expect(names((await skillSharing(worktree, dirs())).toShare)).toEqual(['mine']);

    await shareSkills(worktree, dirs());
    expect(fs.readFileSync(sharedFile(home, 'mine'), 'utf-8')).toBe(skill('mine'));
    expect(isSkillLink(fs.readFileSync(claudeFile(home, 'mine'), 'utf-8'))).toBe(true);
    expect(isSkillLink(fs.readFileSync(path.join(work(), 'mine', 'SKILL.md'), 'utf-8'))).toBe(true);
    expect(fs.readFileSync(path.join(work(), 'theirs', 'SKILL.md'), 'utf-8')).toBe(skill('theirs'));
  });
});

describe('linkSkills', () => {
  it('adds and updates links, removes ones to deleted skills, and leaves other files alone', async () => {
    put(sharedFile(worktree, 'team'), skill('team'));
    writeSkill(worktree, { name: 'deploy', description: 'Old', instructions: 'i', scope: 'project' });
    put(sharedFile(worktree, 'deploy'), skill('deploy', 'New'));
    put(claudeFile(worktree, 'gone'), skillLinkContent(skill('gone'), 'gone', '.agents/skills/gone/SKILL.md'));
    put(claudeFile(worktree, 'own'), skill('own'));

    expect((await linkSkills(worktree, CLAUDE_SKILL_DIRS)).done.sort()).toEqual(['deploy', 'gone', 'team']);
    expect((await listSkills(worktree)).map((s) => [s.name, s.description])).toEqual([
      ['deploy', 'New'],
      ['own', 'About own'],
      ['team', 'About team'],
    ]);
    expect(fs.existsSync(path.join(worktree, '.claude', 'skills', 'gone'))).toBe(false);
    expect(fs.readFileSync(claudeFile(worktree, 'own'), 'utf-8')).toBe(skill('own'));
    expect(await skillSharing(worktree, CLAUDE_SKILL_DIRS)).toEqual({ toShare: [expect.objectContaining({ name: 'own' })], toLink: [], broken: [] });
  });

  it("links personal skills into a Claude account's own folder", async () => {
    const account = path.join(home, '.claude-work');
    put(sharedFile(home, 'personal'), skill('personal'));
    const dirs = { ...CLAUDE_SKILL_DIRS, user: [path.join(account, 'skills')] };
    expect((await linkSkills(worktree, dirs)).done).toEqual(['personal']);
    expect(isSkillLink(fs.readFileSync(path.join(account, 'skills', 'personal', 'SKILL.md'), 'utf-8'))).toBe(true);
    expect(fs.existsSync(claudeFile(home, 'personal'))).toBe(false);
  });
});

describe('who can use a skill', () => {
  const work = () => path.join(home, '.claude-work', 'skills');
  const dirs = () => ({ ...CLAUDE_SKILL_DIRS, userLinks: ['.claude/skills', work()] });

  it('lets every agent use a Claude-only skill, and takes it back to Claude alone', async () => {
    put(claudeFile(worktree, 'own'), skill('own'));
    put(path.join(worktree, '.claude', 'skills', 'own', 'scripts', 'run.sh'), 'echo hi');
    await setSkillReach(worktree, dirs(), claudeFile(worktree, 'own'), { agents: 'all', projects: 'project' });
    expect(fs.readFileSync(sharedFile(worktree, 'own'), 'utf-8')).toBe(skill('own'));
    expect(isSkillLink(fs.readFileSync(claudeFile(worktree, 'own'), 'utf-8'))).toBe(true);

    await setSkillReach(worktree, dirs(), claudeFile(worktree, 'own'), { agents: 'claude', projects: 'project' });
    expect(fs.readFileSync(claudeFile(worktree, 'own'), 'utf-8')).toBe(skill('own'));
    expect(fs.existsSync(path.join(worktree, '.claude', 'skills', 'own', 'scripts', 'run.sh'))).toBe(true);
    expect(fs.existsSync(path.join(worktree, '.agents', 'skills', 'own'))).toBe(false);
  });

  it("takes a personal skill back to the thread's account alone, removing the other accounts' links", async () => {
    put(claudeFile(home, 'mine'), skill('mine'));
    await setSkillReach(worktree, dirs(), claudeFile(home, 'mine'), { agents: 'all', projects: 'all' });
    expect(isSkillLink(fs.readFileSync(path.join(work(), 'mine', 'SKILL.md'), 'utf-8'))).toBe(true);

    await unshareSkill(worktree, dirs(), claudeFile(home, 'mine'));
    expect(fs.readFileSync(claudeFile(home, 'mine'), 'utf-8')).toBe(skill('mine'));
    expect(fs.existsSync(path.join(home, '.agents', 'skills', 'mine'))).toBe(false);
    expect(fs.existsSync(path.join(work(), 'mine'))).toBe(false);
  });

  it("puts a link back, and moves nothing, when the link's folder holds other files", async () => {
    put(sharedFile(worktree, 'team'), skill('team'));
    await linkSkills(worktree, dirs());
    put(path.join(worktree, '.claude', 'skills', 'team', 'notes.txt'), 'mine');
    await expect(unshareSkill(worktree, dirs(), claudeFile(worktree, 'team'))).rejects.toThrow('has other files in it');
    expect(isSkillLink(fs.readFileSync(claudeFile(worktree, 'team'), 'utf-8'))).toBe(true);
    expect(fs.readFileSync(sharedFile(worktree, 'team'), 'utf-8')).toBe(skill('team'));
  });

  it("copies a project skill to all projects, for every agent or for the thread's Claude account alone", async () => {
    put(claudeFile(worktree, 'a'), skill('a'));
    put(claudeFile(worktree, 'b'), skill('b'));
    await setSkillReach(worktree, dirs(), claudeFile(worktree, 'a'), { agents: 'all', projects: 'all' });
    expect(fs.readFileSync(sharedFile(home, 'a'), 'utf-8')).toBe(skill('a'));
    expect(isSkillLink(fs.readFileSync(path.join(work(), 'a', 'SKILL.md'), 'utf-8'))).toBe(true);

    await setSkillReach(worktree, dirs(), claudeFile(worktree, 'b'), { agents: 'claude', projects: 'all' });
    expect(fs.readFileSync(claudeFile(home, 'b'), 'utf-8')).toBe(skill('b'));
    expect(fs.existsSync(path.join(home, '.agents', 'skills', 'b'))).toBe(false);
    expect(fs.existsSync(path.join(work(), 'b'))).toBe(false);
    // The project keeps both as they were.
    expect(fs.readFileSync(claudeFile(worktree, 'a'), 'utf-8')).toBe(skill('a'));
  });

  it('refuses to narrow a personal skill to one project, to share over a shared one of the name, and to move another agent\'s', async () => {
    put(claudeFile(home, 'mine'), skill('mine'));
    await expect(setSkillReach(worktree, dirs(), claudeFile(home, 'mine'), { agents: 'claude', projects: 'project' })).rejects.toThrow('in all your projects already');

    put(claudeFile(worktree, 'dup'), skill('dup'));
    put(sharedFile(worktree, 'dup'), skill('dup', 'Shared one'));
    await expect(setSkillReach(worktree, dirs(), claudeFile(worktree, 'dup'), { agents: 'all', projects: 'project' })).rejects.toThrow('has a skill named "dup" already');

    put(path.join(worktree, '.gemini', 'skills', 'gem', 'SKILL.md'), skill('gem'));
    const gemini = { project: ['.agents/skills', '.gemini/skills'], user: ['.agents/skills', '.gemini/skills'] };
    await expect(setSkillReach(worktree, gemini, path.join(worktree, '.gemini', 'skills', 'gem', 'SKILL.md'), { agents: 'all', projects: 'project' })).rejects.toThrow("Only Claude Agent's skills");
  });

  it('does nothing when nothing changes', async () => {
    put(claudeFile(worktree, 'own'), skill('own'));
    await setSkillReach(worktree, dirs(), claudeFile(worktree, 'own'), { agents: 'claude', projects: 'project' });
    expect(fs.existsSync(path.join(worktree, '.agents'))).toBe(false);
  });
});
