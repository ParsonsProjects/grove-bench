import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import DraftPane from './DraftPane.svelte';
import { draftStore } from '../stores/draft.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import type { AgentPrerequisiteStatus, AgentSummary, PrerequisiteStatus } from '../../shared/types.js';

const claude: AgentSummary = { id: 'claude-code', displayName: 'Claude Agent', capabilities: { permissionModes: true }, isDefault: true };
const codex: AgentSummary = { id: 'codex', displayName: 'Codex', capabilities: {} };

const agentStatus = (authenticated: boolean, label: string): AgentPrerequisiteStatus => ({
  available: true,
  authenticated,
  apiKey: { label, helpUrl: 'https://example.com/keys', saved: false, canStore: true },
});

function status(claudeIn: boolean, codexIn?: boolean): PrerequisiteStatus {
  return {
    git: { available: true, meetsMinimum: true },
    agents: {
      'claude-code': agentStatus(claudeIn, 'Anthropic API key'),
      ...(codexIn === undefined ? {} : { codex: agentStatus(codexIn, 'OpenAI API key') }),
    },
  };
}

function createSessionMock() {
  return (mockGroveBench as unknown as { createSession: ReturnType<typeof vi.fn> }).createSession;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  vi.clearAllMocks();
  store.repos = ['/repo/one'];
  store.sessions = [];
  store.activeSessionId = null;
  store.prerequisites = status(true);
  agentsStore.list = [claude];
  agentsStore.loaded = true;
  mockGroveBench.checkPrerequisites.mockResolvedValue(status(false));
  mockGroveBench.getModels.mockResolvedValue([{ id: 'opus', label: 'Opus' }]);
  mockGroveBench.getAdapterControls.mockResolvedValue([]);
  (mockGroveBench as unknown as { createSession: ReturnType<typeof vi.fn> }).createSession = vi.fn()
    .mockResolvedValue({ id: 'new1', branch: 'grove/new1', agentType: 'claude-code' });
  draftStore.discard();
  draftStore.open('/repo/one');
  await settle();
});

afterEach(() => {
  cleanup();
  draftStore.discard();
  store.repos = [];
  store.sessions = [];
  store.prerequisites = null;
  agentsStore.list = [];
  agentsStore.loaded = false;
});

describe('DraftPane', () => {
  it('focuses the message box and explains what starting will do', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.getByText(/new branch from main, in a separate copy/)).toBeInTheDocument();
  });

  it('says in words which mode the conversation will start in, when it is not the default', async () => {
    mockGroveBench.getAdapterControls.mockResolvedValue([
      { id: 'permissionMode', label: 'Mode', default: 'default', options: [
        { value: 'default', label: 'Ask', description: 'Check with you before each edit or command' },
        { value: 'auto', label: 'Auto', description: 'Approve or block each action instead of asking' },
      ] },
    ]);
    draftStore.discard();
    draftStore.open('/repo/one');
    await settle();
    render(DraftPane);
    await waitFor(() => expect(draftStore.descriptors).toHaveLength(1));
    // The default needs no warning: the Agent settings button shows it.
    expect(screen.queryByText(/Mode: Ask/)).toBeNull();
    draftStore.setControl('permissionMode', 'auto');
    expect(await screen.findByText(/Approve or block each action instead of asking\./)).toHaveTextContent('Mode: Auto.');
  });

  it('asks for a ticket ID only while the branch is to be named from the message', async () => {
    render(DraftPane);
    const box = screen.getByLabelText<HTMLTextAreaElement>('First message');
    expect(box.placeholder).toBe('What should the agent work on? Include a ticket ID to put it in the branch name. Enter to start.');
    draftStore.setStart({ kind: 'new', branchName: 'fix/login', baseBranch: 'main' });
    await settle();
    expect(box.placeholder).toBe('What should the agent work on? Enter to start.');
    draftStore.setStart({ kind: 'folder' });
    await settle();
    expect(box.placeholder).toBe('What should the agent work on? Enter to start.');
  });

  it('starts on Enter and sends the message', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await fireEvent.input(box, { target: { value: 'Fix API-12 login crash' } });
    await fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(createSessionMock()).toHaveBeenCalled());
    // The thread's id is picked by the draft store and sent with the create.
    const { id } = createSessionMock().mock.calls[0][0];
    await waitFor(() => expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(id, 'Fix API-12 login crash', undefined, undefined));
  });

  it('keeps Shift+Enter as a new line', async () => {
    render(DraftPane);
    await fireEvent.keyDown(screen.getByLabelText('First message'), { key: 'Enter', shiftKey: true });
    expect(createSessionMock()).not.toHaveBeenCalled();
  });

  it('shows a failed start and keeps the draft', async () => {
    createSessionMock().mockRejectedValue(new Error('Branch "x" already exists'));
    render(DraftPane);
    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(draftStore.draft).not.toBeNull();
  });

  it('brings a failed start into view, under the box where it may be scrolled away', async () => {
    // jsdom has no scrollIntoView.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      createSessionMock().mockRejectedValue(new Error('Branch "x" already exists'));
      render(DraftPane);
      await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
      const alert = await screen.findByRole('alert');
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
      expect(scrollIntoView.mock.contexts.at(-1)).toContainElement(alert);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('discards the draft, keeping one with a message to undo', async () => {
    render(DraftPane);
    await fireEvent.input(screen.getByLabelText('First message'), { target: { value: 'Fix the crash' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(draftStore.draft).toBeNull();
    expect(draftStore.discarded?.text).toBe('Fix the crash');
  });

  it('discards an empty draft with nothing to undo', async () => {
    render(DraftPane);
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(draftStore.draft).toBeNull();
    expect(draftStore.discarded).toBeNull();
  });
});

describe('DraftPane skills', () => {
  const skills = [
    { name: 'triage', description: 'Sort new issues', source: 'project' as const },
    { name: 'release-notes', description: 'Draft release notes', source: 'user' as const },
  ];

  // jsdom has neither: the menus fade, and the list scrolls to the pick.
  const realAnimate = Element.prototype.animate;
  const realScroll = Element.prototype.scrollIntoView;
  beforeEach(() => {
    mockGroveBench.listAgentSkills.mockResolvedValue(skills);
    // Each animation ends straight away, so a menu that fades out goes.
    Element.prototype.animate = vi.fn(() => {
      const animation = { onfinish: null as null | (() => void), cancel() {}, finished: Promise.resolve(), currentTime: 0 };
      queueMicrotask(() => animation.onfinish?.());
      return animation as unknown as Animation;
    });
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  });

  afterEach(() => {
    cleanup();
    Element.prototype.animate = realAnimate;
    Element.prototype.scrollIntoView = realScroll;
  });

  it("lists the agent's skills on /, and Enter starts the message with the one picked", async () => {
    render(DraftPane);
    const box = screen.getByLabelText<HTMLTextAreaElement>('First message');
    await waitFor(() => expect(box.placeholder).toMatch(/Type \/ for a skill\./));
    await fireEvent.input(box, { target: { value: '/' } });
    expect(await screen.findByText('/triage')).toBeInTheDocument();
    expect(screen.getByText('/release-notes')).toBeInTheDocument();
    await fireEvent.keyDown(box, { key: 'ArrowDown' });
    await fireEvent.keyDown(box, { key: 'Enter' });
    expect(draftStore.draft?.text).toBe('Use the `release-notes` skill for this task.\n\n');
    expect(screen.queryByText('/triage')).toBeNull();
    expect(createSessionMock()).not.toHaveBeenCalled();
    await waitFor(() => expect(box.selectionStart).toBe(box.value.length));
  });

  it('narrows the list as you type, and starts as usual when nothing matches', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await fireEvent.input(box, { target: { value: '/rel' } });
    expect(await screen.findByText('/release-notes')).toBeInTheDocument();
    expect(screen.queryByText('/triage')).toBeNull();
    await fireEvent.input(box, { target: { value: '/compact' } });
    expect(await screen.findByText('No skill matches.')).toBeInTheDocument();
    await fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(createSessionMock()).toHaveBeenCalled());
  });

  it('closes on Escape and on a space, keeping the text', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await fireEvent.input(box, { target: { value: '/' } });
    await screen.findByText('/triage');
    await fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByText('/triage')).toBeNull();
    expect(draftStore.draft?.text).toBe('/');
    await fireEvent.input(box, { target: { value: '/t' } });
    await screen.findByText('/triage');
    await fireEvent.input(box, { target: { value: '/t x' } });
    expect(screen.queryByText('/triage')).toBeNull();
  });

  it('says so when the agent has no skills', async () => {
    mockGroveBench.listAgentSkills.mockResolvedValue([]);
    render(DraftPane);
    await fireEvent.input(screen.getByLabelText('First message'), { target: { value: '/' } });
    expect(await screen.findByText('Claude Agent has no skills in this project.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Skills/ })).toBeNull();
  });

  it('picks a skill from the Skills button too, shows it, and can take it off', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await fireEvent.input(box, { target: { value: 'Fix the login bug' } });
    await fireEvent.click(await screen.findByRole('button', { name: /^Skills\s*2/ }));
    await fireEvent.click(screen.getByRole('menuitemradio', { name: /triage/ }));
    expect(draftStore.draft?.text).toBe('Use the `triage` skill for this task.\n\nFix the login bug');
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Skills' })).toBeNull());
    await waitFor(() => expect(box).toHaveFocus());

    await fireEvent.click(screen.getByRole('button', { name: /Skill\s*triage/ }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'No skill' }));
    expect(draftStore.draft?.text).toBe('Fix the login bug');
  });

  it('moves through the Skills menu with the arrow keys, and Escape goes back to the button', async () => {
    render(DraftPane);
    const button = await screen.findByRole('button', { name: /^Skills\s*2/ });
    await fireEvent.click(button);
    const items = screen.getAllByRole('menuitemradio');
    await waitFor(() => expect(items[0]).toHaveFocus());
    await fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    await fireEvent.keyDown(items[1], { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();
    await fireEvent.keyDown(items[0], { key: 'End' });
    expect(items[1]).toHaveFocus();
    await fireEvent.keyDown(items[1], { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Skills' })).toBeNull());
    expect(button).toHaveFocus();
  });
});

describe('DraftPane drag and drop', () => {
  // jsdom has no DataTransfer: fireEvent puts this object on the event.
  const dropped = (...files: File[]) => ({ dataTransfer: { types: ['Files'], files } });
  const notes = () => new File(['steps'], 'notes.md', { type: 'text/markdown' });

  it('attaches files dropped on the pane and sends them with the first message', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await fireEvent.dragOver(box, dropped(notes()));
    expect(screen.getByText('Drop files to attach')).toBeInTheDocument();
    await fireEvent.drop(box, dropped(notes()));
    expect(await screen.findByText('notes.md')).toBeInTheDocument();
    expect(screen.queryByText('Drop files to attach')).not.toBeInTheDocument();

    await fireEvent.input(box, { target: { value: 'Fix the crash' } });
    await fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(mockGroveBench.sendMessage).toHaveBeenCalled());
    expect(mockGroveBench.sendMessage.mock.calls[0][1]).toBe('<file path="notes.md" length="5">\nsteps\n</file>\n\nFix the crash');
  });

  it('leaves dragged text to the message box', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    // Not prevented, so the browser drops the text as usual.
    expect(await fireEvent.dragOver(box, { dataTransfer: { types: ['text/plain'] } })).toBe(true);
    expect(screen.queryByText('Drop files to attach')).not.toBeInTheDocument();
  });

  it('stops showing the drop target when the drag leaves the pane', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await fireEvent.dragOver(box, dropped(notes()));
    await fireEvent.dragLeave(box, { relatedTarget: null });
    expect(screen.queryByText('Drop files to attach')).not.toBeInTheDocument();
  });

  it('removes a dropped file', async () => {
    render(DraftPane);
    await fireEvent.drop(screen.getByLabelText('First message'), dropped(notes()));
    await fireEvent.click(await screen.findByRole('button', { name: 'Remove notes.md' }));
    expect(screen.queryByText('notes.md')).not.toBeInTheDocument();
    expect(draftStore.draft?.attachments).toEqual([]);
  });

  it('asks for a message to go with dropped files', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await fireEvent.drop(box, dropped(notes()));
    await screen.findByText('notes.md');
    const startButton = screen.getByRole('button', { name: 'Start' });
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveAttribute('title', 'Write a message to go with the attached files.');
    await fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('Write a message to go with the attached files.');
    expect(createSessionMock()).not.toHaveBeenCalled();
  });

  it('keeps a files drag that has no files out of the message box', async () => {
    render(DraftPane);
    // Prevented, so the browser doesn't drop it into the box as text.
    expect(await fireEvent.drop(screen.getByLabelText('First message'), dropped())).toBe(false);
    expect(draftStore.draft?.attachments).toEqual([]);
  });

  describe('while files are being read', () => {
    /** Reads held until release() is called. */
    let held: (() => void)[] = [];
    const release = async () => {
      for (const read of held.splice(0)) read();
      await settle();
    };
    beforeEach(() => {
      held = [];
      vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
        held.push(() => {
          Object.defineProperty(this, 'result', { value: 'steps' });
          this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>);
        });
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('waits for them before starting', async () => {
      render(DraftPane);
      const box = screen.getByLabelText('First message');
      await fireEvent.input(box, { target: { value: 'Fix the crash' } });
      await fireEvent.drop(box, dropped(notes()));
      await settle();
      const startButton = screen.getByRole('button', { name: 'Start' });
      expect(startButton).toHaveAttribute('title', 'Reading the attached files…');
      await fireEvent.keyDown(box, { key: 'Enter' });
      expect(createSessionMock()).not.toHaveBeenCalled();

      await release();
      expect(screen.getByText('notes.md')).toBeInTheDocument();
      expect(startButton).toBeEnabled();
    });

    it('reads a second drop after the first, so the same file is attached once', async () => {
      render(DraftPane);
      const box = screen.getByLabelText('First message');
      await fireEvent.drop(box, dropped(notes()));
      await fireEvent.drop(box, dropped(notes()));
      await settle();
      await release(); // the first drop; the second is only read after it
      await release();
      expect(draftStore.draft?.attachments.map((f) => f.name)).toEqual(['notes.md']);
    });
  });

  it('asks for files to wait when the first message is a slash command', async () => {
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await fireEvent.drop(box, dropped(notes()));
    await screen.findByText('notes.md');
    await fireEvent.input(box, { target: { value: '/review this' } });
    expect(screen.getByRole('button', { name: 'Start' })).toHaveAttribute(
      'title',
      "A slash command can't take attached files. Remove them, or send them in the next message.",
    );
  });
});

describe('DraftPane credentials', () => {
  it('asks for a key when the agent has none, and blocks starting', async () => {
    store.prerequisites = status(false);
    render(DraftPane);
    expect(await screen.findByLabelText('Anthropic API key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    await waitFor(() => expect(mockGroveBench.checkPrerequisites).toHaveBeenCalled());
  });

  it('says why Enter does nothing while credentials are missing', async () => {
    store.prerequisites = status(false);
    render(DraftPane);
    const box = screen.getByLabelText('First message');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toHaveAttribute('title', 'Add credentials above to start.'));
    expect(screen.queryByText('Add credentials above to start.')).toBeNull();
    await fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('Add credentials above to start.')).toBeInTheDocument();
    expect(createSessionMock()).not.toHaveBeenCalled();
  });

  it('confirms when credentials turn up after a Re-check', async () => {
    const signedIn = status(true);
    signedIn.agents['claude-code'].email = 'sam@example.com';
    store.prerequisites = status(false);
    mockGroveBench.checkPrerequisites.mockResolvedValueOnce(status(false)).mockResolvedValue(signedIn);
    render(DraftPane);
    await fireEvent.click(await screen.findByRole('button', { name: 'Re-check' }));
    expect(await screen.findByText(/Signed in as sam@example.com\. You're ready to start\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled();
  });

  it('asks for a new key when the saved one was refused', async () => {
    const refused = status(true);
    refused.agents['claude-code'].apiKey = { label: 'Anthropic API key', helpUrl: 'https://example.com/keys', saved: true, canStore: true, rejected: true };
    store.prerequisites = refused;
    mockGroveBench.checkPrerequisites.mockResolvedValue(refused);
    render(DraftPane);
    expect(await screen.findByText(/couldn't sign in with the saved API key/)).toBeInTheDocument();
    expect(screen.getByText(/The saved key was refused/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('says git is missing in a new conversation, with a way to get it', async () => {
    store.prerequisites = { ...status(true), git: { available: false } };
    render(DraftPane);
    expect(await screen.findByText(/Git isn't installed/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Download Git' }));
    expect(mockGroveBench.openExternal).toHaveBeenCalledWith('https://git-scm.com/downloads');
  });

  it('checks the picked agent\'s own credentials', async () => {
    agentsStore.list = [claude, codex];
    store.prerequisites = status(true, false);
    mockGroveBench.checkPrerequisites.mockResolvedValue(status(true, false));
    render(DraftPane);
    expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled();

    draftStore.setAgent('codex');
    expect(await screen.findByLabelText('OpenAI API key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});

describe('DraftPane sign-in choices', () => {
  const cliSignIn = {
    accountLabel: 'Claude plan',
    accountDetail: 'Pro, Max, Team or Enterprise',
    cliName: 'Claude Code',
    command: 'claude',
    setupUrl: 'https://example.com/setup',
  };
  function withCli(available: boolean): PrerequisiteStatus {
    const s = status(false);
    s.agents['claude-code'] = {
      ...s.agents['claude-code'],
      available,
      cliSignIn,
      apiKey: { ...s.agents['claude-code'].apiKey!, billingNote: 'Billed per use, separately from any plan.' },
    };
    return s;
  }

  it('offers the plan sign-in first, then an API key with how it is billed', async () => {
    store.prerequisites = withCli(true);
    mockGroveBench.checkPrerequisites.mockResolvedValue(withCli(true));
    render(DraftPane);
    expect(await screen.findByText('Claude Agent runs on Claude Code, so it signs in the same way.')).toBeInTheDocument();
    const plan = await screen.findByRole('region', { name: 'Sign in with Claude Code' });
    expect(plan).toHaveTextContent('Use your Claude plan (Pro, Max, Team or Enterprise)');
    expect(plan).toHaveTextContent('Run claude in a terminal and sign in when it asks');
    expect(screen.queryByRole('button', { name: 'How to install Claude Code' })).toBeNull();
    const key = screen.getByRole('region', { name: 'Use an API key' });
    expect(key).toHaveTextContent('Or use an API key');
    expect(key).toHaveTextContent('Billed per use, separately from any plan. Stored encrypted');
  });

  it('links to the install guide when the CLI is not installed', async () => {
    store.prerequisites = withCli(false);
    mockGroveBench.checkPrerequisites.mockResolvedValue(withCli(false));
    render(DraftPane);
    const install = await screen.findByRole('button', { name: 'How to install Claude Code' });
    await fireEvent.click(install);
    expect(mockGroveBench.openExternal).toHaveBeenCalledWith('https://example.com/setup');
  });
});

describe('DraftPane for agents that sign in with their own CLI', () => {
  const gemini: AgentSummary = { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} };
  const cliSignIn = { accountLabel: 'Google account', cliName: 'Gemini CLI', command: 'gemini', setupUrl: 'https://example.com/gemini' };
  function withGemini(agent: Partial<AgentPrerequisiteStatus>): PrerequisiteStatus {
    const s = status(true);
    s.agents['gemini-cli'] = { available: true, installRequired: true, cliSignIn, signInCheckable: true, ...agent };
    return s;
  }

  beforeEach(() => {
    agentsStore.list = [claude, gemini];
  });

  it('says it is signed out, in the agent\'s own words, with the command to copy and a real check', async () => {
    const signedOut = withGemini({ authenticated: false, authMessage: 'This client is no longer supported' });
    store.prerequisites = signedOut;
    mockGroveBench.checkPrerequisites.mockResolvedValue(signedOut);
    mockGroveBench.checkAgentSignIn.mockResolvedValue(signedOut);
    draftStore.setAgent('gemini-cli');
    render(DraftPane);

    expect(await screen.findByText("Gemini CLI isn't signed in.")).toBeInTheDocument();
    expect(screen.getByTestId('auth-message')).toHaveTextContent('Gemini CLI said: This client is no longer supported');
    expect(screen.getByRole('group', { name: 'Sign-in command' })).toHaveTextContent('gemini');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Check sign-in' }));
    expect(mockGroveBench.checkAgentSignIn).toHaveBeenCalledWith('gemini-cli');
    expect(await screen.findByRole('alert')).toHaveTextContent("Gemini CLI still isn't signed in.");
  });

  it('asks for the program before a saved key counts, with its install command', async () => {
    const missing = withGemini({
      available: false, authenticated: false, installCommand: 'npm install -g @google/gemini-cli',
      apiKey: { label: 'Gemini API key', helpUrl: 'https://example.com', saved: true, canStore: true },
    });
    store.prerequisites = missing;
    mockGroveBench.checkPrerequisites.mockResolvedValue(missing);
    draftStore.setAgent('gemini-cli');
    render(DraftPane);

    expect(await screen.findByText("Gemini CLI isn't installed on this computer.")).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Install command' })).toHaveTextContent('npm install -g @google/gemini-cli');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});

describe('DraftPane with no agent', () => {
  it('says so instead of waiting forever, and can try again', async () => {
    agentsStore.list = [];
    draftStore.discard();
    draftStore.open('/repo/one');
    draftStore.draft!.agentId = '';
    mockGroveBench.listAdapters.mockResolvedValue([]);
    render(DraftPane);
    expect(await screen.findByText(/No agent is available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();

    mockGroveBench.listAdapters.mockResolvedValue([claude]);
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(draftStore.draft?.agentId).toBe('claude-code'));
    expect(await screen.findByLabelText('First message')).toBeInTheDocument();
  });
});

describe('DraftPane git identity heads-up', () => {
  it('warns before the first message when git has no name and email for the project', async () => {
    mockGroveBench.hasGitIdentity.mockResolvedValue(false);
    render(DraftPane);
    expect(await screen.findByText(/Git doesn't have your name and email for this project/)).toBeInTheDocument();
    expect(screen.getByText(/before or after you start/)).toBeInTheDocument();
    expect(mockGroveBench.hasGitIdentity).toHaveBeenCalledWith('/repo/one');
    mockGroveBench.hasGitIdentity.mockResolvedValue(true);
  });

  it('says nothing when git knows who you are', async () => {
    render(DraftPane);
    await waitFor(() => expect(mockGroveBench.hasGitIdentity).toHaveBeenCalled());
    await settle();
    expect(screen.queryByText(/Git doesn't have your name and email/)).not.toBeInTheDocument();
  });

  it('does not ask in a folder project without git', async () => {
    store.setFolderProject('/repo/one', true);
    mockGroveBench.repoKind.mockResolvedValue('folder');
    draftStore.discard();
    draftStore.open('/repo/one');
    await settle();
    render(DraftPane);
    await settle();
    expect(mockGroveBench.hasGitIdentity).not.toHaveBeenCalled();
    expect(screen.getByText(/project folder itself, without git, so its edits land in place/)).toBeInTheDocument();
    expect(screen.getByText(/can't be rewound\. Nothing is created until you send\./)).toBeInTheDocument();
    // Nothing is named from the message, so no ticket ID is asked for.
    expect(screen.getByLabelText<HTMLTextAreaElement>('First message').placeholder).not.toMatch(/ticket ID/);
    store.setFolderProject('/repo/one', false);
    mockGroveBench.repoKind.mockResolvedValue('git');
  });
});
