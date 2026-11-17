import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createRemoveTree, MAX_THREAD_FAILURES, type StartThread } from './remove-tree.js';
import { handleRemoveRequest, isRemoveMessage, isRemoveRequest, type RemoveRequest } from './remove-tree-protocol.js';

/** A thread that holds each request until the test answers it. */
function fakeThread() {
  const requests: RemoveRequest[] = [];
  let send: (message: unknown) => void = () => {};
  let exit: (reason: unknown) => void = () => {};
  const start = vi.fn<StartThread>((onMessage, onExit) => {
    send = onMessage;
    exit = onExit;
    return { postMessage: (request) => requests.push(request) };
  });
  return {
    start,
    requests,
    done: (id: number) => send({ type: 'done', id }),
    failed: (id: number, code: string) => send({ type: 'failed', id, code, message: `${code}: busy` }),
    stop: () => exit(new Error('crashed')),
  };
}

let removeHere: ReturnType<typeof vi.fn<(dir: string) => Promise<void>>>;

beforeEach(() => {
  removeHere = vi.fn(async () => {});
});

describe('removeTree', () => {
  it('deletes in the thread, and settles as it answers', async () => {
    const thread = fakeThread();
    const removeTree = createRemoveTree({ startThread: thread.start, removeHere });

    const a = removeTree('/wt/.removing/a');
    const b = removeTree('/wt/.removing/b');
    expect(thread.start).toHaveBeenCalledTimes(1);
    expect(thread.requests.map((r) => r.path)).toEqual(['/wt/.removing/a', '/wt/.removing/b']);

    thread.done(thread.requests[0].id);
    thread.failed(thread.requests[1].id, 'EBUSY');
    await expect(a).resolves.toBeUndefined();
    await expect(b).rejects.toMatchObject({ code: 'EBUSY', message: 'EBUSY: busy' });
    expect(removeHere).not.toHaveBeenCalled();
  });

  it('deletes here what a stopped thread had not finished, and starts a new thread for the next', async () => {
    const thread = fakeThread();
    const removeTree = createRemoveTree({ startThread: thread.start, removeHere });

    const a = removeTree('/wt/.removing/a');
    thread.stop();
    await expect(a).resolves.toBeUndefined();
    expect(removeHere).toHaveBeenCalledWith('/wt/.removing/a');

    void removeTree('/wt/.removing/b');
    expect(thread.start).toHaveBeenCalledTimes(2);
  });

  it('deletes here for the rest of the run once the thread has stopped too often', async () => {
    const thread = fakeThread();
    const removeTree = createRemoveTree({ startThread: thread.start, removeHere });
    for (let i = 0; i < MAX_THREAD_FAILURES; i++) {
      const pending = removeTree(`/wt/.removing/${i}`);
      thread.stop();
      await pending;
    }

    await removeTree('/wt/.removing/last');
    expect(thread.start).toHaveBeenCalledTimes(MAX_THREAD_FAILURES);
    expect(removeHere).toHaveBeenLastCalledWith('/wt/.removing/last');
  });

  it('deletes here when there is no thread to start (tests run the sources), one folder at a time', async () => {
    const start = vi.fn<StartThread>(() => { throw new Error('not built'); });
    const finishers: Array<() => void> = [];
    removeHere.mockImplementation(() => new Promise<void>((resolve) => { finishers.push(resolve); }));
    const removeTree = createRemoveTree({ startThread: start, removeHere });

    const a = removeTree('/a');
    const b = removeTree('/b');
    await Promise.resolve();
    await Promise.resolve();
    // Not both at once: b waits for a.
    expect(removeHere.mock.calls.map(([dir]) => dir)).toEqual(['/a']);
    finishers.shift()!();
    await a;
    await vi.waitFor(() => expect(removeHere).toHaveBeenCalledTimes(2));
    finishers.shift()!();
    await b;
    // Not tried again for every folder.
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('a failed delete here does not hold up the next', async () => {
    const start = vi.fn<StartThread>(() => { throw new Error('not built'); });
    removeHere.mockRejectedValueOnce(new Error('EBUSY'));
    const removeTree = createRemoveTree({ startThread: start, removeHere });

    await expect(removeTree('/a')).rejects.toThrow('EBUSY');
    await expect(removeTree('/b')).resolves.toBeUndefined();
  });
});

describe('the delete thread protocol', () => {
  it('says done, or failed with the error code and message', () => {
    const rm = vi.fn();
    expect(handleRemoveRequest({ id: 1, path: '/a' }, rm)).toEqual({ type: 'done', id: 1 });
    expect(rm).toHaveBeenCalledWith('/a');

    rm.mockImplementation(() => { throw Object.assign(new Error('EPERM: not permitted'), { code: 'EPERM' }); });
    expect(handleRemoveRequest({ id: 2, path: '/b' }, rm)).toEqual({ type: 'failed', id: 2, code: 'EPERM', message: 'EPERM: not permitted' });
  });

  it('takes only well-formed requests and answers', () => {
    expect(isRemoveRequest({ id: 1, path: '/a' })).toBe(true);
    expect(isRemoveRequest({ id: 1, path: '' })).toBe(false);
    expect(isRemoveRequest({ path: '/a' })).toBe(false);
    expect(isRemoveRequest(null)).toBe(false);
    expect(isRemoveMessage({ type: 'done', id: 1 })).toBe(true);
    expect(isRemoveMessage({ type: 'failed', id: 1, message: 'x' })).toBe(true);
    expect(isRemoveMessage({ type: 'done' })).toBe(false);
    expect(isRemoveMessage({ type: 'other', id: 1 })).toBe(false);
  });
});
