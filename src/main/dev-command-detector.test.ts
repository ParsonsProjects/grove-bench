import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAccess, mockReadFile } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockReadFile: vi.fn(),
}));

// Source uses `import * as fs` so both default and named `promises` are needed
vi.mock('node:fs', () => ({
  default: {
    promises: {
      access: mockAccess,
      readFile: mockReadFile,
    },
  },
  promises: {
    access: mockAccess,
    readFile: mockReadFile,
  },
}));

import { detectDevCommand } from './dev-command-detector.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no lock files exist
  mockAccess.mockRejectedValue(new Error('ENOENT'));
});

function withPackageJson(scripts: Record<string, string>) {
  mockReadFile.mockResolvedValue(JSON.stringify({ scripts }));
}

describe('detectDevCommand()', () => {
  it('returns null when no package.json exists', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    expect(await detectDevCommand('/some/dir')).toBeNull();
  });

  it('returns null when package.json has no scripts', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}));
    expect(await detectDevCommand('/some/dir')).toBeNull();
  });

  it('returns null when package.json has no matching dev script keys', async () => {
    withPackageJson({ build: 'vite build', test: 'vitest' });
    expect(await detectDevCommand('/some/dir')).toBeNull();
  });

  it('detects "dev" script with npm as default runner', async () => {
    withPackageJson({ dev: 'vite', build: 'vite build' });
    expect(await detectDevCommand('/some/dir')).toBe('npm run dev');
  });

  it('detects "start" script', async () => {
    withPackageJson({ start: 'node server.js' });
    expect(await detectDevCommand('/some/dir')).toBe('npm run start');
  });

  it('detects "serve" script', async () => {
    withPackageJson({ serve: 'vite preview' });
    expect(await detectDevCommand('/some/dir')).toBe('npm run serve');
  });

  it('detects "develop" script', async () => {
    withPackageJson({ develop: 'gatsby develop' });
    expect(await detectDevCommand('/some/dir')).toBe('npm run develop');
  });

  it('prefers "dev" over "start" (priority order)', async () => {
    withPackageJson({ start: 'node index.js', dev: 'vite' });
    expect(await detectDevCommand('/some/dir')).toBe('npm run dev');
  });

  it('uses bun runner when bun.lockb exists', async () => {
    withPackageJson({ dev: 'vite' });
    mockAccess.mockImplementation((filePath: string) => {
      if (filePath.endsWith('bun.lockb')) return Promise.resolve();
      return Promise.reject(new Error('ENOENT'));
    });
    expect(await detectDevCommand('/some/dir')).toBe('bun run dev');
  });

  it('uses bun runner when bun.lock exists', async () => {
    withPackageJson({ dev: 'vite' });
    mockAccess.mockImplementation((filePath: string) => {
      if (filePath.endsWith('bun.lock')) return Promise.resolve();
      return Promise.reject(new Error('ENOENT'));
    });
    expect(await detectDevCommand('/some/dir')).toBe('bun run dev');
  });

  it('uses pnpm runner when pnpm-lock.yaml exists', async () => {
    withPackageJson({ dev: 'vite' });
    mockAccess.mockImplementation((filePath: string) => {
      if (filePath.endsWith('pnpm-lock.yaml')) return Promise.resolve();
      return Promise.reject(new Error('ENOENT'));
    });
    expect(await detectDevCommand('/some/dir')).toBe('pnpm run dev');
  });

  it('uses yarn runner when yarn.lock exists', async () => {
    withPackageJson({ dev: 'vite' });
    mockAccess.mockImplementation((filePath: string) => {
      if (filePath.endsWith('yarn.lock')) return Promise.resolve();
      return Promise.reject(new Error('ENOENT'));
    });
    expect(await detectDevCommand('/some/dir')).toBe('yarn run dev');
  });

  it('prefers bun over pnpm when both lock files exist', async () => {
    withPackageJson({ dev: 'vite' });
    mockAccess.mockImplementation((filePath: string) => {
      if (filePath.endsWith('bun.lockb') || filePath.endsWith('pnpm-lock.yaml'))
        return Promise.resolve();
      return Promise.reject(new Error('ENOENT'));
    });
    expect(await detectDevCommand('/some/dir')).toBe('bun run dev');
  });

  it('returns null when package.json is invalid JSON', async () => {
    mockReadFile.mockResolvedValue('not json');
    expect(await detectDevCommand('/some/dir')).toBeNull();
  });
});
