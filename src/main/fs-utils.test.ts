import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFs = vi.hoisted(() => ({
  rm: vi.fn(),
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ ...mockFs, default: mockFs }));

const mockExeca = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: mockExeca }));

import { removeDirectory, removeDirectoryWithRetry, readFileWithRetry, writeFileAtomic } from './fs-utils.js';

beforeEach(() => {
  vi.resetAllMocks();
  mockExeca.mockResolvedValue({ exitCode: 0 });
  // Like the real fs, every call returns a promise.
  mockFs.rm.mockResolvedValue(undefined);
  mockFs.writeFile.mockResolvedValue(undefined);
  mockFs.rename.mockResolvedValue(undefined);
});

describe('removeDirectory', () => {
  it('returns once the directory is gone without touching fs.rm on Windows', async () => {
    if (process.platform !== 'win32') return;
    mockFs.access.mockRejectedValue(new Error('ENOENT'));

    await removeDirectory('C:\\tmp\\wt');

    expect(mockExeca).toHaveBeenCalledWith(
      'cmd.exe',
      expect.arrayContaining([expect.stringContaining('rmdir /s /q')]),
      expect.objectContaining({ reject: false }),
    );
    expect(mockFs.rm).not.toHaveBeenCalled();
  });

  it('falls back to fs.rm when the directory survives the shell delete', async () => {
    mockFs.access.mockResolvedValue(undefined);
    mockFs.rm.mockResolvedValue(undefined);

    await removeDirectory('/tmp/wt');

    expect(mockFs.rm).toHaveBeenCalledWith('/tmp/wt', { recursive: true, force: true });
  });

  it('propagates the fs.rm error so callers can retry', async () => {
    mockFs.access.mockResolvedValue(undefined);
    const busy = Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    mockFs.rm.mockRejectedValue(busy);

    await expect(removeDirectory('/tmp/wt')).rejects.toBe(busy);
  });
});

describe('removeDirectoryWithRetry', () => {
  it('retries with the given backoff and succeeds once the lock clears', async () => {
    mockFs.access.mockResolvedValue(undefined);
    mockFs.rm
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await removeDirectoryWithRetry('/tmp/wt', [10, 20, 30], sleep);

    expect(mockFs.rm).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20]);
  });

  it('throws the last error after exhausting every attempt', async () => {
    mockFs.access.mockResolvedValue(undefined);
    const busy = new Error('EBUSY');
    mockFs.rm.mockRejectedValue(busy);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(removeDirectoryWithRetry('/tmp/wt', [1, 2], sleep)).rejects.toBe(busy);

    // one initial attempt + one per delay
    expect(mockFs.rm).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe('writeFileAtomic', () => {
  const errno = (code: string) => Object.assign(new Error(code), { code });
  const noSleep = vi.fn(async () => {});

  it('writes a temp file beside the target, then renames it over the target', async () => {
    await writeFileAtomic('/data/manifest.json', '{}', noSleep);

    const tmp = mockFs.writeFile.mock.calls[0][0] as string;
    expect(tmp).toMatch(/^\/data\/manifest\.json\..+\.tmp$/);
    expect(mockFs.writeFile).toHaveBeenCalledWith(tmp, '{}');
    expect(mockFs.rename).toHaveBeenCalledWith(tmp, '/data/manifest.json');
  });

  it('retries the rename while another process holds the target', async () => {
    mockFs.rename.mockRejectedValueOnce(errno('EPERM')).mockResolvedValueOnce(undefined);
    await writeFileAtomic('/data/manifest.json', '{}', noSleep);
    expect(mockFs.rename).toHaveBeenCalledTimes(2);
  });

  it('removes the temp file and throws when the rename keeps failing', async () => {
    mockFs.rename.mockRejectedValue(errno('EBUSY'));
    await expect(writeFileAtomic('/data/manifest.json', '{}', noSleep)).rejects.toThrow('EBUSY');
    expect(mockFs.rm).toHaveBeenCalledWith(mockFs.writeFile.mock.calls[0][0], { force: true });
  });
});

describe('readFileWithRetry', () => {
  const errno = (code: string) => Object.assign(new Error(code), { code });

  it('rides out a brief lock', async () => {
    mockFs.readFile.mockRejectedValueOnce(errno('EBUSY')).mockResolvedValueOnce('data');
    expect(await readFileWithRetry('/f', async () => {})).toBe('data');
  });

  it('throws a missing file at once', async () => {
    mockFs.readFile.mockRejectedValue(errno('ENOENT'));
    await expect(readFileWithRetry('/f', async () => {})).rejects.toThrow('ENOENT');
    expect(mockFs.readFile).toHaveBeenCalledTimes(1);
  });
});
