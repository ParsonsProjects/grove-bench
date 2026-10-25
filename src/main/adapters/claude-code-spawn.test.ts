import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HostedProcess } from '../process-host-spawn.js';

const hosted = vi.hoisted(() => ({ spawnProcess: vi.fn() }));
vi.mock('../process-host.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawnProcess: hosted.spawnProcess,
}));
vi.mock('../credentials.js', () => ({ getApiKey: vi.fn(() => null) }));
vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { query, type SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { asarUnpackedPath, claudeProcessExe, spawnClaudeCodeProcess } from './claude-code.js';
import { windowsExeName } from '../process-memory.js';

const opts = (command: string, signal = new AbortController().signal) => ({ command, args: ['--x'], cwd: '/w', env: { A: '1' }, signal });

beforeEach(() => {
  hosted.spawnProcess.mockReset();
  hosted.spawnProcess.mockImplementation((file: string) => new HostedProcess(file));
});

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

describe('claudeProcessExe', () => {
  it('names the executable as Windows lists the process, for the health line to check its process list against', () => {
    expect(claudeProcessExe('C:\\Apps\\Grove Bench\\resources\\app.asar\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\Claude.exe')).toBe('claude.exe');
    expect(claudeProcessExe('/repo/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude')).toBe('claude.exe');
    // Started from claude-2.1.0.exe, and listed so: the dot doesn't make it an extension.
    expect(claudeProcessExe('C:\\tools\\claude-2.1.0')).toBe('claude-2.1.0.exe');
    // A node command runs as Electron, named by the same rule as the app's own process.
    expect(claudeProcessExe('node')).toBe(windowsExeName(process.execPath));
    expect(claudeProcessExe('C:\\Program Files\\nodejs\\node.exe')).toBe(windowsExeName(process.execPath));
  });
});

describe('spawnClaudeCodeProcess', () => {
  it('starts the SDK binary in the agent host, from app.asar.unpacked in a packaged app', () => {
    spawnClaudeCodeProcess(opts('/opt/grove/resources/app.asar/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude'));
    expect(hosted.spawnProcess).toHaveBeenCalledWith(
      '/opt/grove/resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
      ['--x'],
      { cwd: '/w', env: { A: '1' } },
    );
  });

  it('runs a node command with Electron as Node', () => {
    spawnClaudeCodeProcess(opts('node'));
    expect(hosted.spawnProcess).toHaveBeenCalledWith(process.execPath, ['--x'], { cwd: '/w', env: { A: '1', ELECTRON_RUN_AS_NODE: '1' } });
  });

  it('stops the process when the SDK aborts, as spawn()\'s signal option did', () => {
    const controller = new AbortController();
    const child = spawnClaudeCodeProcess(opts('claude', controller.signal));
    const kill = vi.spyOn(child, 'kill');
    controller.abort();
    expect(kill).toHaveBeenCalledTimes(1);

    const aborted = new AbortController();
    aborted.abort();
    expect(spawnClaudeCodeProcess(opts('claude', aborted.signal)).killed).toBe(true);
  });

  it('stops listening for the abort once the process has exited', () => {
    const controller = new AbortController();
    const child = spawnClaudeCodeProcess(opts('claude', controller.signal));
    const kill = vi.spyOn(child, 'kill');
    child.receive({ type: 'exit', id: 1, code: 0, signal: null });
    controller.abort();
    expect(kill).not.toHaveBeenCalled();
  });

  it('passes stderr to the callback', async () => {
    const lines: string[] = [];
    const child = spawnClaudeCodeProcess(opts('claude'), (d) => lines.push(d));
    child.receive({ type: 'stderr', id: 1, data: 'Warning: x\n' });
    await new Promise((r) => setImmediate(r));
    expect(lines).toEqual(['Warning: x\n']);
  });
});

describe('the agent SDK', () => {
  // ClaudeCodeAdapter's processStarted() waits on the process the spawn hook
  // made. Were the SDK to start it later (as it does for a resume with a
  // sessionStore), start() would return with none, a close straight after
  // would find nothing to wait for, and the agent's tree would not be killed.
  it('starts the agent process inside query(), through the spawn hook', () => {
    const proc = new HostedProcess('claude.exe');
    proc.connect(() => {});
    const spawn = vi.fn((_options: SpawnOptions) => proc);

    const q = query({
      prompt: (async function* () { /* no prompt */ })(),
      options: { cwd: process.cwd(), pathToClaudeCodeExecutable: process.execPath, spawnClaudeCodeProcess: spawn },
    });
    try {
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      q.close();
    }
  });
});
