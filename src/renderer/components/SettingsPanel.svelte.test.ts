import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import SettingsPanel from './SettingsPanel.svelte';
import { settingsStore } from '../stores/settings.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
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
    defaultModels: {}, adapterDefaults, cavemanMode: 'off', workingDirectories: [], defaultSystemPromptAppend: '',
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
