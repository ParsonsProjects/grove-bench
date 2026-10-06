import { describe, it, expect, vi } from 'vitest';
import { verifyGeminiKey } from './gemini.js';

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
vi.mock('../../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

describe('verifyGeminiKey', () => {
  const answering = (status: number) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status }));

  it('lists models with the key in x-goog-api-key', async () => {
    const fetchFn = answering(200);
    await expect(verifyGeminiKey('AIza-test', { fetchFn })).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/), expect.objectContaining({
      headers: { 'x-goog-api-key': 'AIza-test' },
    }));
  });

  it('reads 400, 401 and 403 as refused, and anything else as unknown', async () => {
    for (const status of [400, 401, 403]) await expect(verifyGeminiKey('k', { fetchFn: answering(status) })).resolves.toBe(false);
    await expect(verifyGeminiKey('k', { fetchFn: answering(503) })).resolves.toBeNull();
    await expect(verifyGeminiKey('k', { fetchFn: vi.fn(async () => { throw new Error('offline'); }) })).resolves.toBeNull();
  });
});
