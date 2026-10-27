import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import StatusBarCapabilities from './StatusBarCapabilities.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';

const skills = [
  { name: 'triage', description: 'Sort new issues', source: 'project' as const },
  { name: 'release-notes', description: 'Draft release notes', source: 'project' as const },
];

function thread(agentType: string) {
  store.sessions = [{ id: 't1', branch: 'b', repoPath: '/repo', status: 'running', agentType, createdAt: 0 }] as typeof store.sessions;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo'];
  agentsStore.list = [
    { id: 'claude-code', displayName: 'Claude Code', capabilities: { skills: true }, isDefault: true },
    { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: { skills: false } },
  ];
  agentsStore.loaded = true;
  settingsStore.current = { ...settingsStore.current, disabledSkills: ['release-notes'] };
  skillsPanelStore.close();
  mockGroveBench.listSkills.mockResolvedValue(skills);
  mockGroveBench.getSkillSuggestions.mockResolvedValue([]);
  mockGroveBench.listMcpServers.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  messageStore.destroyAllSessions();
  store.sessions = [];
  store.repos = [];
  settingsStore.current = { ...settingsStore.current, disabledSkills: [] };
});

/** The MCP · Skills lozenge, found by the label it reads out. */
const lozenge = () => screen.findByTestId('capabilities');

describe('StatusBarCapabilities', () => {
  it('opens the Skills drawer on This thread from its menu', async () => {
    thread('claude-code');
    render(StatusBarCapabilities, { sessionId: 't1' });
    await fireEvent.click(await lozenge());
    await fireEvent.click(within(screen.getByRole('dialog', { name: 'MCP and Skills' })).getByRole('button', { name: /^Skills/ }));
    expect(skillsPanelStore.open).toBe(true);
    expect(skillsPanelStore.tab).toBe('thread');
    expect(screen.queryByRole('dialog', { name: 'MCP and Skills' })).toBeNull();
  });

  it("counts Claude Code's turned-off skills for Claude Code only", async () => {
    thread('claude-code');
    render(StatusBarCapabilities, { sessionId: 't1' });
    await waitFor(async () => expect(await lozenge()).toHaveTextContent('Skills 1/2'));
    expect(await lozenge()).toHaveAccessibleName('Skills: 1 of 2 on');
    cleanup();

    // Another agent reading the same folder still uses the skill.
    thread('gemini-cli');
    render(StatusBarCapabilities, { sessionId: 't1' });
    await waitFor(async () => expect(await lozenge()).toHaveTextContent('Skills 2'));
  });

  it('shows both counts with one dot, the MCP servers\' health', async () => {
    thread('claude-code');
    messageStore.updateMcpServers('t1', [
      { name: 'github', status: 'failed' },
      { name: 'linear', status: 'connected' },
    ]);
    render(StatusBarCapabilities, { sessionId: 't1' });
    await waitFor(async () => expect(await lozenge()).toHaveTextContent('MCP 1/2·Skills 1/2'));
    expect((await lozenge()).querySelector('.bg-amber-500')).not.toBeNull();

    await fireEvent.click(await lozenge());
    const menu = screen.getByRole('dialog', { name: 'MCP and Skills' });
    expect(within(menu).getByRole('button', { name: /^MCP servers/ })).toHaveTextContent('1 of 2 connected');
  });

  it('shows nothing when the agent has no servers and no skills', async () => {
    thread('claude-code');
    mockGroveBench.listSkills.mockResolvedValue([]);
    render(StatusBarCapabilities, { sessionId: 't1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('capabilities')).toBeNull();
  });
});
