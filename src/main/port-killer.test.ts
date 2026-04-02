import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { killProcessOnPort } from './port-killer.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('killProcessOnPort()', () => {
  describe('on win32', () => {
    const originalPlatform = process.platform;
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });
    afterAll(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('resolves when netstat fails', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Function) => {
        cb(new Error('netstat failed'), '', '');
      });
      await expect(killProcessOnPort(3000)).resolves.toBeUndefined();
    });

    it('resolves when no matching LISTENING lines found', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Function) => {
        cb(null, '  TCP    0.0.0.0:5000    0.0.0.0:0    LISTENING    1234\n', '');
      });
      await expect(killProcessOnPort(3000)).resolves.toBeUndefined();
      // Should only call netstat, not taskkill
      expect(mockExecFile).toHaveBeenCalledTimes(1);
      expect(mockExecFile.mock.calls[0][0]).toBe('netstat');
    });

    it('kills matching PID with taskkill', async () => {
      mockExecFile.mockImplementation((cmd: string, args: string[], cb: Function) => {
        if (cmd === 'netstat') {
          const output = [
            '  Proto  Local Address          Foreign Address        State           PID',
            '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       5678',
          ].join('\n');
          cb(null, output, '');
        } else if (cmd === 'taskkill') {
          expect(args).toContain('5678');
          cb(null, '', '');
        }
      });
      await expect(killProcessOnPort(3000)).resolves.toBeUndefined();
      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });

    it('does not kill PID 0', async () => {
      mockExecFile.mockImplementation((cmd: string, _args: string[], cb: Function) => {
        if (cmd === 'netstat') {
          cb(null, '  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    0\n', '');
        }
      });
      await expect(killProcessOnPort(3000)).resolves.toBeUndefined();
      expect(mockExecFile).toHaveBeenCalledTimes(1); // only netstat
    });

    it('does not match port 30001 when looking for port 3000', async () => {
      mockExecFile.mockImplementation((cmd: string, _args: string[], cb: Function) => {
        if (cmd === 'netstat') {
          cb(null, '  TCP    0.0.0.0:30001    0.0.0.0:0    LISTENING    9999\n', '');
        }
      });
      await expect(killProcessOnPort(3000)).resolves.toBeUndefined();
      expect(mockExecFile).toHaveBeenCalledTimes(1); // only netstat
    });
  });

  describe('on unix', () => {
    const originalPlatform = process.platform;
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
    });
    afterAll(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('resolves when lsof fails', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Function) => {
        cb(new Error('lsof failed'), '', '');
      });
      await expect(killProcessOnPort(3000)).resolves.toBeUndefined();
    });

    it('resolves when no PIDs found', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Function) => {
        cb(null, '', '');
      });
      await expect(killProcessOnPort(3000)).resolves.toBeUndefined();
    });

    it('kills PIDs found by lsof', async () => {
      mockExecFile.mockImplementation((cmd: string, args: string[], cb: Function) => {
        if (cmd === 'lsof') {
          cb(null, '1234\n5678\n', '');
        } else if (cmd === 'kill') {
          expect(args).toEqual(['-9', '1234', '5678']);
          cb(null, '', '');
        }
      });
      await expect(killProcessOnPort(3000)).resolves.toBeUndefined();
      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });
  });
});
