import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const { mockGetSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(() => ({ dockerOAuthToken: '' })),
}));
// docker-utils.ts imports from '../settings.js' (relative to src/main/docker/)
// which resolves to src/main/settings.js — mock that path from our test location
vi.mock('./settings.js', () => ({
  getSettings: mockGetSettings,
}));

import { toDockerPath, getClaudeConfigDir, getDockerAuthEnv, clearDockerCache } from './docker/docker-utils.js';

beforeEach(() => {
  vi.clearAllMocks();
  clearDockerCache();
});

describe('toDockerPath()', () => {
  // Save and restore platform
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('converts Windows drive letter path on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(toDockerPath('C:\\Users\\foo\\project')).toBe('/c/Users/foo/project');
  });

  it('converts uppercase drive letter to lowercase on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(toDockerPath('D:\\Work\\repo')).toBe('/d/Work/repo');
  });

  it('normalizes backslashes without drive letter on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(toDockerPath('relative\\path\\file')).toBe('relative/path/file');
  });

  it('returns path unchanged on linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(toDockerPath('/home/user/project')).toBe('/home/user/project');
  });

  it('returns path unchanged on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(toDockerPath('/Users/foo/project')).toBe('/Users/foo/project');
  });
});

describe('getClaudeConfigDir()', () => {
  it('returns ~/.claude path', () => {
    const dir = getClaudeConfigDir();
    expect(dir).toMatch(/\.claude$/);
  });
});

describe('getDockerAuthEnv()', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns ANTHROPIC_API_KEY when set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const result = getDockerAuthEnv();
    expect(result).toEqual({ key: 'ANTHROPIC_API_KEY', value: 'sk-test-key' });
  });

  it('prefers ANTHROPIC_API_KEY over CLAUDE_CODE_OAUTH_TOKEN', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-key';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-token';
    const result = getDockerAuthEnv();
    expect(result!.key).toBe('ANTHROPIC_API_KEY');
  });

  it('falls back to CLAUDE_CODE_OAUTH_TOKEN', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-token';
    const result = getDockerAuthEnv();
    expect(result).toEqual({ key: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'oauth-token' });
  });

  it('falls back to settings dockerOAuthToken', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    mockGetSettings.mockReturnValue({ dockerOAuthToken: 'saved-token' } as any);
    const result = getDockerAuthEnv();
    expect(result).toEqual({ key: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'saved-token' });
  });

  it('returns null when no auth available', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    mockGetSettings.mockReturnValue({ dockerOAuthToken: '' } as any);
    expect(getDockerAuthEnv()).toBeNull();
  });
});
