import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import DraftOptions from './DraftOptions.svelte';
import { draftStore } from '../stores/draft.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';

const settle = () => new Promise((r) => setTimeout(r, 0));

// jsdom has no Web Animations. The picker flies in and out, so stand in an
// animation that finishes on the next tick, or a closed picker never leaves.
const realAnimate = Element.prototype.animate;
function finishingAnimation(): Animation {
  let onfinish: (() => void) | null = null;
  return {
    cancel() {},
    currentTime: 0,
    get onfinish() { return onfinish; },
    set onfinish(fn) { onfinish = fn; setTimeout(() => onfinish?.(), 0); },
  } as unknown as Animation;
}

beforeEach(async () => {
  vi.clearAllMocks();
  Element.prototype.animate = finishingAnimation;
  store.repos = ['/repo/one'];
  store.sessions = [];
  store.activeSessionId = null;
  agentsStore.list = [{ id: 'claude-code', displayName: 'Claude Agent', capabilities: { permissionModes: true }, isDefault: true }];
  agentsStore.loaded = true;
  mockGroveBench.getAdapterControls.mockResolvedValue([]);
  mockGroveBench.listBranches.mockResolvedValue(['main']);
  mockGroveBench.listOpenPrs.mockResolvedValue([]);
  draftStore.discard();
  draftStore.open('/repo/one');
  await settle();
});

afterEach(() => {
  cleanup();
  Element.prototype.animate = realAnimate;
  draftStore.discard();
  store.repos = [];
  agentsStore.list = [];
  agentsStore.loaded = false;
});

describe('DraftOptions', () => {
  it('closes the start picker on a click outside or Escape, with no Done button', async () => {
    render(DraftOptions);
    const where = screen.getByTitle(/Where this thread runs/);
    const picker = () => screen.queryByRole('dialog', { name: 'Where this thread runs' });

    await fireEvent.click(where);
    expect(picker()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    await fireEvent.click(document.body);
    await waitFor(() => expect(picker()).not.toBeInTheDocument());

    await fireEvent.click(where);
    expect(picker()).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(picker()).not.toBeInTheDocument());
  });

  it('labels each option for the column, and gives names cut short in the row their tooltips', () => {
    draftStore.open('/repo/one', { group: { newGroupName: 'Auth rework' } });
    render(DraftOptions);
    // One element either way: CSS shows the labels in the column only
    // (draft-wide) and the group's inline label in the row only.
    expect(screen.getAllByRole('group', { name: 'Thread options' })).toHaveLength(1);
    for (const label of ['Agent', 'Runs in']) expect(screen.getByText(label)).toHaveClass('draft-narrow:hidden');
    const [columnLabel, rowLabel] = screen.getAllByText('New group');
    expect(columnLabel).toHaveClass('draft-narrow:hidden');
    expect(rowLabel).toHaveClass('draft-wide:hidden');
    expect(screen.getByText('from main · named from your message')).toHaveAttribute('title', 'from main · named from your message');
    expect(screen.getByTitle(/^Where this thread runs: new branch\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Don't add to Auth rework" })).toBeInTheDocument();
  });
});
