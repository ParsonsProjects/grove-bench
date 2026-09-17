import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import ChangesReviewPanel from './ChangesReviewPanel.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { gitStatusStore } from '../stores/gitStatus.svelte.js';
import type { GitStatusEntry } from '../../shared/types.js';

const SID = 'changes-session';

function entry(filePath: string, over: Partial<GitStatusEntry> = {}): GitStatusEntry {
  return { filePath, status: 'modified', staged: false, ...over } as GitStatusEntry;
}

function patch(line: string): string {
  return `--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n+${line}\n`;
}

/** Diff lines render through highlight.js (tokens split into spans), so match on text content. */
function diffText(container: HTMLElement): string {
  return container.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  gitStatusStore.statusBySession = {};
  messageStore.messagesBySession = { [SID]: [] };
  messageStore.setIsRunning(SID, false);
});

afterEach(() => cleanup());

describe('ChangesReviewPanel — live diff while the agent is running', () => {
  it('shows the empty state while running instead of a "wait for the turn" placeholder', async () => {
    messageStore.setIsRunning(SID, true);
    const { getByText, queryByText } = render(ChangesReviewPanel, { sessionId: SID });
    await tick();

    expect(getByText('Working tree clean')).toBeInTheDocument();
    expect(getByText('Edits show up here as the agent makes them')).toBeInTheDocument();
    expect(queryByText(/changes will appear when the turn completes/i)).toBeNull();
  });

  it('renders changed files and their diff while running', async () => {
    messageStore.setIsRunning(SID, true);
    mockGroveBench.getFileDiff.mockResolvedValue({ kind: 'text', patch: patch('first') });
    gitStatusStore.statusBySession = { [SID]: { entries: [entry('src/a.ts')] } };

    const { container, queryByText } = render(ChangesReviewPanel, { sessionId: SID });

    await waitFor(() => expect(diffText(container)).toContain('first'));
    expect(container.querySelector('[data-file-key="src/a.ts:false"]')).not.toBeNull();
    expect(queryByText('Working tree clean')).toBeNull();
  });

  it('keeps the current diff on screen while a status refresh reloads it', async () => {
    let resolveSecond: ((v: { kind: 'text'; patch: string }) => void) | undefined;
    mockGroveBench.getFileDiff
      .mockResolvedValueOnce({ kind: 'text', patch: patch('first') })
      .mockImplementationOnce(() => new Promise((res) => { resolveSecond = res; }));
    gitStatusStore.statusBySession = { [SID]: { entries: [entry('src/a.ts')] } };

    const { container, queryByText } = render(ChangesReviewPanel, { sessionId: SID });
    await waitFor(() => expect(diffText(container)).toContain('first'));

    // A git status refresh mid-turn hands back a fresh entries array for the same file.
    gitStatusStore.statusBySession = { [SID]: { entries: [entry('src/a.ts', { additions: 1 })] } };
    await tick();

    // Old content stays visible until the new patch arrives — no "No diff available" flash.
    expect(diffText(container)).toContain('first');
    expect(queryByText('No diff available')).toBeNull();
    expect(mockGroveBench.getFileDiff).toHaveBeenCalledTimes(2);

    resolveSecond!({ kind: 'text', patch: patch('second') });
    await waitFor(() => expect(diffText(container)).toContain('second'));
    expect(diffText(container)).not.toContain('first');
  });

  it('drops cached diffs for files that left the status and moves the selection', async () => {
    mockGroveBench.getFileDiff.mockImplementation(async (_sid, filePath) =>
      ({ kind: 'text' as const, patch: patch(`content of ${filePath}`) }));
    gitStatusStore.statusBySession = { [SID]: { entries: [entry('src/a.ts'), entry('src/b.ts')] } };

    const { container } = render(ChangesReviewPanel, { sessionId: SID });
    await waitFor(() => expect(diffText(container)).toContain('content of src/a.ts'));

    // a.ts reverted by the agent; only b.ts remains.
    gitStatusStore.statusBySession = { [SID]: { entries: [entry('src/b.ts')] } };
    await waitFor(() => expect(diffText(container)).toContain('content of src/b.ts'));
    expect(container.querySelector('[data-file-key="src/a.ts:false"]')).toBeNull();
    expect(diffText(container)).not.toContain('content of src/a.ts');
  });

  it('ignores a stale diff response that lands after a newer one', async () => {
    let resolveFirst: ((v: { kind: 'text'; patch: string }) => void) | undefined;
    mockGroveBench.getFileDiff
      .mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }))
      .mockResolvedValueOnce({ kind: 'text', patch: patch('newer') });
    gitStatusStore.statusBySession = { [SID]: { entries: [entry('src/a.ts')] } };

    const { container } = render(ChangesReviewPanel, { sessionId: SID });
    await tick();
    // Refresh before the first fetch resolves.
    gitStatusStore.statusBySession = { [SID]: { entries: [entry('src/a.ts', { additions: 2 })] } };
    await waitFor(() => expect(diffText(container)).toContain('newer'));

    resolveFirst!({ kind: 'text', patch: patch('stale') });
    await tick();
    expect(diffText(container)).not.toContain('stale');
    expect(diffText(container)).toContain('newer');
  });
});
