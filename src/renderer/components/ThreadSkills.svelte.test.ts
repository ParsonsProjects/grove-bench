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
  mockGroveBench.getSkillSharing.mockImplementation(() => Promise.resolve({ toShare: [], toLink: [], broken: [] }));
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

    expect(await openMenu('triage')).toEqual(['Edit SKILL.md', 'Open folder', 'Who can use it…']);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit SKILL.md' }));
    expect(skillsPanelStore.edit).toMatchObject({ sessionId: 't1', skill: many[1], file: null });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it("opens a card's menu on a right-click, and Escape closes it without closing the drawer", async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    render(ThreadSkills, { sessionId: 't1' });
    const card = (await screen.findByText('deploy')).closest('[role="presentation"]')!;
    await fireEvent.contextMenu(card, { clientX: 10, clientY: 20 });
    expect(screen.getByRole('menu', { name: 'deploy' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Edit SKILL.md', 'Open folder', 'Who can use it…', 'Disable']);
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


  /** A skill card's text, by the skill's name. */
  const card = async (name: string) => (await screen.findByText(name, { selector: 'span.font-mono' })).closest('[role="presentation"]') as HTMLElement;

  it('says on each card who can use the skill: which agents, and which projects', async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    mockGroveBench.getSkillSharing.mockResolvedValue({ toShare: [many[1], many[2]], toLink: [], broken: [] });
    pluginSkill();
    render(ThreadSkills, { sessionId: 't1' });
    await waitFor(async () => expect(await card('triage')).toHaveTextContent('Claude only · This project'));
    expect(await card('release-notes')).toHaveTextContent('All agents · This project');
    // A personal one in Claude Code's own folder is the thread's account's alone.
    expect(await card('deploy')).toHaveTextContent('Claude Code only · All my projects');
    expect(await card('engineering:code-review')).not.toHaveTextContent('·');
  });

  it("in another agent's thread, names its own folders as its alone and .agents/skills as every agent's", async () => {
    thread('gemini-cli');
    mockGroveBench.listSkills.mockResolvedValue([
      { name: 'mine', description: '', source: 'project', path: '/repo/.gemini/skills/mine/SKILL.md' },
      { name: 'ours', description: '', source: 'user', path: '/home/me/.agents/skills/ours/SKILL.md' },
    ]);
    render(ThreadSkills, { sessionId: 't1' });
    expect(await card('mine')).toHaveTextContent('Gemini CLI only · This project');
    expect(await card('ours')).toHaveTextContent('All agents · All my projects');
    // Grove keeps no Claude links in it.
    expect(mockGroveBench.linkSkills).not.toHaveBeenCalled();
  });

  it('keeps Claude Agent links in line without asking, once the agent list says it is Claude Code, and has no notice', async () => {
    thread('claude-code');
    mockGroveBench.getSkillSharing.mockResolvedValueOnce({ toShare: [{ name: 'own', description: '', source: 'project' }], toLink: [{ name: 'team', description: '', source: 'project' }], broken: [] });
    render(ThreadSkills, { sessionId: 't1' });
    await waitFor(() => expect(mockGroveBench.linkSkills).toHaveBeenCalledWith('t1', '/repo'));
    await screen.findByRole('button', { name: 'Run triage in a new thread' });
    expect(screen.queryByText(/only in Claude Agent's folders|link needs updating/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Share|Link)/ })).toBeNull();
  });

  it('lets every agent use a Claude-only skill from "Who can use it", saying first what that does', async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    mockGroveBench.getSkillSharing.mockResolvedValue({ toShare: [many[1]], toLink: [], broken: [] });
    render(ThreadSkills, { sessionId: 't1' });
    await waitFor(async () => expect(await card('triage')).toHaveTextContent('Claude only'));
    await choose('triage', 'Who can use it…');
    const form = screen.getByRole('group', { name: 'Who can use triage' });
    expect(within(form).getByText('No change.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Apply' })).toBeDisabled();

    await fireEvent.click(within(form).getByRole('radio', { name: 'All agents' }));
    expect(within(form).getByText(/Moves it to the project's \.agents\/skills, where every agent looks/)).toBeInTheDocument();
    await fireEvent.click(within(form).getByRole('button', { name: 'Apply' }));
    expect(mockGroveBench.setSkillReach).toHaveBeenCalledWith('t1', '/repo', many[1].path, { agents: 'all', projects: 'project' });
    expect(await screen.findByText('"triage" is for every agent in this project now.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Who can use triage' })).toBeNull();
  });

  it('copies a project skill to all projects, for every agent or the thread\'s Claude account alone', async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    render(ThreadSkills, { sessionId: 't1' });
    await choose('release-notes', 'Who can use it…');
    let form = screen.getByRole('group', { name: 'Who can use release-notes' });
    await fireEvent.click(within(form).getByRole('radio', { name: 'All my projects' }));
    expect(within(form).getByText(/Copies it to ~\/\.agents\/skills, for every agent in all your projects/)).toBeInTheDocument();
    await fireEvent.click(within(form).getByRole('radio', { name: 'Claude only' }));
    expect(within(form).getByText(/Copies it to Claude Code's own folder, for it alone in all your projects/)).toBeInTheDocument();
    await fireEvent.click(within(form).getByRole('button', { name: 'Apply' }));
    expect(mockGroveBench.setSkillReach).toHaveBeenCalledWith('t1', '/repo', many[0].path, { agents: 'claude', projects: 'all' });
    expect(await screen.findByText(/"release-notes" is for Claude Code alone in all your projects now\. The project keeps its copy for your team\./)).toBeInTheDocument();

    // A personal skill is in every project already.
    await choose('deploy', 'Who can use it…');
    form = screen.getByRole('group', { name: 'Who can use deploy' });
    expect(within(form).getByRole('radio', { name: 'This project' })).toBeDisabled();
  });

  it("asks only about projects in another agent's thread, and says why a change couldn't be made", async () => {
    thread('gemini-cli');
    mockGroveBench.listSkills.mockResolvedValue(many);
    mockGroveBench.setSkillReach.mockRejectedValueOnce(new Error('Error invoking remote method \'skills:setReach\': Error: You have a personal skill named "triage" already'));
    render(ThreadSkills, { sessionId: 't1' });
    await choose('triage', 'Who can use it…');
    const form = screen.getByRole('group', { name: 'Who can use triage' });
    expect(within(form).queryByRole('radiogroup', { name: 'Agents' })).toBeNull();
    await fireEvent.click(within(form).getByRole('radio', { name: 'All my projects' }));
    await fireEvent.click(within(form).getByRole('button', { name: 'Apply' }));
    expect(mockGroveBench.setSkillReach).toHaveBeenCalledWith('t1', '/repo', many[1].path, { agents: 'all', projects: 'all' });
    await waitFor(() => expect(store.error).toBe('Couldn\'t change who can use "triage": You have a personal skill named "triage" already'));
    // Still open, to try something else.
    expect(screen.getByRole('group', { name: 'Who can use triage' })).toBeInTheDocument();
    store.setError(null);
  });

  it('closes "Who can use it" on Escape or Cancel', async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue(many);
    render(ThreadSkills, { sessionId: 't1' });
    await choose('triage', 'Who can use it…');
    await fireEvent.keyDown(within(screen.getByRole('group', { name: 'Who can use triage' })).getByRole('radio', { name: 'All my projects' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Who can use triage' })).toBeNull();
    expect(skillsPanelStore.open).toBe(true);
    await choose('triage', 'Who can use it…');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Who can use triage' })).toBeNull();
  });
});
