import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./background-tasks.js', () => ({ backgroundModelFor: () => 'small-model' }));

import { assertTextGeneration, generateBackgroundText, unwrapFence } from './background-text.js';
import type { AgentAdapter } from './adapters/types.js';

function makeAdapter(generateText?: (sys: string, user: string, opts?: any) => Promise<string>): AgentAdapter {
  return { id: 'test', displayName: 'Test Agent', ...(generateText ? { generateText } : {}) } as unknown as AgentAdapter;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('assertTextGeneration', () => {
  it('throws for an agent without text generation', () => {
    expect(() => assertTextGeneration(makeAdapter())).toThrow('The Test Agent agent does not support text generation');
    expect(() => assertTextGeneration(makeAdapter(async () => ''))).not.toThrow();
  });
});

describe('generateBackgroundText', () => {
  it('asks on the background model in the given folder', async () => {
    const generateText = vi.fn(async () => 'reply');
    expect(await generateBackgroundText(makeAdapter(generateText), 'sys', 'user', '/wt')).toBe('reply');
    expect(generateText).toHaveBeenCalledWith('sys', 'user', expect.objectContaining({ cwd: '/wt', model: 'small-model' }));
  });

  it('aborts the request once the time limit passes', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const generateText = vi.fn((_s: string, _u: string, opts: { abortSignal: AbortSignal }) => {
      signal = opts.abortSignal;
      return new Promise<string>((_resolve, reject) => {
        opts.abortSignal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const pending = generateBackgroundText(makeAdapter(generateText), 's', 'u', '/wt', 1_000);
    vi.advanceTimersByTime(1_000);
    await expect(pending).rejects.toThrow('aborted');
    expect(signal?.aborted).toBe(true);
  });

  it('aborts the request when the caller\'s signal aborts', async () => {
    let signal: AbortSignal | undefined;
    const generateText = vi.fn((_s: string, _u: string, opts: { abortSignal: AbortSignal }) => {
      signal = opts.abortSignal;
      return new Promise<string>((_resolve, reject) => {
        opts.abortSignal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const caller = new AbortController();
    const pending = generateBackgroundText(makeAdapter(generateText), 's', 'u', '/wt', 60_000, caller.signal);
    caller.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(signal?.aborted).toBe(true);
  });

  it('does not ask at all when the caller\'s signal already aborted', async () => {
    const generateText = vi.fn(async () => 'reply');
    const caller = new AbortController();
    caller.abort();
    await expect(generateBackgroundText(makeAdapter(generateText), 's', 'u', '/wt', 60_000, caller.signal)).rejects.toThrow();
    expect(generateText).not.toHaveBeenCalled();
  });

  it('throws without asking an agent that cannot generate text', async () => {
    await expect(generateBackgroundText(makeAdapter(), 's', 'u', '/wt')).rejects.toThrow('does not support text generation');
  });
});

describe('unwrapFence', () => {
  it('returns the body of a fenced reply, and anything else as it is', () => {
    expect(unwrapFence('```\nfeat: x\n```')).toBe('feat: x');
    expect(unwrapFence('```text\nfeat: x\n\nBody\n```')).toBe('feat: x\n\nBody');
    expect(unwrapFence('feat: `x`')).toBe('feat: `x`');
  });
});
