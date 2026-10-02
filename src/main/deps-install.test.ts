import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('./process-tree.js', () => ({ killTree: vi.fn(async () => {}) }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execa } from 'execa';
import { killTree } from './process-tree.js';
import { installDependencies } from './deps-install.js';

/** A running install that settles when the test says so. */
function fakeInstall(pid = 4321) {
  let settle!: (err?: Error) => void;
  const done = new Promise<void>((resolve, reject) => { settle = (err) => (err ? reject(err) : resolve()); });
  vi.mocked(execa).mockReturnValue(Object.assign(done, { pid }) as never);
  return settle;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('installDependencies', () => {
  it('runs npm install with the shared cache', async () => {
    const settle = fakeInstall();
    const done = installDependencies('/wt', '/cache', new AbortController().signal);
    settle();
    await done;
    expect(execa).toHaveBeenCalledWith('npm', ['install', '--prefer-offline', '--cache', '/cache'], { cwd: '/wt' });
  });

  it('kills the whole install tree on abort and rejects with the abort', async () => {
    const settle = fakeInstall(4321);
    const abort = new AbortController();
    const done = installDependencies('/wt', '/cache', abort.signal);

    abort.abort();
    expect(killTree).toHaveBeenCalledWith(4321);
    settle(new Error('Command was killed'));

    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes a real install failure through', async () => {
    const settle = fakeInstall();
    const done = installDependencies('/wt', '/cache', new AbortController().signal);
    settle(new Error('npm ERR! 404'));
    await expect(done).rejects.toThrow('npm ERR! 404');
  });

  it('does not start when already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(installDependencies('/wt', '/cache', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(execa).not.toHaveBeenCalled();
  });
});
