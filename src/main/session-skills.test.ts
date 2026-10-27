import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '../shared/types.js';
import type { ManagedSession } from './session-types.js';
import { CLAUDE_SKILL_DIRS, SHARED_SKILL_DIRS, isSkillLink } from './skills.js';

const adapters = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('./adapters/index.js', () => ({ adapterRegistry: { list: () => adapters.list } }));
vi.mock('./settings.js', () => ({ getSettings: () => ({ claudeAccounts: [] }) }));
vi.mock('./worktree-manager.js', () => ({ worktreeManager: { list: vi.fn() } }));
vi.mock('./session-event-store.js', () => ({ getEventsDir: () => '' }));

import { SessionSkills, missingSkill, missingSkillWarning } from './session-skills.js';

const user = (text: string): AgentEvent => ({ type: 'user_message', text });

describe('missingSkill', () => {
  it("names the skill the latest message asks for when the agent doesn't list it", () => {
    const history = [user('Use the `deploy` skill.'), { type: 'assistant_text', text: 'ok' } as AgentEvent];
    expect(missingSkill(history, ['review'])).toBe('deploy');
    expect(missingSkill([user('Use the `deploy` skill for this task.\n\nShip it')], ['review'])).toBe('deploy');
  });

  it('is null when the skill is there, as a skill or a command, or nothing asks for one', () => {
    expect(missingSkill([user('Use the `deploy` skill.')], ['deploy'])).toBeNull();
    expect(missingSkill([user('Use the `deploy` skill.')], ['review'], ['deploy'])).toBeNull();
    expect(missingSkill([user('Use the `deploy` skill.'), user('Just fix the bug')], ['review'])).toBeNull();
    expect(missingSkill([], ['review'])).toBeNull();
  });

  it("is null when the agent lists no skills, so there's nothing to check against", () => {
    expect(missingSkill([user('Use the `deploy` skill.')], [])).toBeNull();
  });

  it('says what may be wrong', () => {
    expect(missingSkillWarning('deploy', 'Claude Agent')).toContain('"deploy" skill, but Claude Agent has no skill by that name');
  });
});

describe('SessionSkills', () => {
  let worktree: string;
  let home: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-session-skills-wt-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-session-skills-home-'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    adapters.list = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const session = (skills: boolean, skillDirs = CLAUDE_SKILL_DIRS) =>
    ({ id: 's1', worktreePath: worktree, adapter: { capabilities: { skills }, skillDirs } }) as unknown as ManagedSession;

  it('starts a session with the skills turned off, only for an agent whose skills Grove manages', () => {
    const skills = new SessionSkills();
    expect(skills.disabledFor(session(true), ['deploy'])).toEqual(['deploy']);
    expect(skills.disabledFor(session(true), [])).toBeUndefined();
    expect(skills.disabledFor(session(false), ['deploy'])).toBeUndefined();
  });

  it("links a shared skill a new worktree has without its link, before Claude Code starts", async () => {
    const shared = path.join(worktree, '.agents', 'skills', 'team', 'SKILL.md');
    fs.mkdirSync(path.dirname(shared), { recursive: true });
    fs.writeFileSync(shared, '---\nname: team\ndescription: d\n---\n');

    // An agent that reads the shared folder needs none.
    await new SessionSkills().keepLinks(session(false, SHARED_SKILL_DIRS));
    expect(fs.existsSync(path.join(worktree, '.claude'))).toBe(false);

    await new SessionSkills().keepLinks(session(true));
    expect(isSkillLink(fs.readFileSync(path.join(worktree, '.claude', 'skills', 'team', 'SKILL.md'), 'utf-8'))).toBe(true);
  });
});
