import { net } from 'electron';
import { logger } from '../logger.js';

export type KeyCheckFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

const KEY_CHECK_TIMEOUT_MS = 10_000;

/**
 * Ask a provider whether an API key works, with one GET that any working key
 * may make: true when it answers OK, false when it answers one of `refused`,
 * null when that couldn't be told (offline, a proxy in the way, an outage,
 * any other answer). Uses Electron's network stack, which follows the
 * system's proxy settings. Each adapter's verifyApiKey calls it.
 */
export async function checkKeyWithGet(
  url: string,
  headers: Record<string, string>,
  { refused, label, fetchFn = (u, init) => net.fetch(u, init) }: { refused: readonly number[]; label: string; fetchFn?: KeyCheckFetch },
): Promise<boolean | null> {
  try {
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS) });
    if (res.ok) return true;
    if (refused.includes(res.status)) return false;
    logger.debug(`[${label}] key check answered ${res.status}`);
    return null;
  } catch (err) {
    logger.debug(`[${label}] key check failed:`, err);
    return null;
  }
}
