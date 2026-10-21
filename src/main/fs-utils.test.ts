import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFs = vi.hoisted(() => ({
  rm: vi.fn(),
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ ...mockFs, default: mockFs }));

// Deleting a directory starts no process, in either host or here.
const hosted = vi.hoisted(() => ({ runProcess: vi.fn(), runProcessInHost: vi.fn(), spawnProcess: vi.fn() }));
vi.mock('./process-host.js', () => hosted);
const mockExeca = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: mockExeca }));
const childProcess = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn(), exec: vi.fn() }));
vi.mock('node:child_process', () => ({ ...childProcess, default: childProcess }));

import { DEFAULT_REMOVE_DELAYS_MS, removeDirectory, removeDirectoryWithRetry, readFileWithRetry, writeFileAtomic } from './fs-utils.js';

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function expectNoProcess() {
  for (const launch of [hosted.runProcess, hosted.runProcessInHost, hosted.spawnProcess, mockExeca, childProcess.spawn, childProcess.execFile, childProcess.exec]) {
    expect(launch).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  // Like the real fs, every call returns a promise.
  mockFs.rm.mockResolvedValue(undefined);
  mockFs.writeFile.mockResolvedValue(undefined);
  mockFs.rename.mockResolvedValue(undefined);
});

afterEach(() => {
  setPlatform(realPlatform);
});

describe.each([
  ['win32', 'C:\\tmp\\wt'],
  ['linux', '/tmp/wt'],
] as const)('removeDirectory on %s', (platform, dir) => {
  beforeEach(() => setPlatform(platform));

  it('deletes the whole tree with fs.rm, and starts no process', async () => {
    await removeDirectory(dir);

    expect(mockFs.rm).toHaveBeenCalledOnce();
    expect(mockFs.rm).toHaveBeenCalledWith(dir, { recursive: true, force: true });
    // Nor does it look first: fs.rm's `force` takes a directory that is
    // already gone.
    expect(mockFs.access).not.toHaveBeenCalled();
    expectNoProcess();
  });

  it('passes the fs.rm error on, so callers can retry', async () => {
    const busy = Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    mockFs.rm.mockRejectedValue(busy);

    await expect(removeDirectory(dir)).rejects.toBe(busy);
    expectNoProcess();
  });
});

describe('removeDirectoryWithRetry', () => {
  beforeEach(() => setPlatform('win32'));

  it('retries with the given backoff and succeeds once the lock clears', async () => {
    mockFs.rm
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await removeDirectoryWithRetry('C:\\tmp\\wt', [10, 20, 30], sleep);

    expect(mockFs.rm).toHaveBeenCalledTimes(3);
    expect(mockFs.rm).toHaveBeenLastCalledWith('C:\\tmp\\wt', { recursive: true, force: true });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20]);
    expectNoProcess();
  });

  it('throws the last error after exhausting every attempt', async () => {
    const busy = new Error('EBUSY');
    mockFs.rm.mockRejectedValue(busy);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(removeDirectoryWithRetry('C:\\tmp\\wt', [1, 2], sleep)).rejects.toBe(busy);

    // one initial attempt + one per delay
    expect(mockFs.rm).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('uses the default backoff when given none', async () => {
    mockFs.rm.mockRejectedValueOnce(new Error('EBUSY')).mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await removeDirectoryWithRetry('C:\\tmp\\wt', undefined, sleep);

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([DEFAULT_REMOVE_DELAYS_MS[0]]);
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
