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

  describe('when the file is briefly unreadable (e.g. locked by antivirus)', () => {
    const busy = () => vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    });
    afterEach(() => vi.restoreAllMocks());

    it("doesn't remember the failure as \"no key\"", () => {
      saveApiKey('claude-code', 'sk-a');
      resetCredentialsCache();
      busy();
      expect(getApiKey('claude-code')).toBeNull();
      expect(getApiKey('claude-code')).toBe('sk-a');
    });

    it("doesn't overwrite the file when saving or clearing", () => {
      saveApiKey('claude-code', 'sk-a');
      saveApiKey('other-agent', 'sk-b');
      busy();
      expect(() => saveApiKey('claude-code', 'sk-new')).toThrow(/nothing was changed/);
      busy();
      expect(() => clearApiKey('claude-code')).toThrow(/nothing was changed/);
      resetCredentialsCache();
      expect(getApiKey('claude-code')).toBe('sk-a');
      expect(getApiKey('other-agent')).toBe('sk-b');
    });
  });

  it('treats a corrupt file as empty', () => {
    fs.writeFileSync(credentialsFile(), '{not json');
    expect(getApiKey('claude-code')).toBeNull();
    saveApiKey('claude-code', 'sk-a');
    resetCredentialsCache();
    expect(getApiKey('claude-code')).toBe('sk-a');
  });
});
