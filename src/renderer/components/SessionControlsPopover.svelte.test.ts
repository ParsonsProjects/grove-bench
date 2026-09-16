import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';

import SessionControlsPopover from './SessionControlsPopover.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { usageStore } from '../stores/usage.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';

const SID = 's1';

const DESCRIPTORS = [
  { id: 'permissionMode', label: 'Mode', default: 'default', options: [
    { value: 'default', label: 'Code', tone: 'info' }, { value: 'plan', label: 'Plan', tone: 'warning' },
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
    { id: 'claude-code', displayName: 'Claude Code', capabilities: {} },
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
  usageStore.byProvider = {};
  usageStore.loading = {};
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
    expect(trigger).toHaveTextContent('Claude Code');
    expect(trigger).toHaveTextContent('Opus 5');
    expect(trigger).toHaveTextContent('Code');
    expect(trigger).not.toHaveTextContent('High');
    expect(trigger).not.toHaveTextContent('Standard');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a control on the trigger once it leaves its default', async () => {
    messageStore.controlsBySession[SID].values = { thinking: 'low', speed: 'fast' };
    messageStore.modeBySession[SID] = 'plan';
    render(SessionControlsPopover, { props: { sessionId: SID, modelOptions: MODELS } });

    const trigger = screen.getByTitle(/Agent settings/);
    expect(trigger).toHaveTextContent('Opus 5 · Plan · Low · Fast');
  });

  it('opens a column per setting: agent, model, and each declared control', async () => {
    const dialog = await openPopover();

    for (const heading of ['Agent', 'Model', 'Mode', 'Thinking', 'Speed']) {
      expect(dialog).toHaveTextContent(heading);
    }
    // Other agents are listed but cannot be switched mid-session
    expect(screen.getByRole('button', { name: 'Codex' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Claude Code' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Claude Code' })).toHaveAttribute('title', 'Current agent');
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
    expect(mockGroveBench.getUsage).toHaveBeenCalledWith(SID);
  });

  it('explains when the sign-in has no plan limits to report', async () => {
    usageStore.byProvider['claude-code'] = { available: false, plan: null, windows: [], fetchedAt: Date.now() };

    const dialog = await openPopover();

    expect(dialog.querySelector('[data-testid="usage"]')).toHaveTextContent(/isn't reported/);
  });

  it('Done and Escape close the popover', async () => {
    await openPopover();
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByTitle(/Agent settings/));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
