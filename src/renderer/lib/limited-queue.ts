/**
 * Runs queued async jobs at most `limit` at a time, in the order added.
 * Used where one action can start a child process per row (git, gh), so a
 * long list doesn't start them all in one burst.
 */
export interface LimitedQueue {
  add(job: () => Promise<unknown>): void;
  /** Drop jobs not started yet. Running ones finish (their callers decide
   *  whether the result still matters). */
  clear(): void;
}

export function limitedQueue(limit: number): LimitedQueue {
  let waiting: Array<() => Promise<unknown>> = [];
  let running = 0;

  function pump() {
    while (running < limit && waiting.length > 0) {
      const job = waiting.shift()!;
      running++;
      let started: Promise<unknown>;
      try {
        started = job();
      } catch (err) {
        started = Promise.reject(err);
      }
      started.catch(() => { /* the job reports its own errors */ }).finally(() => {
        running--;
        pump();
      });
    }
  }

  return {
    add(job) {
      waiting.push(job);
      pump();
    },
    clear() {
      waiting = [];
    },
  };
}
