import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import MemoryCompactDialog from './MemoryCompactDialog.svelte';
import type { MemoryCompactionPreview } from '../../shared/types.js';

// bits-ui scrolls the highlighted option into view; jsdom has no layout.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const preview = (extra: Partial<MemoryCompactionPreview> = {}): MemoryCompactionPreview => ({
  agentId: 'claude-code',
  agentName: 'Claude Agent',
  model: 'claude-haiku-4-5',
  fileCount: 4,
  totalBytes: 12 * 1024,
  maxGroups: 6,
  parallelMerges: 3,
  plan: { systemPrompt: 'You are planning a clean-up of THE FILES', userMessage: 'Plan the clean-up. Respond with JSON only.' },
  planDigest: 'digest-1',
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGroveBench.getModels.mockResolvedValue([
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
    { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  ]);
});

afterEach(cleanup);

describe('MemoryCompactDialog', () => {
  it('shows the agent, the model and the planning prompt before anything runs', async () => {
    render(MemoryCompactDialog, { preview: preview(), onstart: vi.fn(), oncancel: vi.fn() });

    expect(screen.getByText('Claude Agent')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Model for this compaction run' })).toHaveTextContent('Default (Haiku 4.5)'));
    expect(screen.getByTestId('compact-system-prompt')).toHaveTextContent('You are planning a clean-up of THE FILES');
    expect(screen.getByText('Plan the clean-up. Respond with JSON only.')).toBeInTheDocument();
    expect(screen.getByText(/up to 6 merge steps, 3 at a time/)).toBeInTheDocument();
    expect(mockGroveBench.getModels).toHaveBeenCalledWith('claude-code');
    expect(mockGroveBench.memoryCompact).not.toHaveBeenCalled();
  });

  it("starts with no model when Default is kept, so the run uses the preview's", async () => {
    const onstart = vi.fn();
    render(MemoryCompactDialog, { preview: preview(), onstart, oncancel: vi.fn() });

    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(onstart).toHaveBeenCalledWith(undefined);
  });

  it('starts with the model picked for this run', async () => {
    const onstart = vi.fn();
    render(MemoryCompactDialog, { preview: preview(), onstart, oncancel: vi.fn() });
    const trigger = await screen.findByRole('button', { name: 'Model for this compaction run' });
    await waitFor(() => expect(trigger).toHaveTextContent('Default (Haiku 4.5)'));

    // jsdom has no pointer capture, so pick from the keyboard.
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const option = await screen.findByRole('option', { name: 'Sonnet 4.5' });
    option.focus();
    await fireEvent.pointerMove(option);
    await fireEvent.keyDown(document.activeElement ?? option, { key: 'Enter' });
    await waitFor(() => expect(trigger).toHaveTextContent('Sonnet 4.5'));

    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onstart).toHaveBeenCalledWith('claude-sonnet-4-5');
  });

  it("can't start on an agent that can't run compaction", () => {
    render(MemoryCompactDialog, { preview: preview({ unavailable: "Gemini CLI can't run compaction." }), onstart: vi.fn(), oncancel: vi.fn() });

    expect(screen.getByText("Gemini CLI can't run compaction.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('says so when it opened again because memory changed', () => {
    render(MemoryCompactDialog, { preview: preview(), changed: true, onstart: vi.fn(), oncancel: vi.fn() });

    expect(screen.getByText('Memory changed since this opened')).toBeInTheDocument();
    expect(screen.getByText(/Nothing was sent/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  it("can't start with nothing to compact", () => {
    render(MemoryCompactDialog, { preview: preview({ plan: null, planDigest: null, fileCount: 0 }), onstart: vi.fn(), oncancel: vi.fn() });

    expect(screen.getByText(/no repo, conventions or architecture notes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});
