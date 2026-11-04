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

  it('puts each option under its own label in the column, and the detail in full', () => {
    draftStore.open('/repo/one', { group: { newGroupName: 'Auth rework' } });
    render(DraftOptions, { layout: 'column' });
    const options = screen.getByRole('group', { name: 'Thread options' });
    expect(options).toHaveTextContent(/^Agent.*Runs in.*New group\s*Auth rework/);
    const detail = screen.getByText('from main · named from your message');
    expect(detail).not.toHaveClass('truncate');
    expect(screen.getByRole('button', { name: "Don't add to Auth rework" })).toBeInTheDocument();
  });

  it('keeps the strip to one row, cutting names short with their tooltips whole', () => {
    draftStore.open('/repo/one', { group: { newGroupName: 'Auth rework' } });
    render(DraftOptions, { layout: 'strip' });
    expect(screen.getByRole('group', { name: 'Thread options' })).not.toHaveClass('flex-wrap');
    expect(screen.queryByText('Runs in')).toBeNull();
    const detail = screen.getByText('from main · named from your message');
    expect(detail).toHaveClass('truncate');
    expect(detail).toHaveAttribute('title', 'from main · named from your message');
    expect(screen.getByText('New group')).toBeInTheDocument();
  });
});
