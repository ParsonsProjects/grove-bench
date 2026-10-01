import { app, safeStorage } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import { logger } from './logger.js';
import { readJsonFile, writeFileAtomicSync } from './json-file.js';

/**
 * API keys the user enters in the app, one per adapter id. Each key is
 * encrypted with Electron safeStorage (DPAPI on Windows) before it touches
 * disk, and never goes back to the renderer: the renderer only learns whether
 * a key is saved. The adapter reads it when it launches the agent.
 */

const credentialsFileSchema = z.object({
  apiKeys: z.record(z.string(), z.string()).default({}),
});

type CredentialsFile = z.infer<typeof credentialsFileSchema>;

const apiKeySchema = z
  .string()
  .trim()
  .min(1, 'Enter an API key.')
  .max(512, 'That API key is too long.')
  .regex(/^\S+$/, 'An API key cannot contain spaces.');

function getCredentialsPath(): string {
  return path.join(app.getPath('userData'), 'credentials.json');
}

/**
 * The saved keys. A missing file, or one that isn't valid, reads as empty
 * (saving a key then replaces a corrupt file). A file that can't be read,
 * such as one locked by antivirus for longer than the retries wait, throws,
 * so a passing failure isn't mistaken for "no keys saved".
 */
function readCredentials(): CredentialsFile {
  const read = readJsonFile(getCredentialsPath());
  if (read.kind === 'unreadable') throw read.error;
  if (read.kind !== 'ok') return { apiKeys: {} };
  const parsed = credentialsFileSchema.safeParse(read.value);
  if (!parsed.success) {
    logger.warn('[credentials] credentials.json is not valid; treating it as empty:', parsed.error);
    return { apiKeys: {} };
  }
  return parsed.data;
}

/** readCredentials for save and clear, which must not overwrite a file they
 *  couldn't read: that would drop the other agents' keys. */
function readCredentialsForUpdate(): CredentialsFile {
  try {
    return readCredentials();
  } catch (err) {
    logger.warn('[credentials] could not read saved API keys:', err);
    throw new Error("Couldn't read your saved API keys, so nothing was changed. Try again in a moment.");
  }
}

function writeCredentials(data: CredentialsFile): void {
  writeFileAtomicSync(getCredentialsPath(), JSON.stringify(data), 0o600);
}

/** Decrypted keys by adapter id (null = none saved), filled on first read.
 *  Every agent launch reads the key, so this avoids a disk read and a
 *  decrypt per launch. */
const cache = new Map<string, string | null>();

/** Saved keys the provider refused, and ones saved without a check, by
 *  adapter id. Kept for this run only: after a restart the next conversation
 *  finds a bad key again. */
const rejected = new Set<string>();
const unverified = new Set<string>();

/** False when the OS offers no encryption, in which case nothing is saved. */
export function canStoreApiKey(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function getApiKey(adapterId: string): string | null {
  const cached = cache.get(adapterId);
  if (cached !== undefined) return cached;

  let data: CredentialsFile;
  try {
    data = readCredentials();
  } catch (err) {
    // Not cached: the next launch tries the file again.
    logger.warn(`[credentials] could not read saved API keys; will retry:`, err);
    return null;
  }
  let key: string | null = null;
  const stored = data.apiKeys[adapterId];
  if (stored) {
    try {
      key = safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch (err) {
      // A key encrypted under another Windows account (roaming profile,
      // copied userData) can't be decrypted. Treat it as missing so the user
      // is asked for it again.
      logger.warn(`[credentials] could not decrypt the saved API key for ${adapterId}:`, err);
    }
  }
  cache.set(adapterId, key);
  return key;
}

export function hasApiKey(adapterId: string): boolean {
  return getApiKey(adapterId) !== null;
}

/** Checks the shape of a pasted key and returns it trimmed. Throws a
 *  user-facing message when it can't be a key. */
export function parseApiKey(rawKey: unknown): string {
  const parsed = apiKeySchema.safeParse(rawKey);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'That API key is not valid.');
  }
  return parsed.data;
}

/** Validates, encrypts and saves a key. Throws a user-facing message when the
 *  key is malformed or the OS can't encrypt it. `unverified`: the provider
 *  couldn't be reached to check it. */
export function saveApiKey(adapterId: string, rawKey: unknown, opts: { unverified?: boolean } = {}): void {
  const key = parseApiKey(rawKey);
  if (!canStoreApiKey()) {
    throw new Error('This computer has no secure storage, so the API key cannot be saved.');
  }
  const data = readCredentialsForUpdate();
  data.apiKeys[adapterId] = safeStorage.encryptString(key).toString('base64');
  writeCredentials(data);
  cache.set(adapterId, key);
  rejected.delete(adapterId);
  if (opts.unverified) unverified.add(adapterId);
  else unverified.delete(adapterId);
}

export function clearApiKey(adapterId: string): void {
  const data = readCredentialsForUpdate();
  if (adapterId in data.apiKeys) {
    delete data.apiKeys[adapterId];
    writeCredentials(data);
  }
  cache.set(adapterId, null);
  rejected.delete(adapterId);
  unverified.delete(adapterId);
}

/** The provider refused the saved key (a conversation failed to sign in with
 *  it). Does nothing when no key is saved: the failure was about another
 *  sign-in. */
export function markApiKeyRejected(adapterId: string): void {
  if (!hasApiKey(adapterId)) return;
  rejected.add(adapterId);
  unverified.delete(adapterId);
}

export function isApiKeyRejected(adapterId: string): boolean {
  return rejected.has(adapterId);
}

export function isApiKeyUnverified(adapterId: string): boolean {
  return unverified.has(adapterId);
}

/** Test hook: forget decrypted keys so the next read goes to disk. */
export function resetCredentialsCache(): void {
  cache.clear();
  rejected.clear();
  unverified.clear();
}
