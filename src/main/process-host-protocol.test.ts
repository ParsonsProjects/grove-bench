import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import {
  isHostReply, isHostRequest, reviveError, runRequest, serializeError, serializeResult,
  type HostReply, type SerializedError,
} from './process-host-protocol.js';

/** A clock the fake exec moves by hand. */
function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('runRequest', () => {
  it('replies with the result fields and how long the launch held the process', async () => {
    const { now, advance } = clock();
    const exec = (file: string, args: string[], options?: object) => {
      advance(40);
      return Promise.resolve({ stdout: 'main', stderr: '', exitCode: 0, failed: false, timedOut: false, file, args, options, all: undefined, pipedFrom: [] });
    };
    const reply = await runRequest({ id: 7, file: 'git', args: ['branch', '--show-current'], options: { cwd: '/repo' } }, exec, now);
    expect(reply).toEqual({ id: 7, ok: true, launchMs: 40, result: { stdout: 'main', stderr: '', exitCode: 0, failed: false, timedOut: false } });
  });

  it('passes no options argument when the request has none', async () => {
    const calls: unknown[][] = [];
    await runRequest({ id: 1, file: 'git', args: ['--version'] }, (...a) => { calls.push(a); return Promise.resolve({}); });
    expect(calls).toEqual([['git', ['--version']]]);
  });

  it('replies with the error fields when the command fails', async () => {
    const error = Object.assign(new Error('Command failed with exit code 128: git rev-parse nope'), {
      name: 'ExecaError', shortMessage: 'Command failed with exit code 128', stderr: 'fatal: bad revision', stdout: '', exitCode: 128, failed: true, timedOut: false,
    });
    const reply = await runRequest({ id: 2, file: 'git', args: ['rev-parse', 'nope'] }, () => Promise.reject(error));
    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error).toMatchObject({ name: 'ExecaError', message: error.message, stderr: 'fatal: bad revision', exitCode: 128, timedOut: false });
  });

  it('replies with an error when the call throws before starting anything', async () => {
    const reply = await runRequest({ id: 3, file: 'git', args: [] }, () => { throw new TypeError('bad option'); });
    expect(reply).toMatchObject({ id: 3, ok: false, error: { name: 'TypeError', message: 'bad option' } });
  });

  it('carries real execa results and failures', async () => {
    const node = process.execPath;
    const ok = await runRequest({ id: 1, file: node, args: ['-e', 'process.stdout.write("hi")'] }, (f, a, o) => execa(f, a, o));
    expect(ok).toMatchObject({ ok: true, result: { stdout: 'hi', exitCode: 0, failed: false } });

    const failed = await runRequest({ id: 2, file: node, args: ['-e', 'process.stderr.write("nope"); process.exit(3)'] }, (f, a, o) => execa(f, a, o));
    expect(failed).toMatchObject({ ok: false, error: { stderr: 'nope', exitCode: 3, failed: true } });

    const bytes = await runRequest({ id: 3, file: node, args: ['-e', 'process.stdout.write("ab")'], options: { encoding: 'buffer' } }, (f, a, o) => execa(f, a, o));
    expect(bytes.ok && Array.from(bytes.result.stdout as Uint8Array)).toEqual([97, 98]);

    const missing = await runRequest({ id: 4, file: 'grove-no-such-program', args: [] }, (f, a, o) => execa(f, a, o));
    expect(missing).toMatchObject({ ok: false, error: { code: 'ENOENT' } });
  });
});

describe('serializing', () => {
  it('keeps only plain result fields', () => {
    const result = serializeResult({ stdout: 'x', stderr: '', exitCode: 0, failed: false, timedOut: false, stdio: [null], pipedFrom: [], ipcOutput: [] });
    expect(result).toEqual({ stdout: 'x', stderr: '', exitCode: 0, failed: false, timedOut: false });
  });

  it('turns a thrown non-error into a message', () => {
    expect(serializeError('boom')).toEqual({ name: 'Error', message: 'boom' });
  });

  it('revives an error callers can read like execa\'s', () => {
    const data: SerializedError = { name: 'ExecaError', message: 'failed', stderr: 'fatal: x', exitCode: 1, timedOut: true, code: 'ETIMEDOUT' };
    const error = reviveError(data) as Error & SerializedError;
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'ExecaError', message: 'failed', stderr: 'fatal: x', exitCode: 1, timedOut: true, code: 'ETIMEDOUT' });
  });
});

describe('message checks', () => {
  it('accepts a request and rejects anything else', () => {
    expect(isHostRequest({ id: 1, file: 'git', args: ['status'] })).toBe(true);
    expect(isHostRequest({ id: 1, file: 'git', args: ['status'], options: { cwd: '/r' } })).toBe(true);
    expect(isHostRequest({ id: 1, file: 'git', args: [1] })).toBe(false);
    expect(isHostRequest({ id: '1', file: 'git', args: [] })).toBe(false);
    expect(isHostRequest({ id: 1, file: 'git', args: [], options: null })).toBe(false);
    expect(isHostRequest(null)).toBe(false);
  });

  it('accepts a reply and rejects anything else', () => {
    const ok: HostReply = { id: 1, ok: true, result: { stdout: '', stderr: '', failed: false, timedOut: false }, launchMs: 1 };
    const failed: HostReply = { id: 1, ok: false, error: { name: 'Error', message: 'x' }, launchMs: 1 };
    expect(isHostReply(ok)).toBe(true);
    expect(isHostReply(failed)).toBe(true);
    expect(isHostReply({ id: 1, ok: true, launchMs: 1 })).toBe(false);
    expect(isHostReply({ id: 1, ok: false, error: { name: 'Error', message: 'x' } })).toBe(false);
    expect(isHostReply('grove-process-host-ready')).toBe(false);
  });
});
