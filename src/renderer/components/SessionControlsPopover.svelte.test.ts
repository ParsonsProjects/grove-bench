import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, within, waitFor } from '@testing-library/svelte';

import SessionControlsPopover from './SessionControlsPopover.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { usageStore } from '../stores/usage.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import type { AgentSummary } from '../../shared/types.js';
import { draftStore } from '../stores/draft.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';

const SID = 's1';

const DESCRIPTORS = [
  { id: 'permissionMode', label: 'Mode', default: 'default', options: [
    { value: 'default', label: 'Ask', tone: 'info' }, { value: 'plan', label: 'Plan', tone: 'warning' },
    { value: 'readSafe', label: 'Read-safe', tone: 'success', group: 'Grove Bench' },
  ] },
  { id: 'thinking', label: 'Thinking', default: 'high', options: [
    { value: 'low', label: 'Low', tone: 'accent-soft' }, { value: 'high', label: 'High', tone: 'accent' },
  ] },
  { id: 'speed', label: 'Speed', default: 'standard', options: [
    { value: 'standard', label: 'Standard', tone: 'neutral' }, { value: 'fast', label: 'Fast', tone: 'highlight' },
  ] },
];

const MODELS = [
  { value: 'claude-opus-5', label: 'Opus 5', contextWindow: 1_000_000 },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', contextWindow: 200_000 },
];

beforeEach(() => {
  store.sessions = [{ id: SID, branch: 'feat-x', repoPath: '/repo', status: 'running', agentType: 'claude-code' }] as any;
  messageStore.modelBySession = { [SID]: 'claude-opus-5' };
  messageStore.modeBySession = { [SID]: 'default' };
  messageStore.controlsBySession = { [SID]: { descriptors: DESCRIPTORS as any, values: { thinking: 'high', speed: 'standard' } } };
  mockGroveBench.listAdapters.mockResolvedValue([
    { id: 'claude-code', displayName: 'Claude Agent', capabilities: {} },
    { id: 'codex', displayName: 'Codex', capabilities: {} },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  store.sessions = [];
  messageStore.controlsBySession = {};
  messageStore.modelBySession = {};
  messageStore.modeBySession = {};
  usageStore.reset();
  agentsStore.list = [];
  agentsStore.loaded = false;
});

async function openPopover() {
  render(SessionControlsPopover, { props: { sessionId: SID, modelOptions: MODELS } });
  await new Promise((r) => setTimeout(r, 0)); // listAdapters resolves
  await fireEvent.click(screen.getByTitle(/Agent settings/));
  return screen.getByRole('dialog', { name: 'Agent settings' });
}

describe('SessionControlsPopover', () => {
  it('summarises agent, model, and mode on the trigger, hiding controls at their default', async () => {
    render(SessionControlsPopover, { props: { sessionId: SID, modelOptions: MODELS } });
    await new Promise((r) => setTimeout(r, 0));

    const trigger = screen.getByTitle(/Agent settings/);
    expect(trigger).toHaveTextContent('Claude Agent');
    expect(trigger).toHaveTextContent('Opus 5');
    expect(trigger).toHaveTextContent('Ask');
    expect(trigger).not.toHaveTextContent('High');
    expect(trigger).not.toHaveTextContent('Standard');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('leads with the model and mode, and shows a control once it leaves its default', async () => {
    messageStore.controlsBySession[SID].values = { thinking: 'low', speed: 'fast' };
    messageStore.modeBySession[SID] = 'plan';
    render(SessionControlsPopover, { props: { sessionId: SID, modelOptions: MODELS } });
    await new Promise((r) => setTimeout(r, 0)); // listAdapters resolves

    expect(screen.getByTestId('agent-settings-headline')).toHaveTextContent(/^Opus 5 · Plan$/);
    expect(screen.getByTestId('agent-settings-detail')).toHaveTextContent(/^Claude Agent · Low · Fast$/);
  });

  it('cuts a long model name short on the button but names it in full in the tooltip', async () => {
    const long = 'Sonnet 4.6 with the one million token context window';
    render(SessionControlsPopover, { props: { sessionId: SID, modelOptions: [{ value: 'claude-opus-5', label: long }] } });

    const name = within(screen.getByTestId('agent-settings-headline')).getByText(long);
    expect(name.className).toContain('truncate');
    expect(screen.getByTitle(/Agent settings/).getAttribute('title')).toContain(long);
  });

  it('opens a column per setting: agent, model, and each declared control', async () => {
    const dialog = await openPopover();

    for (const heading of ['Agent', 'Model', 'Mode', 'Thinking', 'Speed']) {
      expect(dialog).toHaveTextContent(heading);
    }
    // The current agent is marked; others offer to switch to them
    expect(screen.getByRole('button', { name: 'Claude Agent' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Codex/ })).toHaveAttribute('title', expect.stringContaining('Switch this thread to Codex'));
  });

  it('asks before switching, saying what the transcript is and where it goes', async () => {
    await openPopover();
    await fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    const ask = screen.getByRole('group', { name: 'Switch agent' });
    expect(ask).toHaveTextContent('Switch this thread to Codex?');
    expect(ask).toHaveTextContent("That transcript goes to Codex's provider.");
    expect(mockGroveBench.switchAgent).not.toHaveBeenCalled();

    await fireEvent.click(within(ask).getByRole('button', { name: 'Switch and send the transcript' }));
    expect(mockGroveBench.switchAgent).toHaveBeenCalledWith(SID, 'codex', true);
  });

  it('says why a switch was refused', async () => {
    mockGroveBench.switchAgent.mockRejectedValueOnce(new Error("Error invoking remote method 'agent:switch': Error: Codex isn't signed in. Sign in (Settings > Agents), then switch."));
    await openPopover();
    await fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Switch and send the transcript' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Codex isn't signed in/);
  });

  it('can switch without the transcript', async () => {
    await openPopover();
    await fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Switch without it' }));
    expect(mockGroveBench.switchAgent).toHaveBeenCalledWith(SID, 'codex', false);
  });

  it('opens a draft with another agent in the same project instead, leaving this conversation alone', async () => {
    store.repos = ['/repo'];
    store.activeSessionId = SID;
    await openPopover();
    await fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    await fireEvent.click(screen.getByRole('button', { name: /New thread instead/ }));

    expect(draftStore.draft).toMatchObject({ repoPath: '/repo', agentId: 'codex' });
    expect(store.activeSessionId).toBeNull();
    expect(store.sessions.find((s) => s.id === SID)?.agentType).toBe('claude-code');
    draftStore.discard();
    store.repos = [];
  });

  describe('an alpha agent', () => {
    beforeEach(() => {
      mockGroveBench.listAdapters.mockResolvedValue([
        { id: 'claude-code', displayName: 'Claude Agent', capabilities: {} },
        { id: 'opencode', displayName: 'OpenCode', capabilities: {}, stage: 'alpha' },
      ]);
    });
    afterEach(() => {
      settingsStore.current = { ...settingsStore.current, enabledAlphaAgents: [] };
    });

    it('is offered for a new conversation only once turned on, marked Alpha', async () => {
      let dialog = await openPopover();
      expect(within(dialog).queryByRole('button', { name: /OpenCode/ })).not.toBeInTheDocument();
      cleanup();

      settingsStore.current = { ...settingsStore.current, enabledAlphaAgents: ['opencode'] };
      dialog = await openPopover();
      expect(within(dialog).getByRole('button', { name: /OpenCode/ })).toHaveTextContent('Alpha');
    });

    it('still shows as the agent of a conversation that runs on it', async () => {
      store.sessions = [{ ...store.sessions[0], agentType: 'opencode' }];
      const dialog = await openPopover();
      expect(within(dialog).getByRole('button', { name: /OpenCode/ })).toHaveAttribute('aria-current', 'true');
    });
  });

  it('divides grouped options from the provider\'s own with the group as a heading', async () => {
    const dialog = await openPopover();
    const heading = within(dialog).getByText('Grove Bench');
    expect(heading).toHaveAttribute('title', 'Not a Claude Agent option');
    // The heading sits between the provider's modes and the grouped one.
    const modeButtons = within(dialog).getAllByRole('button', { name: /^(Ask|Plan|Read-safe)$/ });
    expect(modeButtons.map((b) => b.textContent?.trim())).toEqual(['Ask', 'Plan', 'Read-safe']);
    expect(heading.compareDocumentPosition(modeButtons[1]) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(heading.compareDocumentPosition(modeButtons[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Only one divider: ungrouped options never get one.
    expect(within(dialog).getAllByText('Grove Bench')).toHaveLength(1);
  });

  it('selecting a control option goes through the store and IPC', async () => {
    await openPopover();

    await fireEvent.click(screen.getByRole('button', { name: 'Fast' }));

    expect(messageStore.getControlValue(SID, 'speed')).toBe('fast');
    expect(mockGroveBench.setControl).toHaveBeenCalledWith(SID, 'speed', 'fast');
  });

  it('selecting a mode routes through setMode, not setControl', async () => {
    await openPopover();

    await fireEvent.click(screen.getByRole('button', { name: 'Plan' }));

    expect(messageStore.getMode(SID)).toBe('plan');
    expect(mockGroveBench.setMode).toHaveBeenCalledWith(SID, 'plan');
    expect(mockGroveBench.setControl).not.toHaveBeenCalled();
  });

  it('selecting a model switches it optimistically and over IPC', async () => {
    await openPopover();

    await fireEvent.click(screen.getByRole('button', { name: 'Haiku 4.5' }));

    expect(messageStore.getModel(SID)).toBe('claude-haiku-4-5-20251001');
    expect(mockGroveBench.setModel).toHaveBeenCalledWith(SID, 'claude-haiku-4-5-20251001');
  });

  it('re-selecting the current option is a no-op', async () => {
    await openPopover();

    await fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Opus 5' }));

    expect(mockGroveBench.setControl).not.toHaveBeenCalled();
    expect(mockGroveBench.setModel).not.toHaveBeenCalled();
  });

  it('shows plan usage windows with percent and reset time, and refreshes on open', async () => {
    usageStore.byProvider['claude-code'] = {
      available: true,
      plan: 'max',
      fetchedAt: 0,
      windows: [
        { id: 'five_hour', label: '5-hour', utilization: 0.42, resetsAt: Math.round(Date.now() / 1000) + 3600 },
        { id: 'seven_day', label: 'Weekly', utilization: 0.18 },
      ],
    };
    mockGroveBench.getUsage.mockResolvedValue(null);

    const dialog = await openPopover();
    const usage = dialog.querySelector('[data-testid="usage"]')!;

    expect(usage).toHaveTextContent('max plan');
    expect(usage).toHaveTextContent('5-hour');
    expect(usage).toHaveTextContent('42%');
    expect(usage).toHaveTextContent(/resets/);
    expect(usage).toHaveTextContent('Weekly');
    expect(usage).toHaveTextContent('18%');
    // 42% as 20 blocks of 5%: 8 full, the 9th started, in the "getting full" colour.
    const blocks = [...usage.querySelector('[data-testid="usage-bar-five_hour"]')!.children] as HTMLElement[];
    expect(blocks.map((b) => b.dataset.block)).toEqual([...Array(8).fill('full'), 'part', ...Array(11).fill('empty')]);
    expect(blocks[0].className).toContain('bg-yellow-400');
    expect(mockGroveBench.getUsage).toHaveBeenCalledWith(SID);
  });

  it('explains when the sign-in has no plan limits to report', async () => {
    usageStore.byProvider['claude-code'] = { available: false, plan: null, windows: [], fetchedAt: Date.now() };

    const dialog = await openPopover();

    expect(dialog.querySelector('[data-testid="usage"]')).toHaveTextContent(/isn't reported/);
  });

  it('says when an agent has no plan usage to report', async () => {
    const agents: AgentSummary[] = [
      { id: 'claude-code', displayName: 'Claude Agent', capabilities: {} },
      { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: { usage: false } },
    ];
    mockGroveBench.listAdapters.mockResolvedValue(agents);
    agentsStore.list = agents;
    agentsStore.loaded = true;
    store.sessions = [{ id: SID, branch: 'feat-x', repoPath: '/repo', status: 'running', agentType: 'gemini-cli' }] as any;

    const dialog = await openPopover();

    await waitFor(() => expect(dialog.querySelector('[data-testid="usage"]')).toHaveTextContent("Gemini CLI doesn't report plan usage."));
  });

  it('marks old figures with when they were last updated, and windows that have reset since', async () => {
    const hourAgo = Date.now() - 3600_000;
    usageStore.byProvider['claude-code'] = {
      available: true,
      plan: 'max',
      fetchedAt: hourAgo,
      windows: [
        { id: 'five_hour', label: '5-hour', utilization: 0.9, resetsAt: Math.round(Date.now() / 1000) - 60 },
        { id: 'seven_day', label: 'Weekly', utilization: 0.18 },
      ],
    };
    mockGroveBench.getUsage.mockResolvedValue(null);

    const dialog = await openPopover();
    const usage = dialog.querySelector('[data-testid="usage"]')!;

    expect(usage).not.toHaveTextContent('90%');
    expect(usage).toHaveTextContent(/5-hour\s*reset/);
    expect(usage.querySelector('[data-testid="usage-updated"]')).toHaveTextContent('Last updated');
  });

  it('applies a choice without closing, and has no Done button', async () => {
    const dialog = await openPopover();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Haiku 4.5' }));
    expect(mockGroveBench.setModel).toHaveBeenCalledWith(SID, 'claude-haiku-4-5-20251001');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('a click outside and Escape close the popover', async () => {
    await openPopover();
    await fireEvent.click(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByTitle(/Agent settings/));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
