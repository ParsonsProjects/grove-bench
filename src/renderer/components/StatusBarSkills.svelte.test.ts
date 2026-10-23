import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';

import StatusBarSkills from './StatusBarSkills.svelte';
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
});

afterEach(() => {
  cleanup();
  store.sessions = [];
  store.repos = [];
  settingsStore.current = { ...settingsStore.current, disabledSkills: [] };
});

describe('StatusBarSkills', () => {
  it('opens the Skills drawer on This thread', async () => {
    thread('claude-code');
    render(StatusBarSkills, { sessionId: 't1' });
    await fireEvent.click(await screen.findByRole('button', { name: /^Skills/ }));
    expect(skillsPanelStore.open).toBe(true);
    expect(skillsPanelStore.tab).toBe('thread');
  });

  it("counts Claude Code's turned-off skills for Claude Code only", async () => {
    thread('claude-code');
    render(StatusBarSkills, { sessionId: 't1' });
    expect(await screen.findByRole('button', { name: /^Skills 1\/2/ })).toBeInTheDocument();
    cleanup();

    // Another agent reading the same folder still uses the skill.
    thread('gemini-cli');
    render(StatusBarSkills, { sessionId: 't1' });
    expect(await screen.findByRole('button', { name: /^Skills 2/ })).toBeInTheDocument();
  });
});
