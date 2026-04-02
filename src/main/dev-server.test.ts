import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const mockSpawn = vi.hoisted(() => vi.fn());
const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
  execFile: mockExecFile,
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { DevServer } from './dev-server.js';

/** Create a fake ChildProcess with stdout/stderr emitters. */
function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    exitCode: number | null;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.pid = 1234;
  proc.exitCode = null;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DevServer', () => {
  describe('constructor and properties', () => {
    it('isRunning is false before start', () => {
      const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
      expect(server.isRunning).toBe(false);
    });

    it('ports is empty before start', () => {
      const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
      expect(server.ports.size).toBe(0);
    });
  });

  describe('start()', () => {
    it('rejects commands with shell metacharacters', () => {
      const server = new DevServer('s1', '/cwd', 'npm run dev; rm -rf /', vi.fn());
      expect(() => server.start()).toThrow('invalid characters');
    });

    it('rejects commands with pipes', () => {
      const server = new DevServer('s1', '/cwd', 'npm run dev | cat', vi.fn());
      expect(() => server.start()).toThrow('invalid characters');
    });

    it('accepts valid commands', () => {
      const proc = makeFakeProc();
      mockSpawn.mockReturnValue(proc);

      const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
      server.start(); // should not throw
      expect(mockSpawn).toHaveBeenCalledWith('npm run dev', [], expect.objectContaining({
        cwd: '/cwd',
        shell: true,
      }));
    });

    it('resolves with port info when URL is detected in stdout', async () => {
      const proc = makeFakeProc();
      mockSpawn.mockReturnValue(proc);

      const onDetected = vi.fn();
      const server = new DevServer('s1', '/cwd', 'npm run dev', onDetected);
      const promise = server.start();

      proc.stdout.emit('data', Buffer.from('Server running at http://localhost:3000\n'));

      const result = await promise;
      expect(result).toEqual({ port: 3000, url: 'http://localhost:3000' });
      expect(onDetected).toHaveBeenCalledWith({ port: 3000, url: 'http://localhost:3000' });
      expect(server.ports.has(3000)).toBe(true);
    });

    it('resolves with port info when URL is detected in stderr', async () => {
      const proc = makeFakeProc();
      mockSpawn.mockReturnValue(proc);

      const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
      const promise = server.start();

      proc.stderr.emit('data', Buffer.from('http://127.0.0.1:5173/\n'));

      const result = await promise;
      expect(result).toEqual({ port: 5173, url: 'http://localhost:5173' });
    });

    it('does not duplicate port detection for same port', async () => {
      const proc = makeFakeProc();
      mockSpawn.mockReturnValue(proc);

      const onDetected = vi.fn();
      const server = new DevServer('s1', '/cwd', 'npm run dev', onDetected);
      const promise = server.start();

      proc.stdout.emit('data', Buffer.from('http://localhost:3000\n'));
      proc.stdout.emit('data', Buffer.from('http://localhost:3000\n'));

      await promise;
      expect(onDetected).toHaveBeenCalledTimes(1);
    });

    it('resolves with failure when process exits before URL detection', async () => {
      const proc = makeFakeProc();
      mockSpawn.mockReturnValue(proc);

      const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
      const promise = server.start();

      proc.exitCode = 1;
      proc.emit('exit', 1);

      const result = await promise;
      expect(result).toMatchObject({ reason: 'exited', exitCode: 1 });
    });

    it('resolves with failure on process error', async () => {
      const proc = makeFakeProc();
      mockSpawn.mockReturnValue(proc);

      const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
      const promise = server.start();

      proc.emit('error', new Error('ENOENT'));

      const result = await promise;
      expect(result).toMatchObject({ reason: 'error', errorMessage: 'ENOENT' });
    });

    it('resolves with timeout when no URL detected within timeout', async () => {
      const proc = makeFakeProc();
      mockSpawn.mockReturnValue(proc);

      const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
      const promise = server.start();

      vi.advanceTimersByTime(30_000);

      const result = await promise;
      expect(result).toMatchObject({ reason: 'timeout' });
    });

    it('captures recent output lines', async () => {
      const proc = makeFakeProc();
      mockSpawn.mockReturnValue(proc);

      const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
      const promise = server.start();

      proc.stdout.emit('data', Buffer.from('Building...\nCompiling...\n'));
      proc.exitCode = 0;
      proc.emit('exit', 0);

      const result = await promise;
      expect((result as any).lastOutput).toContain('Building...');
    });

    it('strips ANSI codes from output', async () => {
      const proc = makeFakeProc();
      mockSpawn.mockReturnValue(proc);

      const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
      const promise = server.start();

      proc.stdout.emit('data', Buffer.from('\x1b[32mhttp://localhost:4000\x1b[0m\n'));

      const result = await promise;
      expect(result).toEqual({ port: 4000, url: 'http://localhost:4000' });
    });

    it('isRunning is true while process is running', () => {
      const proc = makeFakeProc();
      mockSpawn.mockReturnValue(proc);

      const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
      server.start();
      expect(server.isRunning).toBe(true);
    });
  });

  describe('stop()', () => {
    it('resolves immediately when no process is running', async () => {
      const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
      await expect(server.stop()).resolves.toBeUndefined();
    });

    it('kills the process on unix', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      try {
        const proc = makeFakeProc();
        mockSpawn.mockReturnValue(proc);

        const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
        server.start();

        const stopPromise = server.stop();
        // Simulate process exit
        proc.emit('exit', 0);

        await stopPromise;
        expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });

    it('uses taskkill on win32', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      try {
        const proc = makeFakeProc();
        mockSpawn.mockReturnValue(proc);

        const server = new DevServer('s1', '/cwd', 'npm run dev', vi.fn());
        server.start();

        const stopPromise = server.stop();
        // Simulate taskkill callback
        const taskkillCb = mockExecFile.mock.calls[0]?.[2];
        if (taskkillCb) taskkillCb(null, '', '');
        // Simulate timeout finish
        vi.advanceTimersByTime(3000);

        await stopPromise;
        expect(mockExecFile).toHaveBeenCalledWith(
          'taskkill',
          ['/F', '/T', '/PID', '1234'],
          expect.any(Function),
        );
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });
  });
});
