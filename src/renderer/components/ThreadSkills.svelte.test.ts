import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import ThreadSkills from './ThreadSkills.svelte';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { schedulesStore } from '../stores/schedules.svelte.js';
import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';

const skills = [{ name: 'triage', description: 'Sort new issues', source: 'project' as const }];

function thread(agentType: string) {
  store.sessions = [{ id: 't1', branch: 'b', repoPath: '/repo', status: 'running', agentType, createdAt: 0 }] as typeof store.sessions;
}

/** Open a skill card's ⋯ menu; its items' names. */
async function openMenu(skill: string): Promise<string[]> {
  await fireEvent.click(await screen.findByRole('button', { name: `More for ${skill}` }));
  return screen.getAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '');
}

/** The folder badges on cards of skills only Claude Agent's folders have. */
const folderBadges = () => [...document.querySelectorAll<HTMLElement>('[data-slot="badge"].font-mono')];

/** Choose an item from a skill card's ⋯ menu. */
async function choose(skill: string, item: string) {
  await openMenu(skill);
  await fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo'];
  agentsStore.list = [
    { id: 'claude-code', displayName: 'Claude Code', capabilities: { skills: true }, isDefault: true },
    { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: { skills: false } },
  ];
  agentsStore.loaded = true;
  skillsPanelStore.showThread();
  mockGroveBench.listSkills.mockResolvedValue(skills);
});

afterEach(() => {
  cleanup();
  skillsPanelStore.close();
  skillsPanelStore.collapsed = [];
  delete messageStore.systemInfoBySession.t1;
  store.sessions = [];
  store.repos = [];
  settingsStore.current = { ...settingsStore.current, disabledSkills: [] };
});

describe('ThreadSkills', () => {
  it("runs a skill in a new thread on the thread's own agent, and closes the drawer once it starts", async () => {
    thread('gemini-cli');
    const runSkill = vi.spyOn(schedulesStore, 'runSkill').mockResolvedValue(true);
    render(ThreadSkills, { sessionId: 't1' });
    await fireEvent.click(await screen.findByRole('button', { name: 'Run triage in a new thread' }));
    expect(runSkill).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: '/repo', agentId: 'gemini-cli', skill: 'triage', note: '', start: 'new', permissionMode: '',
    }));
    await waitFor(() => expect(skillsPanelStore.open).toBe(false));
    runSkill.mockRestore();
  });

  it("keeps the drawer open when the thread doesn't start", async () => {
    thread('gemini-cli');
    const runSkill = vi.spyOn(schedulesStore, 'runSkill').mockResolvedValue(false);
    render(ThreadSkills, { sessionId: 't1' });
    await fireEvent.click(await screen.findByRole('button', { name: 'Run triage in a new thread' }));
    await waitFor(() => expect(runSkill).toHaveBeenCalled());
    expect(skillsPanelStore.open).toBe(true);
    runSkill.mockRestore();
  });

  it('opens the Scheduled tab on a new schedule for the skill', async () => {
    thread('gemini-cli');
    render(ThreadSkills, { sessionId: 't1' });
    await fireEvent.click(await screen.findByRole('button', { name: 'Schedule triage' }));
    expect(skillsPanelStore.tab).toBe('scheduled');
    expect(skillsPanelStore.form).toEqual({ repoPath: '/repo', initial: { agentId: 'gemini-cli', skill: 'triage' } });
  });

  it("offers turning off and suggesting skills only for an agent Grove manages them for, and adding for any", async () => {
    thread('gemini-cli');
    render(ThreadSkills, { sessionId: 't1' });
    await screen.findByRole('button', { name: 'Run triage in a new thread' });
    // Nothing for its menu: no file, and it can't be turned off.
    expect(screen.queryByRole('button', { name: 'More for triage' })).toBeNull();
    expect(screen.getByRole('button', { name: /Add skill/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull();
    expect(screen.getByText(/Gemini CLI's own folders/)).toBeInTheDocument();
    cleanup();

    thread('claude-code');
    render(ThreadSkills, { sessionId: 't1' });
    expect(await openMenu('triage')).toEqual(['Disable']);
    expect(screen.getByRole('button', { name: /Add skill/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeInTheDocument();
  });

  it("shows no Claude-only controls until the agent list says which agent this is", async () => {
    thread('claude-code');
    agentsStore.loaded = false;
    mockGroveBench.listAdapters.mockReturnValue(new Promise(() => {}));
    render(ThreadSkills, { sessionId: 't1' });
    await screen.findByRole('button', { name: 'Run triage in a new thread' });
    expect(screen.queryByRole('button', { name: 'More for triage' })).toBeNull();
  });

  it("doesn't apply Claude Code's turned-off list to another agent", async () => {
    settingsStore.current = { ...settingsStore.current, disabledSkills: ['triage'] };
    thread('gemini-cli');
    render(ThreadSkills, { sessionId: 't1' });
    expect(await screen.findByRole('button', { name: 'Run triage in a new thread' })).toBeInTheDocument();
    cleanup();

    thread('claude-code');
    render(ThreadSkills, { sessionId: 't1' });
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run triage in a new thread' })).toBeNull();
  });

  it('has no Share or Link to offer when every skill is shared and linked', async () => {
    thread('claude-code');
    render(ThreadSkills, { sessionId: 't1' });
    await screen.findByRole('button', { name: 'Run triage in a new thread' });
    expect(mockGroveBench.getSkillSharing).toHaveBeenCalledWith('t1', '/repo');
    expect(screen.queryByRole('button', { name: /^Share/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Link/ })).toBeNull();
  });

  it("shares Claude Agent's own skills, then lists again and says what it couldn't move", async () => {
    thread('claude-code');
    mockGroveBench.getSkillSharing.mockResolvedValueOnce({
      toShare: [{ name: 'triage', description: '', source: 'project' }, { name: 'deploy', description: '', source: 'user' }],
      toLink: [],
      broken: [],
    });
    mockGroveBench.shareSkills.mockResolvedValueOnce({ done: ['triage'], skipped: [{ name: 'deploy', reason: 'a file in it is open in another program' }] });
    render(ThreadSkills, { sessionId: 't1' });
    expect(await screen.findByText("2 skills are only in Claude Agent's folders")).toBeInTheDocument();
    expect(screen.getByText(/triage and deploy are only in/)).toBeInTheDocument();
    expect(mockGroveBench.linkSkills).not.toHaveBeenCalled();
    mockGroveBench.listSkills.mockClear();
    await fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(mockGroveBench.shareSkills).toHaveBeenCalledWith('t1', '/repo');
    await waitFor(() => expect(store.error).toBe(`Couldn't share "deploy" (a file in it is open in another program).`));
    await waitFor(() => expect(screen.queryByText("2 skills are only in Claude Agent's folders")).toBeNull());
    expect(mockGroveBench.listSkills).toHaveBeenCalled();
    store.setError(null);
  });

  it('adds, updates and removes Claude Agent links', async () => {
    thread('claude-code');
    mockGroveBench.getSkillSharing.mockResolvedValueOnce({
      toShare: [],
      toLink: [{ name: 'team', description: '', source: 'project' }],
      broken: [{ name: 'gone', description: '', source: 'project' }],
    });
    render(ThreadSkills, { sessionId: 't1' });
    expect(await screen.findByText('2 Claude Agent links need updating')).toBeInTheDocument();
    expect(screen.getByText(/adds or updates the links for team, and removes the links to gone, which was deleted\./)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(mockGroveBench.linkSkills).toHaveBeenCalledWith('t1', '/repo');
    expect(mockGroveBench.shareSkills).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Link' })).toBeNull());
    expect(store.error).toBeNull();
  });

  it('shares, then links, from one line when both are needed, and says what failed in each', async () => {
    thread('claude-code');
    mockGroveBench.getSkillSharing.mockResolvedValueOnce({
      toShare: [{ name: 'own', description: '', source: 'project' }],
      toLink: [{ name: 'team', description: '', source: 'project' }],
      broken: [],
    });
    const order: string[] = [];
    mockGroveBench.shareSkills.mockImplementationOnce(async () => { order.push('share'); return { done: ['own'], skipped: [] }; });
    mockGroveBench.linkSkills.mockImplementationOnce(async () => { order.push('link'); return { done: [], skipped: [{ name: 'team', reason: 'denied' }] }; });
    render(ThreadSkills, { sessionId: 't1' });
    expect(await screen.findByText("1 skill is only in Claude Agent's folders · 1 Claude Agent link needs updating")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Share and link' }));
    await waitFor(() => expect(order).toEqual(['share', 'link']));
    await waitFor(() => expect(store.error).toBe(`Couldn't link "team" (denied).`));
    store.setError(null);
  });

  it('puts Add skill at the top and the skills before suggestions, with a quiet Disable', async () => {
    thread('claude-code');
    mockGroveBench.getSkillSuggestions.mockResolvedValueOnce([
      { id: 's1', name: 'smoke-test', description: 'd', rationale: 'Same command in 5 threads', evidence: [], draftInstructions: '', sessionCount: 5 },
    ]);
    render(ThreadSkills, { sessionId: 't1' });
    const ask = await screen.findByRole('button', { name: 'Ask agent' });
    const run = screen.getByRole('button', { name: 'Run triage in a new thread' });
    const add = screen.getByRole('button', { name: /Add skill/ });
    expect(add.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(run.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Not red: turning a skill off can be undone.
    await openMenu('triage');
    expect(screen.getByRole('menuitem', { name: 'Disable' }).className).not.toMatch(/(^|\s)(text|hover:bg)-destructive/);
  });

  /** The running agent reports a skill with no file Grove can scan. */
  function pluginSkill() {
    messageStore.systemInfoBySession.t1 = { tools: [], agents: [], skills: ['engineering:code-review'], slashCommands: [], mcpServers: [] };
  }

  const many = [
    { name: 'release-notes', description: 'Draft notes from merged pull requests', source: 'project' as const, path: '/repo/.claude/skills/release-notes/SKILL.md' },
    { name: 'triage', description: 'Sort new issues', source: 'project' as const, path: '/repo/.claude/skills/triage/SKILL.md' },
    { name: 'deploy', description: 'Ship to staging', source: 'user' as const, path: '/home/me/.claude/skills/deploy/SKILL.md' },
  ];

  it('lists skills in sections by where they live, with counts, plugin ones from the agent last', async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    pluginSkill();
    render(ThreadSkills, { sessionId: 't1' });
    await screen.findByRole('button', { name: 'Run deploy in a new thread' });
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.replace(/\s+/g, ' ').trim());
    expect(headings).toEqual([
      'Project 2 In this project, for anyone working on it',
      'Personal 1 In your user folder, for all your projects',
      'Plugin and built-in 1 From the running agent, with no file to edit',
    ]);
    const personal = screen.getByRole('region', { name: /^Personal/ });
    expect(within(personal).getByText('deploy')).toBeInTheDocument();
    expect(within(personal).queryByText('triage')).toBeNull();
  });

  it('folds a section away, and searches every section by name and description', async () => {
    thread('gemini-cli');
    mockGroveBench.listSkills.mockResolvedValue(many);
    render(ThreadSkills, { sessionId: 't1' });
    const project = await screen.findByRole('button', { name: /^Project/ });
    await fireEvent.click(project);
    expect(project).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Run triage in a new thread' })).toBeNull();

    // A search shows every match, folded section or not.
    const search = screen.getByRole('searchbox', { name: 'Search skills' });
    await fireEvent.input(search, { target: { value: 'pull requests' } });
    expect(screen.getByRole('button', { name: 'Run release-notes in a new thread' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run triage in a new thread' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^Personal/ })).toBeNull();

    await fireEvent.input(search, { target: { value: 'kubernetes' } });
    expect(screen.getByText('No skills match "kubernetes".')).toBeInTheDocument();

    await fireEvent.input(search, { target: { value: '' } });
    expect(screen.queryByRole('button', { name: 'Run triage in a new thread' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Run deploy in a new thread' })).toBeInTheDocument();
  });

  it('offers Edit for a skill with a file, even one turned off, opening it in the editor', async () => {
    thread('claude-code');
    settingsStore.current = { ...settingsStore.current, disabledSkills: ['triage'] };
    mockGroveBench.listSkills.mockResolvedValue(many);
    pluginSkill();
    render(ThreadSkills, { sessionId: 't1' });
    // Turned off, it keeps Enable in view and has no Disable in its menu.
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeInTheDocument();
    // A skill only the agent reports has no file to edit.
    expect(await openMenu('engineering:code-review')).toEqual(['Disable']);

    expect(await openMenu('triage')).toEqual(['Edit SKILL.md', 'Open folder', 'Use in all my projects']);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit SKILL.md' }));
    expect(skillsPanelStore.edit).toMatchObject({ sessionId: 't1', skill: many[1], file: null });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it("marks Claude Code's own skills that other agents can't see yet", async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    mockGroveBench.getSkillSharing.mockResolvedValueOnce({ toShare: [many[1]], toLink: [], broken: [] });
    render(ThreadSkills, { sessionId: 't1' });
    await waitFor(() => expect(folderBadges()).toHaveLength(1));
    expect(folderBadges()[0]).toHaveTextContent('.claude/skills');
    expect(folderBadges()[0].closest('div')).toHaveTextContent('triage');
  });

  it("shares one of Claude Code's own skills from its card", async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    mockGroveBench.getSkillSharing.mockResolvedValueOnce({ toShare: [many[1]], toLink: [], broken: [] });
    mockGroveBench.shareSkills.mockResolvedValueOnce({ done: ['triage'], skipped: [] });
    render(ThreadSkills, { sessionId: 't1' });
    await waitFor(() => expect(folderBadges()).toHaveLength(1));
    // Only a skill other agents can't see yet has it.
    expect(await openMenu('release-notes')).not.toContain('Let every agent use it (this project)');

    await choose('triage', 'Let every agent use it (this project)');
    expect(mockGroveBench.shareSkills).toHaveBeenCalledWith('t1', '/repo', many[1].path);
    // Listed again: shared now.
    await waitFor(() => expect(folderBadges()).toHaveLength(0));
    expect(await openMenu('triage')).not.toContain('Let every agent use it (this project)');
    expect(store.error).toBeNull();
  });

  it("says why a skill couldn't be shared from its card", async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    mockGroveBench.getSkillSharing
      .mockResolvedValueOnce({ toShare: [many[1]], toLink: [], broken: [] })
      .mockResolvedValueOnce({ toShare: [many[1]], toLink: [], broken: [] });
    mockGroveBench.shareSkills.mockResolvedValueOnce({ done: [], skipped: [{ name: 'triage', reason: 'a file in it is open in another program' }] });
    render(ThreadSkills, { sessionId: 't1' });
    await waitFor(() => expect(folderBadges()).toHaveLength(1));
    await choose('triage', 'Let every agent use it (this project)');
    await waitFor(() => expect(store.error).toBe('Couldn\'t share "triage" (a file in it is open in another program).'));
    await openMenu('triage');
    expect(screen.getByRole('menuitem', { name: 'Let every agent use it (this project)' })).toBeEnabled();
    store.setError(null);
  });

  it('copies a project skill to the personal ones, and says so', async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    mockGroveBench.copySkillToUser.mockResolvedValueOnce({ ...many[1], source: 'user', path: '/home/me/.claude/skills/triage/SKILL.md' });
    render(ThreadSkills, { sessionId: 't1' });
    // Only project skills have it.
    expect(await openMenu('deploy')).not.toContain('Use in all my projects');

    const listings = mockGroveBench.listSkills.mock.calls.length;
    await choose('triage', 'Use in all my projects');
    expect(mockGroveBench.copySkillToUser).toHaveBeenCalledWith('t1', '/repo', many[1].path);
    const notice = await screen.findByText(/is in all your projects now/);
    expect(notice).toHaveTextContent('triage is in all your projects now, for every agent. The project keeps its copy for your team. Claude Agent uses yours where both are.');
    await waitFor(() => expect(mockGroveBench.listSkills.mock.calls.length).toBeGreaterThan(listings));
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/is in all your projects now/)).toBeNull();
  });

  it("says why a skill couldn't be copied to the personal ones", async () => {
    thread('gemini-cli');
    mockGroveBench.listSkills.mockResolvedValue(many);
    mockGroveBench.copySkillToUser.mockRejectedValueOnce(new Error('Error invoking remote method \'skills:copyToUser\': Error: You have a personal skill named "triage" already'));
    render(ThreadSkills, { sessionId: 't1' });
    await choose('triage', 'Use in all my projects');
    await waitFor(() => expect(store.error).toBe('Couldn\'t add "triage" to all your projects: You have a personal skill named "triage" already'));
    expect(screen.queryByText(/is in all your projects now/)).toBeNull();
    store.setError(null);
  });

  it("marks no skill Claude only in another agent's thread, as Copilot and OpenCode read .claude/skills too", async () => {
    thread('gemini-cli');
    mockGroveBench.listSkills.mockResolvedValue(many);
    mockGroveBench.getSkillSharing.mockResolvedValueOnce({ toShare: [many[1]], toLink: [], broken: [] });
    render(ThreadSkills, { sessionId: 't1' });
    // Shown once the sharing check is in.
    await screen.findByText("1 skill is only in Claude Agent's folders");
    expect(folderBadges()).toHaveLength(0);
    expect(await openMenu('triage')).toEqual(['Edit SKILL.md', 'Open folder', 'Use in all my projects']);
  });

  it("opens a card's menu on a right-click, and Escape closes it without closing the drawer", async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    render(ThreadSkills, { sessionId: 't1' });
    const card = (await screen.findByText('deploy')).closest('[role="presentation"]')!;
    await fireEvent.contextMenu(card, { clientX: 10, clientY: 20 });
    expect(screen.getByRole('menu', { name: 'deploy' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Edit SKILL.md', 'Open folder', 'Disable']);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(skillsPanelStore.open).toBe(true);
  });

  it("opens the folder a skill's SKILL.md is in, and says when it can't", async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    render(ThreadSkills, { sessionId: 't1' });
    await choose('deploy', 'Open folder');
    expect(mockGroveBench.showSkillFolder).toHaveBeenCalledWith('t1', '/repo', many[2].path);

    mockGroveBench.showSkillFolder.mockRejectedValueOnce(new Error('Error invoking remote method \'skills:showFolder\': Error: That skill isn\'t in this thread\'s skill folders any more'));
    await choose('triage', 'Open folder');
    await waitFor(() => expect(store.error).toBe('Couldn\'t open the folder "triage" is in: That skill isn\'t in this thread\'s skill folders any more'));
    store.setError(null);
  });

  it("says a personal skill only the thread's Claude account can use, and offers it to every agent in all projects", async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    mockGroveBench.getSkillSharing.mockResolvedValueOnce({ toShare: [many[1], many[2]], toLink: [], broken: [] });
    render(ThreadSkills, { sessionId: 't1' });
    await waitFor(() => expect(folderBadges()).toHaveLength(2));
    const [project, personal] = folderBadges();
    expect(project).toHaveAttribute('title', expect.stringContaining("Only in Claude Agent's folder"));
    expect(personal).toHaveTextContent('.claude/skills');
    expect(personal).toHaveAttribute('title', expect.stringContaining("Only in Claude Code's own folder, which other Claude accounts"));
    expect(await openMenu('deploy')).toContain('Let every agent use it (all projects)');
    expect(await openMenu('triage')).toContain('Let every agent use it (this project)');
  });
});
