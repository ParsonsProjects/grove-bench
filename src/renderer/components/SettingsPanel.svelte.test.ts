import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import SettingsPanel from './SettingsPanel.svelte';
import { settingsStore } from '../stores/settings.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { mcpConfigStore } from '../stores/mcpConfig.svelte.js';
import { pluginStore } from '../stores/plugins.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { SETTINGS_INDEX, SETTINGS_SECTIONS } from '$lib/settings-search.js';
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
    toolAllowRules: [], toolDenyRules: [], disabledSkills: [], autoSkillSuggestions: false, showConversationGoal: true,
    defaultModels: {}, adapterDefaults, showThinkingSummaries: true, cavemanMode: 'off', workingDirectories: [], defaultSystemPromptAppend: '', acpAgents: [], enabledAlphaAgents: [],
    memoryAutoSave: true, memoryAutoCompact: false, memoryCompactTimeoutSeconds: 300, backgroundModels: {},
    autoInstallDeps: false, previewAgentTools: true, idleSleepMinutes: 30, defaultBaseBranch: '', branchNamingRule: '', theme: 'system', alwaysOnTop: false, autoDownloadUpdates: true,
    repoColors: {}, groveCharacters: true, diffViewMode: 'unified', defaultActivityView: 'summary', spellcheck: true,
    notifyOnTurnComplete: true, notifyOnPermission: true, notifyOnPrAlert: true, notifyTaskbarFlash: true, notifyTaskbarBadge: true,
    analyticsEnabled: false, analyticsPrompted: false, crashReportsEnabled: false,
  };
}

/** The settings passed to the last save. */
function lastSaved(): GroveBenchSettings {
  return mockGroveBench.saveSettings.mock.calls.at(-1)![0] as GroveBenchSettings;
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

/** Render Settings, open as the sidebar would; closing it re-renders it closed. */
async function renderPanel() {
  const onclose = vi.fn(() => { void result.rerender({ open: false, onclose }); });
  const result = render(SettingsPanel, { open: true, onclose });
  await waitFor(() => expect(settingsStore.loaded).toBe(true));
  return { ...result, onclose };
}

/** A section's tab, by its plain name (shown under its grove name). */
function sectionTab(label: string) {
  return screen.getByRole('tab', { name: new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) });
}

async function openSection(label: string) {
  await fireEvent.click(sectionTab(label));
}

async function openAgentSection() {
  await renderPanel();
  await openSection('Agents');
}

beforeEach(() => {
  vi.clearAllMocks();
  agentsStore.list = [claude];
  agentsStore.loaded = true;
  settingsStore.loaded = false;
  settingsStore.loading = false;
  settingsStore.savedAt = null;
  settingsStore.error = null;
  mockGroveBench.getSettings.mockResolvedValue(settings());
  mockGroveBench.saveSettings.mockResolvedValue(undefined);
  mockGroveBench.getModels.mockResolvedValue([{ id: 'claude-opus-5-5', label: 'Opus 5.5' }]);
  mockGroveBench.getAdapterControls.mockResolvedValue([MODE]);
});

afterEach(() => {
  cleanup();
  agentsStore.list = [];
  agentsStore.loaded = false;
});

describe('SettingsPanel opened at a section', () => {
  it('shows the section asked for, e.g. Agents from a sign-in error', async () => {
    settingsStore.requestedSection = 'agents';
    await renderPanel();
    await waitFor(() => expect(sectionTab('Agents')).toHaveAttribute('aria-selected', 'true'));
    expect(settingsStore.requestedSection).toBeNull();
  });
});

describe('SettingsPanel default permission mode', () => {
  it('is not under Permissions, which points to Agents instead', async () => {
    await renderPanel();
    await openSection('Permissions');

    expect(screen.queryByText('Default permission mode')).not.toBeInTheDocument();
    expect(screen.queryByText(/bypass/i)).not.toBeInTheDocument();
    expect(screen.getByText(/set per agent/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Grovekeepers (Agents)' }));
    expect(await screen.findByText('Default permission mode')).toBeInTheDocument();
  });

  it('lists the agent\'s own modes, with Grove Bench\'s under its own heading and no Bypass', async () => {
    await openAgentSection();
    await openModeSelect();

    for (const name of ['Ask', 'Plan', 'Edit', 'Auto', 'Read-safe']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Grove Bench')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /bypass/i })).not.toBeInTheDocument();
  });

  it('saves the picked mode under the agent, and clears it when set back to the default', async () => {
    await openAgentSection();
    const trigger = await openModeSelect();

    await pick('Edit');
    await waitFor(() => expect(trigger).toHaveTextContent('Edit'));
    await waitFor(() => expect(lastSaved().adapterDefaults).toEqual({ 'claude-code': { permissionMode: 'acceptEdits' } }));

    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('option', { name: 'Ask' });
    await pick('Ask');
    await waitFor(() => expect(trigger).toHaveTextContent('Ask'));
    await waitFor(() => expect(lastSaved().adapterDefaults).toEqual({}));
  });

  it('shows a saved mode', async () => {
    mockGroveBench.getSettings.mockResolvedValue(settings({ 'claude-code': { permissionMode: 'readSafe' } }));
    await openAgentSection();

    expect(await screen.findByRole('button', { name: 'Claude Agent default mode' })).toHaveTextContent('Read-safe');
  });
});

describe('SettingsPanel auto-save', () => {
  it('saves a change straight away, with no Save button', async () => {
    await renderPanel();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Always on top' }));

    await waitFor(() => expect(lastSaved().alwaysOnTop).toBe(true));
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
  });

  it('saves text still waiting for a pause when Settings closes', async () => {
    const { onclose } = await renderPanel();
    await openSection('Git & worktrees');
    await fireEvent.input(screen.getByLabelText('Default base branch'), { target: { value: 'develop' } });

    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(onclose).toHaveBeenCalled());

    // Well inside the half-second typing pause.
    await waitFor(() => expect(lastSaved().defaultBaseBranch).toBe('develop'), { timeout: 200 });
  });

  it('shows a failed save, keeps the change and retries', async () => {
    mockGroveBench.saveSettings.mockRejectedValueOnce(new Error('disk full'));
    await renderPanel();
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Spell checking' }));

    expect(await screen.findByText(/Couldn't save: disk full/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(lastSaved().spellcheck).toBe(false));
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
  });

  it('does not reload settings, or lose edits, when an agent reports new models', async () => {
    await renderPanel();
    settingsStore.draft.alwaysOnTop = true;

    // What the models-changed listener does.
    await agentsStore.refresh();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockGroveBench.getSettings).toHaveBeenCalledTimes(1);
    expect(settingsStore.draft.alwaysOnTop).toBe(true);
  });
});

describe('SettingsPanel number settings', () => {
  it('refuses a compaction timeout out of range and saves a valid one', async () => {
    await renderPanel();
    await openSection('Background work');
    const field = screen.getByLabelText('Compaction timeout');

    await fireEvent.input(field, { target: { value: '5000' } });
    await fireEvent.blur(field);
    expect(screen.getByText(/Enter a number from 30 to 3600\. Not saved\./)).toBeInTheDocument();
    await fireEvent.input(field, { target: { value: '5' } });
    await fireEvent.blur(field);
    expect(screen.getByText(/Enter a number from 30 to 3600\. Not saved\./)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGroveBench.saveSettings).not.toHaveBeenCalled();

    await fireEvent.input(field, { target: { value: '60' } });
    await fireEvent.blur(field);
    await waitFor(() => expect(lastSaved().memoryCompactTimeoutSeconds).toBe(60));
    expect(screen.queryByText(/Not saved/)).not.toBeInTheDocument();
  });

  it('does not flag a saved value it is only showing', async () => {
    mockGroveBench.getSettings.mockResolvedValue({ ...settings(), idleSleepMinutes: 2.5 });
    await renderPanel();
    await openSection('Background work');

    expect(screen.getByLabelText('Sleep idle conversations after')).toHaveValue('2.5');
    expect(screen.queryByText(/Not saved/)).not.toBeInTheDocument();
  });

  it('does not save a cleared idle time as the default', async () => {
    await renderPanel();
    await openSection('Background work');
    const field = screen.getByLabelText('Sleep idle conversations after');

    await fireEvent.input(field, { target: { value: '' } });
    await fireEvent.blur(field);

    expect(screen.getByText(/Enter a whole number, 0 or more\. Not saved\./)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGroveBench.saveSettings).not.toHaveBeenCalled();
  });
});

describe('SettingsPanel sections and search', () => {
  it('shows each section by its grove name, with its plain name under it', async () => {
    await renderPanel();
    expect(sectionTab('Notifications')).toHaveTextContent('Bells');
    await openSection('Notifications');
    expect(screen.getByRole('heading', { name: 'Bells' })).toBeInTheDocument();
  });

  it('opens a search result in its section', async () => {
    await renderPanel();
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'taskbar' } });

    await fireEvent.click(await screen.findByRole('button', { name: /Flash the taskbar button/ }));

    expect(sectionTab('Notifications')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('checkbox', { name: 'Flash the taskbar button' })).toBeInTheDocument();
  });

  it('starts on the sections again after closing with a search typed', async () => {
    const { rerender, onclose } = await renderPanel();
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'idle' } });

    await rerender({ open: false, onclose });
    await rerender({ open: true, onclose });

    expect(screen.getByRole('searchbox', { name: 'Search settings' })).toHaveValue('');
    expect(screen.getByRole('tablist')).not.toHaveClass('hidden');
  });

  it('does not offer a setting this setup does not show', async () => {
    await renderPanel();
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'thinking summaries' } });

    expect(screen.queryByRole('button', { name: /Show thinking summaries/ })).not.toBeInTheDocument();
  });

  it('has a row for every searchable setting', async () => {
    agentsStore.list = [
      { ...claude, capabilities: { thinkingSummaries: true, mcpConfig: true, plugins: true } },
      { id: 'opencode', displayName: 'OpenCode', capabilities: {}, stage: 'alpha' },
    ];
    store.repos = ['C:/dev/grove-bench'];
    store.prerequisites = {
      git: { available: true },
      agents: { 'claude-code': { available: true, apiKey: { label: 'API key', helpUrl: 'https://example.com', saved: false, canStore: true } } },
    };
    try {
      await renderPanel();
      for (const section of SETTINGS_SECTIONS) {
        await openSection(section.label);
        // By value: Plugins has its own tabs inside.
        const panel = document.querySelector(`[data-tabs-content][data-value="${section.id}"]`)!;
        for (const entry of SETTINGS_INDEX.filter((e) => e.section === section.id)) {
          await waitFor(() => expect(panel.querySelector(`[data-setting="${entry.id}"]`), entry.id).not.toBeNull());
        }
      }
    } finally {
      store.repos = [];
      store.prerequisites = null;
    }
  });
});

describe('SettingsPanel agent loading', () => {
  it('fetches the Agents section\'s models once per models-changed event', async () => {
    let fire!: () => void;
    mockGroveBench.onModelsChanged.mockImplementation(((cb: () => void) => { fire = cb; return () => {}; }) as never);
    mockGroveBench.listAdapters.mockResolvedValue([claude]);
    await openAgentSection();
    await waitFor(() => expect(mockGroveBench.getModels).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    mockGroveBench.getModels.mockClear();

    fire();
    await waitFor(() => expect(mockGroveBench.getModels).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    expect(mockGroveBench.getModels).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsPanel agent models', () => {
  it('does not fetch models again when another save replaces the draft', async () => {
    await openAgentSection();
    await screen.findByRole('button', { name: 'Claude Agent default mode' });
    mockGroveBench.getModels.mockClear();

    // What a status-bar toggle does.
    await settingsStore.updateNow({ disabledSkills: ['lint'] });
    await new Promise((r) => setTimeout(r, 20));

    expect(mockGroveBench.getModels).not.toHaveBeenCalled();
  });
});

describe('SettingsPanel project colors', () => {
  it('saves a picked color once, when the picker closes', async () => {
    store.repos = ['C:/dev/grove-bench'];
    try {
      await renderPanel();
      const picker = screen.getByLabelText('Color for grove-bench');

      await fireEvent.input(picker, { target: { value: '#112233' } });
      await new Promise((r) => setTimeout(r, 20));
      expect(mockGroveBench.saveSettings).not.toHaveBeenCalled();

      await fireEvent.change(picker, { target: { value: '#112233' } });
      await waitFor(() => expect(lastSaved().repoColors).toEqual({ 'C:/dev/grove-bench': '#112233' }));
    } finally {
      store.repos = [];
    }
  });
});

describe('SettingsPanel alpha agents', () => {
  const opencode = { id: 'opencode', displayName: 'OpenCode', capabilities: {}, stage: 'alpha' as const };

  it('marks an alpha agent and keeps its settings behind an Enable box, off by default', async () => {
    agentsStore.list = [claude, opencode];
    await openAgentSection();

    const box = await screen.findByRole('checkbox', { name: 'Enable OpenCode' });
    expect(box).not.toBeChecked();
    const group = box.closest('section')!;
    expect(group).toHaveTextContent('Alpha');
    expect(group).toHaveTextContent('still being tested');
    expect(screen.queryByRole('button', { name: 'OpenCode default model' })).not.toBeInTheDocument();
    // Other agents are not marked.
    expect(screen.getByRole('button', { name: 'Claude Agent default model' }).closest('section')).not.toHaveTextContent('Alpha');

    await fireEvent.click(box);
    await waitFor(() => expect(lastSaved().enabledAlphaAgents).toEqual(['opencode']));
    expect(await screen.findByRole('button', { name: 'OpenCode default model' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Enable OpenCode' }));
    await waitFor(() => expect(lastSaved().enabledAlphaAgents).toEqual([]));
  });
});

describe('SettingsPanel thinking summaries', () => {
  it('is offered only when an agent can show thinking summaries', async () => {
    await openAgentSection();
    await screen.findByRole('button', { name: 'Claude Agent default mode' });
    expect(screen.queryByText('Show thinking summaries')).not.toBeInTheDocument();
  });

  it('is one setting for all agents, on by default, and turns off from the checkbox', async () => {
    agentsStore.list = [{ ...claude, capabilities: { thinkingSummaries: true } }];
    await openAgentSection();

    const box = await screen.findByRole('checkbox', { name: 'Show thinking summaries' });
    expect(box).toBeChecked();
    await fireEvent.click(box);
    await waitFor(() => expect(lastSaved().showThinkingSummaries).toBe(false));
  });
});

describe('SettingsPanel MCP servers', () => {
  beforeEach(() => {
    agentsStore.list = [{ ...claude, capabilities: { mcpConfig: true } }];
    mcpConfigStore.loaded = false;
    mcpConfigStore.attempted = false;
    mcpConfigStore.servers = [];
    mcpConfigStore.error = null;
    mcpConfigStore.errorKind = null;
    mcpConfigStore.cwd = undefined;
    mcpConfigStore.adapterType = undefined;
  });

  afterEach(() => {
    mockGroveBench.mcpConfigList.mockResolvedValue([]);
    mockGroveBench.mcpConfigAdd.mockResolvedValue(undefined);
  });

  it('does not retry a failed listing in a loop', async () => {
    mockGroveBench.mcpConfigList.mockRejectedValue(new Error('claude: command not found'));
    await renderPanel();

    await openSection('MCP servers');
    await waitFor(() => expect(mcpConfigStore.error).toMatch(/command not found/));
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    expect(mockGroveBench.mcpConfigList).toHaveBeenCalledTimes(1);
  });

  it('asks before removing a server', async () => {
    mockGroveBench.mcpConfigList.mockResolvedValue([{ name: 'github', target: 'npx github-mcp', status: 'connected' }]);
    await renderPanel();
    await openSection('MCP servers');

    await fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(mockGroveBench.mcpConfigRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Remove github?')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockGroveBench.mcpConfigRemove).toHaveBeenCalledWith('github', undefined, undefined, undefined));
  });

  it('drops a pending Remove when the list changes', async () => {
    mockGroveBench.mcpConfigList.mockResolvedValue([{ name: 'github', target: 'npx github-mcp', status: 'connected' }]);
    await renderPanel();
    await openSection('MCP servers');
    await fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Remove github?')).toBeInTheDocument();

    // Another project's list, with a server of the same name.
    await mcpConfigStore.showProject('C:/dev/other');

    await waitFor(() => expect(screen.queryByText('Remove github?')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('shows a failed add next to the add form', async () => {
    mockGroveBench.mcpConfigAdd.mockRejectedValue(new Error('name already exists'));
    await renderPanel();
    await openSection('MCP servers');
    await waitFor(() => expect(mcpConfigStore.attempted).toBe(true));

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'github' } });
    await fireEvent.input(screen.getByLabelText('Command'), { target: { value: 'npx' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add server' }));

    const form = document.querySelector<HTMLElement>('[data-setting="mcp-add"]')!;
    expect(await within(form).findByText('name already exists')).toBeInTheDocument();
  });
});

describe('SettingsPanel plugins', () => {
  afterEach(() => {
    mockGroveBench.pluginList.mockResolvedValue({ installed: [], available: [] });
  });

  it('asks before removing a plugin', async () => {
    mockGroveBench.pluginList.mockResolvedValue({
      installed: [{ id: 'lint@market', version: '1.0.0', scope: 'user', enabled: true }],
      available: [],
    } as never);
    await renderPanel();
    await openSection('Plugins');
    await waitFor(() => expect(pluginStore.installed).toHaveLength(1));

    await fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(mockGroveBench.pluginUninstall).not.toHaveBeenCalled();
    expect(screen.getByText('Remove lint?')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockGroveBench.pluginUninstall).toHaveBeenCalledWith('lint@market'));
  });
});
