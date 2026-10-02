import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import DraftAgentControl from './DraftAgentControl.svelte';
import { draftStore } from '../stores/draft.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  vi.clearAllMocks();
  store.repos = ['/repo/one'];
  store.activeSessionId = null;
  agentsStore.list = [
    { id: 'claude-code', displayName: 'Claude Agent', capabilities: { permissionModes: true }, isDefault: true },
    { id: 'codex', displayName: 'Codex', capabilities: {} },
  ];
  agentsStore.loaded = true;
  mockGroveBench.getModels.mockImplementation(async (id?: string) => id === 'codex'
    ? [{ id: 'gpt-x', label: 'GPT X' }]
    : [{ id: 'opus', label: 'Opus' }, { id: 'haiku', label: 'Haiku' }]);
  mockGroveBench.getAdapterControls.mockImplementation(async (id?: string) => id === 'codex' ? [] : [
    { id: 'permissionMode', label: 'Mode', default: 'default', options: [
      { value: 'default', label: 'Ask', tone: 'info', description: 'Check with you first' },
      { value: 'plan', label: 'Plan', tone: 'warning', description: 'Plan without editing' },
    ] },
  ]);
  draftStore.discard();
  draftStore.open('/repo/one');
  await settle();
});

afterEach(() => {
  cleanup();
  draftStore.discard();
  store.repos = [];
  agentsStore.list = [];
  agentsStore.loaded = false;
});

async function openPopover() {
  render(DraftAgentControl);
  await fireEvent.click(screen.getByTitle(/Agent settings/));
  return screen.getByRole('dialog', { name: 'Agent settings' });
}

describe('DraftAgentControl', () => {
  it('shows the agent, model and mode the draft would start on', () => {
    render(DraftAgentControl);
    const trigger = screen.getByTitle(/Agent settings/);
    expect(trigger).toHaveTextContent('Claude Agent');
    expect(trigger).toHaveTextContent('Opus · Ask');
  });

  it('says what the current mode does, and what a pointed-at option does', async () => {
    const dialog = await openPopover();
    expect(dialog).toHaveTextContent('Ask: Check with you first');
    await fireEvent.mouseEnter(screen.getByRole('button', { name: 'Plan' }));
    expect(dialog).toHaveTextContent('Plan: Plan without editing');
    await fireEvent.mouseLeave(screen.getByRole('button', { name: 'Plan' }));
    expect(dialog).toHaveTextContent('Ask: Check with you first');
  });

  it('forgets the pointed-at option when the popover closes', async () => {
    await openPopover();
    await fireEvent.mouseEnter(screen.getByRole('button', { name: 'Plan' }));
    await fireEvent.keyDown(window, { key: 'Escape' });
    await fireEvent.click(screen.getByTitle(/Agent settings/));
    expect(screen.getByRole('dialog', { name: 'Agent settings' })).toHaveTextContent('Ask: Check with you first');
  });

  it('lets any agent be picked, then shows that agent\'s models', async () => {
    await openPopover();
    await fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'GPT X' })).toBeInTheDocument());
    expect(draftStore.draft?.agentId).toBe('codex');
    expect(screen.queryByRole('button', { name: 'Opus' })).not.toBeInTheDocument();
  });

  it('picks a model and a mode', async () => {
    await openPopover();
    await fireEvent.click(screen.getByRole('button', { name: 'Haiku' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    expect(draftStore.draft).toMatchObject({ model: 'haiku', controls: { permissionMode: 'plan' } });
    expect(screen.getByTitle(/Agent settings/)).toHaveTextContent('Haiku · Plan');
  });
});
