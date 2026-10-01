import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import SettingsPanel from './SettingsPanel.svelte';
import { settingsStore } from '../stores/settings.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { mcpConfigStore } from '../stores/mcpConfig.svelte.js';
import type { AgentSummary, ControlDescriptor, GroveBenchSettings } from '../../shared/types.js';

const claude: AgentSummary = { id: 'claude-code', displayName: 'Claude Agent', capabilities: {}, isDefault: true };

const MODE: ControlDescriptor = {
  id: 'permissionMode',
  label: 'Mode',
  default: 'default',
  options: [
    { value: 'default', label: 'Ask', description: 'Check with you before each edit or command (reading files and read-only commands run freely)' },
    { value: 'plan', label: 'Plan' },
    { value: 'acceptEdits', label: 'Edit', description: 'Auto-accept file edits inside the worktree' },
    { value: 'auto', label: 'Auto' },
    { value: 'readSafe', label: 'Read-safe', group: 'Grove Bench' },
  ],
};

function settings(adapterDefaults: GroveBenchSettings['adapterDefaults'] = {}): GroveBenchSettings {
  return {
    toolAllowRules: [], toolDenyRules: [], disabledSkills: [], autoSkillSuggestions: false,
    defaultModels: {}, adapterDefaults, showThinkingSummaries: true, cavemanMode: 'off', workingDirectories: [], defaultSystemPromptAppend: '', acpAgents: [],
    memoryAutoSave: true, memoryAutoCompact: false, memoryCompactTimeoutSeconds: 300, backgroundModels: {},
    autoInstallDeps: false, previewAgentTools: true, idleSleepMinutes: 30, defaultBaseBranch: '', branchNamingRule: '', theme: 'system', alwaysOnTop: false,
    repoColors: {}, groveCharacters: true, diffViewMode: 'unified', defaultActivityView: 'summary', spellcheck: true,
    notifyOnTurnComplete: true, notifyOnPermission: true, notifyOnPrAlert: true, notifyTaskbarFlash: true, notifyTaskbarBadge: true,
    analyticsEnabled: false, analyticsPrompted: false, crashReportsEnabled: false,
  };
}

// jsdom lacks scrollIntoView, which bits-ui calls on the highlighted option.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

async function openModeSelect() {
  const trigger = await screen.findByRole('button', { name: 'Claude Agent default mode' });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'Enter' });
  await screen.findByRole('option', { name: 'Ask' });
  return trigger;
}

// jsdom has no pointer capture, so pick from the keyboard.
async function pick(name: string) {
  const option = screen.getByRole('option', { name });
  option.focus();
  await fireEvent.pointerMove(option);
  await fireEvent.keyDown(document.activeElement ?? option, { key: 'Enter' });
}

async function openAgentTab() {
  render(SettingsPanel, { open: true, onclose: vi.fn() });
  await waitFor(() => expect(settingsStore.loading).toBe(false));
  // The tab; the Permissions tab also has an "Agent" link after it.
  await fireEvent.click(screen.getAllByRole('button', { name: 'Agent' })[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  agentsStore.list = [claude];
  agentsStore.loaded = true;
  mockGroveBench.getSettings.mockResolvedValue(settings());
  mockGroveBench.getModels.mockResolvedValue([{ id: 'claude-opus-5-5', label: 'Opus 5.5' }]);
  mockGroveBench.getAdapterControls.mockResolvedValue([MODE]);
});

afterEach(() => {
  cleanup();
  agentsStore.list = [];
  agentsStore.loaded = false;
});

describe('SettingsPanel default permission mode', () => {
  it('is no longer on the Permissions tab, which points to the Agent tab instead', async () => {
    render(SettingsPanel, { open: true, onclose: vi.fn() });
    await waitFor(() => expect(settingsStore.loading).toBe(false));

    expect(screen.queryByText('Default Permission Mode')).not.toBeInTheDocument();
    expect(screen.queryByText(/bypass/i)).not.toBeInTheDocument();
    expect(screen.getByText(/set per agent/)).toBeInTheDocument();

    const [, pointer] = screen.getAllByRole('button', { name: 'Agent' });
    await fireEvent.click(pointer);
    expect(await screen.findByText('Default Permission Mode')).toBeInTheDocument();
  });

  it('lists the agent\'s own modes, with Grove Bench\'s under its own heading and no Bypass', async () => {
    await openAgentTab();
    await openModeSelect();

    for (const name of ['Ask', 'Plan', 'Edit', 'Auto', 'Read-safe']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Grove Bench')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /bypass/i })).not.toBeInTheDocument();
  });

  it('saves the picked mode under the agent, and clears it when set back to the default', async () => {
    await openAgentTab();
    const trigger = await openModeSelect();

    await pick('Edit');
    await waitFor(() => expect(trigger).toHaveTextContent('Edit'));
    expect(settingsStore.draft.adapterDefaults).toEqual({ 'claude-code': { permissionMode: 'acceptEdits' } });

    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('option', { name: 'Ask' });
    await pick('Ask');
    await waitFor(() => expect(trigger).toHaveTextContent('Ask'));
    expect(settingsStore.draft.adapterDefaults).toEqual({});
  });

  it('shows a saved mode', async () => {
    mockGroveBench.getSettings.mockResolvedValue(settings({ 'claude-code': { permissionMode: 'readSafe' } }));
    await openAgentTab();

    expect(await screen.findByRole('button', { name: 'Claude Agent default mode' })).toHaveTextContent('Read-safe');
  });
});

describe('SettingsPanel loading', () => {
  it('keeps unsaved edits when an agent reports new models', async () => {
    render(SettingsPanel, { open: true, onclose: vi.fn() });
    await waitFor(() => expect(settingsStore.loading).toBe(false));
    settingsStore.draft.theme = 'dark';

    // What the models-changed listener does.
    await agentsStore.refresh();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockGroveBench.getSettings).toHaveBeenCalledTimes(1);
    expect(settingsStore.draft.theme).toBe('dark');
  });

  it('fetches the Agent tab\'s models once per models-changed event', async () => {
    let fire!: () => void;
    mockGroveBench.onModelsChanged.mockImplementation(((cb: () => void) => { fire = cb; return () => {}; }) as never);
    mockGroveBench.listAdapters.mockResolvedValue([claude]);
    await openAgentTab();
    await waitFor(() => expect(mockGroveBench.getModels).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    mockGroveBench.getModels.mockClear();

    fire();
    await waitFor(() => expect(mockGroveBench.getModels).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    expect(mockGroveBench.getModels).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed MCP listing in a loop', async () => {
    agentsStore.list = [{ ...claude, capabilities: { mcpConfig: true } }];
    mcpConfigStore.loaded = false;
    mcpConfigStore.attempted = false;
    mockGroveBench.mcpConfigList.mockRejectedValue(new Error('claude: command not found'));
    render(SettingsPanel, { open: true, onclose: vi.fn() });
    await waitFor(() => expect(settingsStore.loading).toBe(false));

    await fireEvent.click(screen.getByRole('button', { name: 'Trails (MCP)' }));
    await waitFor(() => expect(mcpConfigStore.error).toMatch(/command not found/));
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    expect(mockGroveBench.mcpConfigList).toHaveBeenCalledTimes(1);
    mockGroveBench.mcpConfigList.mockResolvedValue([]);
  });
});

describe('SettingsPanel thinking summaries', () => {
  it('is offered only for agents that can show thinking summaries', async () => {
    await openAgentTab();
    await screen.findByRole('button', { name: 'Claude Agent default mode' });
    expect(screen.queryByText('Show thinking summaries')).not.toBeInTheDocument();
  });

  it('is on by default and turns off from the checkbox', async () => {
    agentsStore.list = [{ ...claude, capabilities: { thinkingSummaries: true } }];
    await openAgentTab();

    const box = await screen.findByRole('checkbox', { name: 'Claude Agent show thinking summaries' });
    expect(box).toBeChecked();
    await fireEvent.click(box);
    expect(settingsStore.draft.showThinkingSummaries).toBe(false);
  });
});
