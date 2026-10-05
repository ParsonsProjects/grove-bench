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
    analyticsEnabled: false, analyticsPrompted: false, crashReportsEnabled: false, onlineCatalogs: true,
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
  settingsStore.folds.clear();
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

describe('SettingsPanel permission rules', () => {
  async function openRules() {
    await renderPanel();
    await openSection('Permissions');
    return screen.getByRole('textbox', { name: 'Tool deny rules' });
  }

  it('refuses a rule that can never match, and says how to fix it', async () => {
    const field = await openRules();
    await fireEvent.input(field, { target: { value: 'shell(rm -rf *' } });
    await fireEvent.keyDown(field, { key: 'Enter' });

    expect(screen.getByRole('alert')).toHaveTextContent('Did you mean shell(rm -rf *)?');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGroveBench.saveSettings).not.toHaveBeenCalled();

    await fireEvent.input(field, { target: { value: 'shell(rm -rf *)' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(lastSaved().toolDenyRules).toEqual([{ pattern: 'shell(rm -rf *)' }]));
  });

  it('shows a hint first, then adds the rule on a second Add', async () => {
    const field = await openRules();
    await fireEvent.input(field, { target: { value: 'shel(npm *)' } });
    const group = field.closest<HTMLElement>('[data-setting]')!;
    await fireEvent.click(within(group).getByRole('button', { name: 'Add' }));

    expect(within(group).getByRole('status')).toHaveTextContent('"shel" isn\'t a rule keyword');
    await fireEvent.click(within(group).getByRole('button', { name: 'Add anyway' }));
    await waitFor(() => expect(lastSaved().toolDenyRules).toEqual([{ pattern: 'shel(npm *)' }]));
  });

  it('puts a clicked example in the field to edit', async () => {
    const field = await openRules();
    await fireEvent.click(screen.getByRole('button', { name: 'shell(git push *)' }));

    expect(field).toHaveValue('shell(git push *)');
    expect(field).toHaveFocus();
    expect(mockGroveBench.saveSettings).not.toHaveBeenCalled();
  });

  it('marks a saved rule that never matches', async () => {
    mockGroveBench.getSettings.mockResolvedValue({ ...settings(), toolDenyRules: [{ pattern: 'shell(rm *' }, { pattern: 'shell(git push *)' }] });
    await openRules();

    const list = screen.getByRole('list', { name: 'Tool deny rules' });
    expect(within(list).getByText('shell(rm *').closest('li')).toHaveTextContent('(never matches)');
    expect(within(list).getByText('shell(git push *)').closest('li')).not.toHaveTextContent('(never matches)');
  });
});

describe('SettingsPanel test notification', () => {
  it('sends one and says what to check if it did not show', async () => {
    await renderPanel();
    await openSection('Notifications');
    await fireEvent.click(screen.getByRole('button', { name: 'Send a test notification' }));

    expect(mockGroveBench.testNotification).toHaveBeenCalled();
    expect(await screen.findByText(/^Sent\. If it didn't appear/)).toBeInTheDocument();
  });

  it('says when Windows refused it', async () => {
    mockGroveBench.testNotification.mockResolvedValueOnce('failed');
    await renderPanel();
    await openSection('Notifications');
    await fireEvent.click(screen.getByRole('button', { name: 'Send a test notification' }));

    expect(await screen.findByText(/Windows couldn't show it/)).toBeInTheDocument();
  });
});

describe('SettingsPanel diff view', () => {
  it('shows both views with an example, and saves the one picked', async () => {
    await renderPanel();
    const group = screen.getByRole('radiogroup', { name: 'Default diff view' });
    const unified = within(group).getByRole('radio', { name: /Unified/ });
    const sideBySide = within(group).getByRole('radio', { name: /Side-by-side/ });
    expect(unified).toBeChecked();

    await fireEvent.click(sideBySide);
    await waitFor(() => expect(lastSaved().diffViewMode).toBe('side-by-side'));
    expect(sideBySide).toBeChecked();
  });
});

describe('SettingsPanel background work', () => {
  it('groups the one-off settings under Conversations', async () => {
    await renderPanel();
    await openSection('Background work');
    const group = screen.getByRole('heading', { name: 'Conversations' }).closest('section')!;

    for (const name of ['Suggest skills automatically', 'Show the conversation goal']) {
      expect(within(group).getByRole('checkbox', { name })).toBeInTheDocument();
    }
    expect(within(group).getByLabelText('Sleep idle conversations after')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Skill suggestions' })).not.toBeInTheDocument();
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

  it('is found by searching, but only when an agent is in alpha', async () => {
    agentsStore.list = [claude];
    await renderPanel();
    const search = screen.getByRole('searchbox', { name: 'Search settings' });
    await fireEvent.input(search, { target: { value: 'alpha' } });
    expect(screen.queryByRole('button', { name: /Enable an alpha agent/ })).not.toBeInTheDocument();
    cleanup();

    agentsStore.list = [claude, opencode];
    await renderPanel();
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'alpha' } });
    expect(screen.getByRole('button', { name: /Enable an alpha agent/ })).toBeInTheDocument();
  });

  it('doesn\'t claim a sign-in it couldn\'t check', async () => {
    agentsStore.list = [claude, opencode];
    mockGroveBench.getSettings.mockResolvedValue({ ...settings(), enabledAlphaAgents: ['opencode'] });
    store.prerequisites = {
      git: { available: true },
      agents: { opencode: { available: true, authenticated: true, authUnchecked: true, apiKey: { label: 'OpenRouter API key', helpUrl: 'https://example.com', saved: false, canStore: true } } },
    };
    try {
      await openAgentSection();
      const group = (await screen.findByRole('checkbox', { name: 'Enable OpenCode' })).closest('section')!;
      await waitFor(() => expect(group).toHaveTextContent('No key saved. OpenCode uses its own sign-in if you set one up in a terminal'));
      expect(group).not.toHaveTextContent('Signed in');
    } finally {
      store.prerequisites = null;
    }
  });
});

describe('SettingsPanel agent groups', () => {
  const gemini: AgentSummary = { id: 'gemini', displayName: 'Gemini CLI', capabilities: {} };

  it('say when an agent with its own sign-in is signed out, with the command and a real check', async () => {
    agentsStore.list = [claude, gemini];
    const signedOut = {
      git: { available: true },
      agents: { gemini: {
        available: true, authenticated: false, authMessage: 'This client is no longer supported', signInCheckable: true,
        cliSignIn: { accountLabel: 'Google account', cliName: 'Gemini CLI', command: 'gemini', setupUrl: 'https://example.com' },
      } },
    };
    store.prerequisites = signedOut;
    mockGroveBench.checkAgentSignIn.mockResolvedValue(signedOut);
    try {
      await openAgentSection();
      await screen.findByRole('button', { name: 'Gemini CLI default model' });
      await fireEvent.click(fold('Gemini CLI').querySelector('summary')!);
      const group = fold('Gemini CLI');
      expect(within(group).getByTestId('sign-in-state')).toHaveTextContent('Not signed in (Gemini CLI said: This client is no longer supported).');
      expect(within(group).getByRole('group', { name: 'Sign-in command' })).toHaveTextContent('gemini');

      await fireEvent.click(within(group).getByRole('button', { name: 'Check sign-in' }));
      expect(mockGroveBench.checkAgentSignIn).toHaveBeenCalledWith('gemini');
      expect(await within(group).findByRole('alert')).toHaveTextContent('Still not signed in.');
    } finally {
      store.prerequisites = null;
    }
  });

  /** The fold an agent's settings sit in. */
  function fold(name: string) {
    return screen.getByText(name, { selector: 'h4' }).closest('details')!;
  }

  it('fold, with only the default agent open', async () => {
    agentsStore.list = [claude, gemini];
    await openAgentSection();
    await screen.findByRole('button', { name: 'Gemini CLI default model' });

    expect(fold('Claude Agent')).toHaveAttribute('open');
    expect(fold('Gemini CLI')).not.toHaveAttribute('open');
    expect(fold('All agents')).toHaveAttribute('open');
  });

  it('stay as left when you come back to the section', async () => {
    agentsStore.list = [claude, gemini];
    await openAgentSection();
    await screen.findByRole('button', { name: 'Gemini CLI default model' });

    await fireEvent.click(fold('Gemini CLI').querySelector('summary')!);
    await waitFor(() => expect(fold('Gemini CLI')).toHaveAttribute('open'));
    await new Promise((r) => setTimeout(r, 20));
    await openSection('General');
    await openSection('Agents');

    await screen.findByRole('button', { name: 'Gemini CLI default model' });
    expect(fold('Gemini CLI')).toHaveAttribute('open');
  });

  it('unfold when search goes to a setting in one', async () => {
    agentsStore.list = [gemini, claude];
    await openAgentSection();
    await screen.findByRole('button', { name: 'Gemini CLI default model' });
    fold('Claude Agent').open = false;

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'default model' } });
    await fireEvent.click(await screen.findByRole('button', { name: /^Default model/ }));

    await waitFor(() => expect(fold('Gemini CLI')).toHaveAttribute('open'));
  });

  it('go to the open agent when search finds the same setting in each', async () => {
    agentsStore.list = [gemini, claude];
    await openAgentSection();
    await screen.findByRole('button', { name: 'Gemini CLI default model' });

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'default model' } });
    await fireEvent.click(await screen.findByRole('button', { name: /^Default model/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Claude Agent default model' })).toHaveFocus());
    expect(fold('Gemini CLI')).not.toHaveAttribute('open');
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

  /** Open the Add server dialog from the section's top right. */
  async function openAddDialog() {
    await renderPanel();
    await openSection('MCP servers');
    await waitFor(() => expect(mcpConfigStore.attempted).toBe(true));
    await fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    return screen.findByRole('dialog', { name: 'Add MCP server' });
  }

  it('adds a server from a dialog, then closes it and says so', async () => {
    const dialog = await openAddDialog();

    await fireEvent.input(within(dialog).getByLabelText('Name'), { target: { value: 'github' } });
    await fireEvent.input(within(dialog).getByLabelText('Command'), { target: { value: 'npx' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Add server' }));

    await waitFor(() => expect(mockGroveBench.mcpConfigAdd).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add MCP server' })).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Added github.');
  });

  it('shows a failed add in the dialog, and keeps it open', async () => {
    mockGroveBench.mcpConfigAdd.mockRejectedValue(new Error('name already exists'));
    const dialog = await openAddDialog();

    await fireEvent.input(within(dialog).getByLabelText('Name'), { target: { value: 'github' } });
    await fireEvent.input(within(dialog).getByLabelText('Command'), { target: { value: 'npx' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Add server' }));

    expect(await within(dialog).findByText('name already exists')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('github');
  });

  it('starts the dialog empty again after Cancel', async () => {
    let dialog = await openAddDialog();
    await fireEvent.input(within(dialog).getByLabelText('Name'), { target: { value: 'github' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add MCP server' })).not.toBeInTheDocument());

    await fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    dialog = await screen.findByRole('dialog', { name: 'Add MCP server' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('');
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
