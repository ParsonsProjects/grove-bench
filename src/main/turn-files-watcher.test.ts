import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import {
  BATCH_MS, MAX_CANDIDATES, createWatchService, isWatchMessage, isWatchRequest, type WatchMessage, type WatchTreeFn,
} from './turn-files-watcher.js';

/** Folders the test drives: `change(root, rel)` reports a change under one,
 *  `fail(root, err)` makes its watch fail. */
function fakeTrees() {
  const trees = new Map<string, { onChange: (rel: string | null) => void; onError?: (err: unknown) => void; close: ReturnType<typeof vi.fn> }>();
  const watch = vi.fn<WatchTreeFn>((root, onChange) => {
    const tree = { onChange, onError: undefined as ((err: unknown) => void) | undefined, close: vi.fn() };
    trees.set(root, tree);
    return { close: tree.close, on: (_event: 'error', listener: (err: unknown) => void) => { tree.onError = listener; } };
  });
  return {
    watch,
    trees,
    change: (root: string, rel: string | null) => trees.get(root)?.onChange(rel),
    fail: (root: string, err: unknown) => trees.get(root)?.onError?.(err),
  };
}

function setup(platform: NodeJS.Platform = 'linux') {
  vi.useFakeTimers();
  const posted: WatchMessage[] = [];
  const trees = fakeTrees();
  const service = createWatchService({ post: (m) => posted.push(m), watch: trees.watch, platform });
  return { service, posted, ...trees };
}

const A = path.resolve('/wt/a');
const B = path.resolve('/wt/b');

afterEach(() => {
  vi.useRealTimers();
});

describe('createWatchService', () => {
  it('sends a batch of the paths a turn could list, each once, with a count of every change', () => {
    const { service, posted, change } = setup();
    service.handle({ type: 'watch', id: 1, root: A });

    change(A, 'shots/home.png');
    change(A, 'shots/home.png');
    change(A, 'node_modules/x/logo.png');
    change(A, 'src/app.ts');
    change(A, null);
    expect(posted).toEqual([]);

    vi.advanceTimersByTime(BATCH_MS);
    expect(posted).toEqual([{ type: 'changes', count: 5, paths: [[1, ['shots/home.png']]] }]);

    change(A, 'shots/home.png');
    vi.advanceTimersByTime(BATCH_MS);
    expect(posted[1]).toEqual({ type: 'changes', count: 1, paths: [] });
  });

  it('watches a folder once for every turn in it, whatever its case on Windows', () => {
    const { service, posted, watch, trees, change } = setup('win32');
    service.handle({ type: 'watch', id: 1, root: A });
    service.handle({ type: 'watch', id: 2, root: A.toUpperCase() });
    service.handle({ type: 'watch', id: 3, root: B });
    expect(watch).toHaveBeenCalledTimes(2);
    expect(service.watchedFolders()).toBe(2);

    change(A, 'report.pdf');
    vi.advanceTimersByTime(BATCH_MS);
    expect(posted).toEqual([{ type: 'changes', count: 1, paths: [[1, ['report.pdf']], [2, ['report.pdf']]] }]);

    service.handle({ type: 'unwatch', id: 1 });
    expect(trees.get(A)?.close).not.toHaveBeenCalled();
    service.handle({ type: 'unwatch', id: 2 });
    expect(trees.get(A)?.close).toHaveBeenCalledTimes(1);
    expect(service.watchedFolders()).toBe(1);
  });

  it("answers an unwatch after sending what it held for that turn, without waiting for the batch", () => {
    const { service, posted, change } = setup();
    service.handle({ type: 'watch', id: 1, root: A });
    change(A, 'shot.png');

    service.handle({ type: 'unwatch', id: 1 });
    expect(posted).toEqual([
      { type: 'changes', count: 1, paths: [[1, ['shot.png']]] },
      { type: 'unwatched', id: 1 },
    ]);
  });

  it('answers an unwatch for a watch it no longer has', () => {
    const { service, posted } = setup();
    service.handle({ type: 'unwatch', id: 7 });
    expect(posted).toEqual([{ type: 'unwatched', id: 7 }]);
  });

  it("says so when a folder can't be watched", () => {
    const posted: WatchMessage[] = [];
    const service = createWatchService({
      post: (m) => posted.push(m),
      watch: () => { throw new Error('ENOENT: gone'); },
    });
    service.handle({ type: 'watch', id: 1, root: A });
    expect(posted).toEqual([{ type: 'error', id: 1, message: 'ENOENT: gone' }]);
    expect(service.watchedFolders()).toBe(0);
  });

  it('sends what a failed watch saw, then the error to every turn on it', () => {
    const { service, posted, trees, change, fail } = setup();
    service.handle({ type: 'watch', id: 1, root: A });
    service.handle({ type: 'watch', id: 2, root: A });
    change(A, 'shot.png');

    fail(A, new Error('EPERM'));
    expect(posted).toEqual([
      { type: 'changes', count: 1, paths: [[1, ['shot.png']], [2, ['shot.png']]] },
      { type: 'error', id: 1, message: 'EPERM' },
      { type: 'error', id: 2, message: 'EPERM' },
    ]);
    expect(trees.get(A)?.close).toHaveBeenCalledTimes(1);
    expect(service.watchedFolders()).toBe(0);
  });

  it(`notes at most ${MAX_CANDIDATES} paths for a turn`, () => {
    const { service, posted, change } = setup();
    service.handle({ type: 'watch', id: 1, root: A });
    for (let i = 0; i < MAX_CANDIDATES + 5; i++) change(A, `s${i}.png`);
    vi.advanceTimersByTime(BATCH_MS);
    const [, paths] = (posted[0] as Extract<WatchMessage, { type: 'changes' }>).paths[0];
    expect(paths).toHaveLength(MAX_CANDIDATES);
  });
});

describe('isWatchRequest and isWatchMessage', () => {
  it('take only what the other side sends', () => {
    expect(isWatchRequest({ type: 'watch', id: 1, root: A })).toBe(true);
    expect(isWatchRequest({ type: 'unwatch', id: 1 })).toBe(true);
    expect(isWatchRequest({ type: 'watch', id: 1 })).toBe(false);
    expect(isWatchRequest({ type: 'other', id: 1 })).toBe(false);
    expect(isWatchRequest(null)).toBe(false);

    expect(isWatchMessage({ type: 'changes', count: 1, paths: [] })).toBe(true);
    expect(isWatchMessage({ type: 'unwatched', id: 1 })).toBe(true);
    expect(isWatchMessage({ type: 'error', id: 1, message: 'x' })).toBe(true);
    expect(isWatchMessage({ type: 'error', id: 1 })).toBe(false);
    expect(isWatchMessage({ type: 'changes', count: 1 })).toBe(false);
    expect(isWatchMessage('changes')).toBe(false);
  });
});
