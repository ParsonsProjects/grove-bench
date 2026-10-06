/**
 * Gemini CLI's API key. Google stopped serving Gemini CLI to personal Google
 * accounts on 18 June 2026 ("This client is no longer supported for Gemini
 * Code Assist for individuals"); API keys, Vertex AI and Code Assist
 * Standard or Enterprise still work, so a key saved in Grove is the way in
 * for most people.
 *
 * Gemini CLI reads the key from GEMINI_API_KEY when it hasn't been set to
 * another sign-in. When it has (the old Google sign-in), session/new is
 * turned down, and the adapter asks it to sign in with method
 * 'gemini-api-key', passing the key in `_meta['api-key']` (Gemini CLI 0.62,
 * `authenticate` in its ACP client). Gemini CLI then saves that choice in its
 * own settings.
 */
import { net } from 'electron';
import { logger } from '../../logger.js';

/** Lists models, which any working key may do (Gemini API, models.list). */
const GEMINI_KEY_CHECK_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';
const GEMINI_KEY_CHECK_TIMEOUT_MS = 10_000;

type KeyCheckFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** True when Google accepts the key, false when it refuses it (400 for a key
 *  that isn't valid, 401/403 for one that may not call the Gemini API), null
 *  when that couldn't be told (offline, a server error). */
export async function verifyGeminiKey(
  key: string,
  { fetchFn = (url, init) => net.fetch(url, init) }: { fetchFn?: KeyCheckFetch } = {},
): Promise<boolean | null> {
  try {
    const res = await fetchFn(GEMINI_KEY_CHECK_URL, {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(GEMINI_KEY_CHECK_TIMEOUT_MS),
    });
    if (res.ok) return true;
    if (res.status === 400 || res.status === 401 || res.status === 403) return false;
    logger.debug(`[gemini] key check answered ${res.status}`);
    return null;
  } catch (err) {
    logger.debug('[gemini] key check failed:', err);
    return null;
  }
}
