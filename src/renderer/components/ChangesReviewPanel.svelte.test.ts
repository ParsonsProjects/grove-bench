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

import { fireEvent } from '@testing-library/svelte';
import { reviewStore } from '../stores/review.svelte.js';

function hunkPatch(): string {
  // One hunk starting at line 10 of a longer file, so context can be expanded above and below.
  return [
    '--- a/src/a.ts', '+++ b/src/a.ts',
    '@@ -10,3 +10,3 @@',
    ' const keep = 1;',
    '-const value = foo(1);',
    '+const value = bar(1);',
    ' const tail = 2;',
    '',
  ].join('\n');
}

describe('ChangesReviewPanel — review features', () => {
  beforeEach(() => {
    reviewStore.clear(SID);
    localStorage.clear();
    gitStatusStore.scopeBySession = {};
    mockGroveBench.getFileDiff.mockResolvedValue({ kind: 'text', patch: hunkPatch() });
    mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });
    gitStatusStore.statusBySession = { [SID]: { entries: [entry('src/a.ts', { contentHash: 'h1' }), entry('src/b.ts', { contentHash: 'h2' })] } };
  });

  it('highlights changed words inside a paired del/add line', async () => {
    const { container } = render(ChangesReviewPanel, { sessionId: SID });
    await waitFor(() => expect(container.querySelectorAll('mark.diff-mark').length).toBeGreaterThan(0));
    const marks = [...container.querySelectorAll('mark.diff-mark')].map(m => m.textContent);
    expect(marks).toEqual(['foo', 'bar']);
  });

  it('offers expandable context and splices in file lines on expand', async () => {
    const file = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    mockGroveBench.getFileLines.mockResolvedValue({ lines: file });
    const { container } = render(ChangesReviewPanel, { sessionId: SID });
    await waitFor(() => expect(container.querySelectorAll('[data-expander]').length).toBe(2));

    // The gap above the hunk is 9 lines: a single "show all" control.
    const above = container.querySelector('[data-expander] button') as HTMLButtonElement;
    expect(above.textContent).toContain('9 hidden lines');
    await fireEvent.click(above);
    await waitFor(() => expect(diffText(container)).toContain('line 9'));
    expect(mockGroveBench.getFileLines).toHaveBeenCalledWith(SID, 'src/a.ts', false);
    expect(diffText(container)).toContain('line 1');
    // Below the hunk the file has 30 lines, so 18 remain hidden.
    expect(container.querySelectorAll('[data-expander]').length).toBe(1);
    expect(container.querySelector('[data-expander]')!.textContent).toContain('18 hidden lines');
  });

  it('tracks viewed files, clears on content change, and advances to the next file', async () => {
    const { container, getByLabelText } = render(ChangesReviewPanel, { sessionId: SID });
    await waitFor(() => expect(diffText(container)).toContain('bar'));

    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    await fireEvent.click(box);
    await tick();
    expect(container.querySelector('[data-file-key="src/a.ts:false"]')!.getAttribute('data-viewed')).toBe('true');
    // Selection moved on to the next unviewed file.
    expect(container.querySelector('[data-file-key="src/b.ts:false"]')!.className).toContain('border-primary');
    expect(diffText(container)).toContain('1 of 2 viewed');

    // Agent edits a.ts again: the hash changes, viewed clears, marker appears.
    gitStatusStore.statusBySession = { [SID]: { entries: [entry('src/a.ts', { contentHash: 'h1-changed' }), entry('src/b.ts', { contentHash: 'h2' })] } };
    await tick();
    const a = container.querySelector('[data-file-key="src/a.ts:false"]')!;
    expect(a.getAttribute('data-viewed')).toBeNull();
    expect(a.getAttribute('data-changed-since-viewed')).toBe('true');
    expect(getByLabelText('Changed files')).toBeInTheDocument();
  });

  it('collects line comments and sends them as one prompt', async () => {
    const submit = vi.spyOn(messageStore, 'submitMessage').mockReturnValue('sent');
    const { container, getByText, getByPlaceholderText } = render(ChangesReviewPanel, { sessionId: SID });
    await waitFor(() => expect(diffText(container)).toContain('bar'));

    await fireEvent.click(container.querySelector('button[data-side="new"][aria-label="Add comment on line 11"]')!);
    await tick();
    const box = getByPlaceholderText('What should the agent change here?') as HTMLTextAreaElement;
    await fireEvent.input(box, { target: { value: 'Use baz instead' } });
    await fireEvent.click(getByText('Add comment'));
    await tick();

    expect(container.querySelectorAll('[data-review-comment]').length).toBe(1);
    expect(getByText('1 review comment')).toBeInTheDocument();
    expect(container.querySelector('[data-file-key="src/a.ts:false"]')!.textContent).toContain('1');

    await fireEvent.click(getByText('Send to agent'));
    expect(submit).toHaveBeenCalledTimes(1);
    const prompt = submit.mock.calls[0][1].outgoing;
    expect(prompt).toContain('### src/a.ts:11');
    expect(prompt).toContain('const value = bar(1);');
    expect(prompt).toContain('Use baz instead');
    expect(reviewStore.getComments(SID)).toEqual([]);
    submit.mockRestore();
  });

  it('switches to branch scope: resolves the base, refetches, and hides staging', async () => {
    mockGroveBench.getDefaultBranch.mockResolvedValue('main');
    mockGroveBench.getGitStatus.mockResolvedValue({ entries: [entry('src/committed.ts', { contentHash: 'c1' })], baseRef: 'main' });
    const { container, getByText, queryByText } = render(ChangesReviewPanel, { sessionId: SID });
    await waitFor(() => expect(getByText('Stage')).toBeInTheDocument());

    await fireEvent.click(getByText('Branch'));
    await waitFor(() => expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith(SID, { scope: 'branch', base: 'main' }));
    await waitFor(() => expect(container.querySelector('[data-file-key="src/committed.ts:false"]')).not.toBeNull());
    expect(queryByText('Stage')).toBeNull();
    expect(queryByText('Revert')).toBeNull();
    expect(getByText('vs main')).toBeInTheDocument();
    expect(getByText('Changed on branch')).toBeInTheDocument();
    // Per-file diffs are fetched against the base in branch scope.
    await waitFor(() => expect(mockGroveBench.getFileDiff).toHaveBeenCalledWith(SID, 'src/committed.ts', false, { base: 'main' }));
  });

  it('shows the scope toggle and a branch message in the empty state', async () => {
    gitStatusStore.statusBySession = { [SID]: { entries: [] } };
    mockGroveBench.getDefaultBranch.mockResolvedValue('main');
    mockGroveBench.getGitStatus.mockResolvedValue({ entries: [], scopeError: 'No merge base with main' });
    const { getByText } = render(ChangesReviewPanel, { sessionId: SID });
    expect(getByText('Working tree clean')).toBeInTheDocument();
    await fireEvent.click(getByText('Branch'));
    await waitFor(() => expect(getByText('No merge base with main')).toBeInTheDocument());
  });
});
