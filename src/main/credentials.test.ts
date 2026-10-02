import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, safeStorage } from 'electron';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  canStoreApiKey,
  clearApiKey,
  getApiKey,
  hasApiKey,
  isApiKeyRejected,
  isApiKeyUnverified,
  markApiKeyRejected,
  parseApiKey,
  resetCredentialsCache,
  saveApiKey,
} from './credentials.js';

let userData: string;

function credentialsFile(): string {
  return path.join(userData, 'credentials.json');
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-credentials-'));
  vi.mocked(app.getPath).mockReturnValue(userData);
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  resetCredentialsCache();
});

afterEach(() => {
  vi.mocked(app.getPath).mockImplementation((name: string) => `/mock/${name}`);
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('credentials', () => {
  it('reports no key before one is saved', () => {
    expect(getApiKey('claude-code')).toBeNull();
    expect(hasApiKey('claude-code')).toBe(false);
  });

  it('saves a key encrypted and reads it back', () => {
    saveApiKey('claude-code', 'sk-test-123');

    const raw = fs.readFileSync(credentialsFile(), 'utf-8');
    expect(raw).not.toContain('sk-test-123');
    expect(safeStorage.encryptString).toHaveBeenCalledWith('sk-test-123');

    resetCredentialsCache();
    expect(getApiKey('claude-code')).toBe('sk-test-123');
    expect(hasApiKey('claude-code')).toBe(true);
  });

  it('trims surrounding whitespace from a pasted key', () => {
    saveApiKey('claude-code', '  sk-test-123\n');
    resetCredentialsCache();
    expect(getApiKey('claude-code')).toBe('sk-test-123');
  });

  it('keeps keys for different adapters apart', () => {
    saveApiKey('claude-code', 'sk-a');
    saveApiKey('other', 'sk-b');
    resetCredentialsCache();
    expect(getApiKey('claude-code')).toBe('sk-a');
    expect(getApiKey('other')).toBe('sk-b');
  });

  it.each([
    ['', 'Enter an API key.'],
    ['   ', 'Enter an API key.'],
    ['sk has spaces', 'An API key cannot contain spaces.'],
    ['x'.repeat(513), 'That API key is too long.'],
    [42, undefined],
  ])('rejects %j', (input, message) => {
    expect(() => saveApiKey('claude-code', input)).toThrow(message);
    expect(fs.existsSync(credentialsFile())).toBe(false);
  });

  it('refuses to save when the OS has no encryption', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    expect(canStoreApiKey()).toBe(false);
    expect(() => saveApiKey('claude-code', 'sk-test')).toThrow(/secure storage/);
    expect(fs.existsSync(credentialsFile())).toBe(false);
  });

  it('clears a saved key', () => {
    saveApiKey('claude-code', 'sk-a');
    saveApiKey('other', 'sk-b');
    clearApiKey('claude-code');
    expect(getApiKey('claude-code')).toBeNull();

    resetCredentialsCache();
    expect(getApiKey('claude-code')).toBeNull();
    expect(getApiKey('other')).toBe('sk-b');
  });

  it('treats a key that fails to decrypt as missing', () => {
    saveApiKey('claude-code', 'sk-a');
    resetCredentialsCache();
    vi.mocked(safeStorage.decryptString).mockImplementationOnce(() => {
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
    });
    expect(getApiKey('claude-code')).toBeNull();
  });

  describe('when the file is unreadable (e.g. locked by antivirus)', () => {
    const lockError = () => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    /** Locked for longer than the read retries wait. */
    const busy = () => vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw lockError(); });
    afterEach(() => vi.restoreAllMocks());

    it("doesn't remember the failure as \"no key\"", () => {
      saveApiKey('claude-code', 'sk-a');
      resetCredentialsCache();
      const spy = busy();
      expect(getApiKey('claude-code')).toBeNull();
      spy.mockRestore();
      expect(getApiKey('claude-code')).toBe('sk-a');
    });

    it("doesn't overwrite the file when saving or clearing", () => {
      saveApiKey('claude-code', 'sk-a');
      saveApiKey('other-agent', 'sk-b');
      const spy = busy();
      expect(() => saveApiKey('claude-code', 'sk-new')).toThrow(/nothing was changed/);
      expect(() => clearApiKey('claude-code')).toThrow(/nothing was changed/);
      spy.mockRestore();
      resetCredentialsCache();
      expect(getApiKey('claude-code')).toBe('sk-a');
      expect(getApiKey('other-agent')).toBe('sk-b');
    });

    it('rides out a brief lock', () => {
      saveApiKey('claude-code', 'sk-a');
      resetCredentialsCache();
      vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw lockError(); });
      expect(getApiKey('claude-code')).toBe('sk-a');
    });
  });

  it('replaces the file in one step and leaves no temp files', () => {
    saveApiKey('claude-code', 'sk-a');
    saveApiKey('other-agent', 'sk-b');
    clearApiKey('claude-code');
    expect(fs.readdirSync(userData)).toEqual(['credentials.json']);
  });

  it('treats a corrupt file as empty', () => {
    fs.writeFileSync(credentialsFile(), '{not json');
    expect(getApiKey('claude-code')).toBeNull();
    saveApiKey('claude-code', 'sk-a');
    resetCredentialsCache();
    expect(getApiKey('claude-code')).toBe('sk-a');
  });

  it('parses a pasted key without saving it', () => {
    expect(parseApiKey('  sk-a \n')).toBe('sk-a');
    expect(() => parseApiKey('')).toThrow('Enter an API key.');
    expect(() => parseApiKey('sk a')).toThrow('cannot contain spaces');
    expect(fs.existsSync(credentialsFile())).toBe(false);
  });

  describe('a key the provider refused', () => {
    it('is flagged until a new key is saved or the key is removed', () => {
      saveApiKey('claude-code', 'sk-bad');
      markApiKeyRejected('claude-code');
      expect(isApiKeyRejected('claude-code')).toBe(true);

      saveApiKey('claude-code', 'sk-good');
      expect(isApiKeyRejected('claude-code')).toBe(false);

      markApiKeyRejected('claude-code');
      clearApiKey('claude-code');
      expect(isApiKeyRejected('claude-code')).toBe(false);
    });

    it('is not flagged when no key is saved (another sign-in failed)', () => {
      markApiKeyRejected('claude-code');
      expect(isApiKeyRejected('claude-code')).toBe(false);
    });

    it('is only flagged for its own agent', () => {
      saveApiKey('claude-code', 'sk-a');
      saveApiKey('other', 'sk-b');
      markApiKeyRejected('claude-code');
      expect(isApiKeyRejected('other')).toBe(false);
    });
  });

  it('remembers a key saved without a check until it is replaced, refused or removed', () => {
    saveApiKey('claude-code', 'sk-a', { unverified: true });
    expect(isApiKeyUnverified('claude-code')).toBe(true);
    saveApiKey('claude-code', 'sk-b');
    expect(isApiKeyUnverified('claude-code')).toBe(false);

    saveApiKey('claude-code', 'sk-c', { unverified: true });
    markApiKeyRejected('claude-code');
    expect(isApiKeyUnverified('claude-code')).toBe(false);

    saveApiKey('claude-code', 'sk-d', { unverified: true });
    clearApiKey('claude-code');
    expect(isApiKeyUnverified('claude-code')).toBe(false);
  });
});
