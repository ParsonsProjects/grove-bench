import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logger } from './logger.js';

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
 * (saving a key then replaces a corrupt file). Any other read error, such as
 * the file being briefly locked by antivirus, throws, so a passing failure
 * isn't mistaken for "no keys saved".
 */
function readCredentials(): CredentialsFile {
  let text: string;
  try {
    text = fs.readFileSync(getCredentialsPath(), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { apiKeys: {} };
    throw err;
  }
  try {
    return credentialsFileSchema.parse(JSON.parse(text));
  } catch (err) {
    logger.warn('[credentials] credentials.json is not valid; treating it as empty:', err);
    return { apiKeys: {} };
  }
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
  fs.writeFileSync(getCredentialsPath(), JSON.stringify(data), { mode: 0o600 });
}

/** Decrypted keys by adapter id (null = none saved), filled on first read.
 *  Every agent launch reads the key, so this avoids a disk read and a
 *  decrypt per launch. */
const cache = new Map<string, string | null>();

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

/** Validates, encrypts and saves a key. Throws a user-facing message when the
 *  key is malformed or the OS can't encrypt it. */
export function saveApiKey(adapterId: string, rawKey: unknown): void {
  const parsed = apiKeySchema.safeParse(rawKey);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'That API key is not valid.');
  }
  if (!canStoreApiKey()) {
    throw new Error('This computer has no secure storage, so the API key cannot be saved.');
  }
  const data = readCredentialsForUpdate();
  data.apiKeys[adapterId] = safeStorage.encryptString(parsed.data).toString('base64');
  writeCredentials(data);
  cache.set(adapterId, parsed.data);
}

export function clearApiKey(adapterId: string): void {
  const data = readCredentialsForUpdate();
  if (adapterId in data.apiKeys) {
    delete data.apiKeys[adapterId];
    writeCredentials(data);
  }
  cache.set(adapterId, null);
}

/** Test hook: forget decrypted keys so the next read goes to disk. */
export function resetCredentialsCache(): void {
  cache.clear();
}
