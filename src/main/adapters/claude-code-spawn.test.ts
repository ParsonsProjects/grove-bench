import { describe, it, expect, vi, beforeEach } from 'vitest';

const spawnMock = vi.fn(() => ({ stderr: null }));
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: (...args: unknown[]) => spawnMock(...(args as [])),
}));
vi.mock('../credentials.js', () => ({ getApiKey: vi.fn(() => null) }));
vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { asarUnpackedPath, spawnClaudeCodeProcess } from './claude-code.js';

const opts = (command: string) => ({ command, args: ['--x'], cwd: '/w', env: { A: '1' }, signal: new AbortController().signal });

beforeEach(() => spawnMock.mockClear());

describe('asarUnpackedPath', () => {
  it('points a file inside app.asar at app.asar.unpacked', () => {
    expect(asarUnpackedPath('C:\\Apps\\Grove Bench\\resources\\app.asar\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe'))
      .toBe('C:\\Apps\\Grove Bench\\resources\\app.asar.unpacked\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe');
    expect(asarUnpackedPath('/opt/grove/resources/app.asar/node_modules/x/claude'))
      .toBe('/opt/grove/resources/app.asar.unpacked/node_modules/x/claude');
  });

  it('leaves other paths alone, including ones already unpacked', () => {
    expect(asarUnpackedPath('/repo/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude')).toBe('/repo/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude');
    expect(asarUnpackedPath('/r/app.asar.unpacked/claude')).toBe('/r/app.asar.unpacked/claude');
    expect(asarUnpackedPath('/r/my-app.asar-files/claude')).toBe('/r/my-app.asar-files/claude');
  });
});

describe('spawnClaudeCodeProcess', () => {
  it('runs the SDK binary from app.asar.unpacked in a packaged app', () => {
    spawnClaudeCodeProcess(opts('/opt/grove/resources/app.asar/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude'));
    expect(spawnMock).toHaveBeenCalledWith(
      '/opt/grove/resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
      ['--x'],
      expect.objectContaining({ cwd: '/w', env: { A: '1' } }),
    );
  });

  it('runs a node command with Electron as Node', () => {
    spawnClaudeCodeProcess(opts('node'));
    expect(spawnMock).toHaveBeenCalledWith(process.execPath, ['--x'], expect.objectContaining({ env: { A: '1', ELECTRON_RUN_AS_NODE: '1' } }));
  });
});
