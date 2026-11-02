import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';

// MarkdownBlock calls DOMPurify.addHook at module load, and DOMPurify's
// default export resolves to a factory in this environment.
vi.mock('dompurify', () => ({
  default: { addHook: () => {}, sanitize: (html: string) => html },
}));

import SideDock from './SideDock.svelte';
// SideDock loads it on first use; loaded here, that import resolves at once.
import './SubagentPanel.svelte';
import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
import { subagentPanelStore } from '../stores/subagentPanel.svelte.js';
import { bookmarkStore } from '../stores/bookmarks.svelte.js';
import { messageStore, type ChatMessage } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';

const SID = 'dock-session';

const agentCall: ChatMessage = {
  kind: 'tool_call', id: 'm1', toolName: 'Agent', toolUseId: 'tu-agent', uuid: 'a1', pending: false,
  toolInput: { description: 'Find what fires the burst', subagent_type: 'Explore', prompt: 'Look for the scheduler' },
  result: 'The burst comes from the 11:00 cron job.',
};

const pressEsc = (el: Element) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

beforeEach(() => {
  store.activeSessionId = SID;
  messageStore.messagesBySession = { [SID]: [agentCall] };
  bookmarkStore.list = [];
});

afterEach(() => {
  cleanup();
  markdownPreviewStore.close();
  subagentPanelStore.close();
  bookmarkStore.toggleDrawer(false);
});

describe('SideDock', () => {
  it('shows nothing while no panel is open', () => {
    const { container } = render(SideDock, { sessionId: SID, bookmarks: true });
    expect(container.querySelector('[data-dock]')).toBeNull();
  });

  it('docks the Focus panel in the thread it was opened from only', async () => {
    const here = render(SideDock, { sessionId: SID });
    const other = render(SideDock, { sessionId: 'other' });
    markdownPreviewStore.show('# Plan', 'PLAN.md', SID);
    await tick();
    expect(within(here.container).getByRole('complementary', { name: 'Focus panel' })).toHaveTextContent('PLAN.md');
    expect(within(other.container).queryByRole('complementary', { name: 'Focus panel' })).toBeNull();
  });

  it('docks an attached file beside the thread it was clicked in', async () => {
    const { container } = render(SideDock, { sessionId: SID });
    // No sessionId: an attached file isn't read from the worktree.
    markdownPreviewStore.show('# Notes', 'notes.md', undefined, '', SID);
    await tick();
    expect(within(container).getByRole('complementary', { name: 'Focus panel' })).toBeInTheDocument();
  });

  it('shows the panel opened last, and the one under it again once that closes', async () => {
    const { container } = render(SideDock, { sessionId: SID });
    subagentPanelStore.show(SID, 'tu-agent');
    const subagent = await screen.findByRole('complementary', { name: 'Subagent thread' });
    expect(container.querySelector('[data-dock]')).toHaveAttribute('data-dock', 'subagent');

    // A file opened from the subagent's thread covers it, which stays mounted.
    markdownPreviewStore.show('report', 'Agent response', SID);
    await tick();
    expect(container.querySelector('[data-dock]')).toHaveAttribute('data-dock', 'focus');
    expect(subagent.isConnected).toBe(true);
    expect(subagent.parentElement).toHaveClass('hidden');

    // Esc in the Focus panel closes it alone.
    pressEsc(screen.getByRole('complementary', { name: 'Focus panel' }));
    await tick();
    expect(markdownPreviewStore.open).toBe(false);
    expect(subagentPanelStore.open).toBe(true);
    expect(container.querySelector('[data-dock]')).toHaveAttribute('data-dock', 'subagent');
    expect(subagent.parentElement).not.toHaveClass('hidden');
  });

  it('leaves Esc in the message box to the box', async () => {
    render(SideDock, { sessionId: SID });
    markdownPreviewStore.show('# Plan', 'PLAN.md', SID);
    await tick();
    const box = document.body.appendChild(document.createElement('textarea'));
    pressEsc(box);
    expect(markdownPreviewStore.open).toBe(true);
    box.remove();
  });

  it('docks Bookmarks where it is told to, with or without a thread', async () => {
    const thread = render(SideDock, { sessionId: SID, bookmarks: false });
    const landing = render(SideDock, { bookmarks: true });
    bookmarkStore.toggleDrawer(true);
    await tick();
    expect(within(thread.container).queryByRole('complementary', { name: 'Bookmarks' })).toBeNull();
    const panel = within(landing.container).getByRole('complementary', { name: 'Bookmarks' });
    // Focused as it opens (Ctrl+B), so Esc closes it at once.
    expect(panel.contains(document.activeElement)).toBe(true);
    pressEsc(document.activeElement!);
    expect(bookmarkStore.drawerOpen).toBe(false);
  });

  it('never docks a thread\'s panels where there is no thread', async () => {
    const { container } = render(SideDock, { bookmarks: true });
    markdownPreviewStore.show('# Plan', 'PLAN.md', SID);
    await tick();
    expect(container.querySelector('[data-dock]')).toBeNull();
  });
});
