import { describe, it, expect } from 'vitest';
import { limitedQueue } from './limited-queue.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('limitedQueue', () => {
  it('runs at most the limit at once, then the rest in order as slots free', async () => {
    const q = limitedQueue(2);
    const jobs = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    jobs.forEach((d, i) => q.add(() => { started.push(i); return d.promise; }));
    expect(started).toEqual([0, 1]);

    jobs[1].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);

    jobs[0].reject(new Error('failed'));
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('keeps going after a job that throws before returning a promise', async () => {
    const q = limitedQueue(1);
    const started: string[] = [];
    q.add(() => { started.push('a'); throw new Error('boom'); });
    q.add(async () => { started.push('b'); });
    await flush();
    expect(started).toEqual(['a', 'b']);
  });

  it('drops waiting jobs on clear, but lets running ones finish', async () => {
    const q = limitedQueue(1);
    const first = deferred();
    const started: string[] = [];
    q.add(() => { started.push('a'); return first.promise; });
    q.add(async () => { started.push('b'); });
    q.clear();

    first.resolve();
    await flush();
    expect(started).toEqual(['a']);

    q.add(async () => { started.push('c'); });
    await flush();
    expect(started).toEqual(['a', 'c']);
  });
});
