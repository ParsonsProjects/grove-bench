import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { terminalStore } from './terminal.svelte.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset store state
  terminalStore.aliveBySession = {};
  // Unsubscribe any leftover sessions
  for (const id of ['s1', 's2', 'test-session']) {
    terminalStore.unsubscribe(id);
  }
});

describe('TerminalStore', () => {
  describe('isAlive()', () => {
    it('returns false for unknown session', () => {
      expect(terminalStore.isAlive('unknown')).toBe(false);
    });

    it('returns true when session is marked alive', () => {
      terminalStore.aliveBySession['s1'] = true;
      expect(terminalStore.isAlive('s1')).toBe(true);
    });

    it('returns false when session is marked dead', () => {
      terminalStore.aliveBySession['s1'] = false;
      expect(terminalStore.isAlive('s1')).toBe(false);
    });
  });

  describe('spawn()', () => {
    it('calls ptySpawn and sets alive to true on success', async () => {
      mockGroveBench.ptySpawn.mockResolvedValue(true);
      const result = await terminalStore.spawn('s1');
      expect(mockGroveBench.ptySpawn).toHaveBeenCalledWith('s1');
      expect(result).toBe(true);
      expect(terminalStore.aliveBySession['s1']).toBe(true);
    });

    it('sets alive to false when spawn fails', async () => {
      mockGroveBench.ptySpawn.mockResolvedValue(false);
      const result = await terminalStore.spawn('s1');
      expect(result).toBe(false);
      expect(terminalStore.aliveBySession['s1']).toBe(false);
    });
  });

  describe('write()', () => {
    it('delegates to ptyWrite', () => {
      terminalStore.write('s1', 'ls\n');
      expect(mockGroveBench.ptyWrite).toHaveBeenCalledWith('s1', 'ls\n');
    });
  });

  describe('resize()', () => {
    it('delegates to ptyResize', () => {
      terminalStore.resize('s1', 80, 24);
      expect(mockGroveBench.ptyResize).toHaveBeenCalledWith('s1', 80, 24);
    });
  });

  describe('kill()', () => {
    it('calls ptyKill and marks session as dead', async () => {
      terminalStore.aliveBySession['s1'] = true;
      await terminalStore.kill('s1');
      expect(mockGroveBench.ptyKill).toHaveBeenCalledWith('s1');
      expect(terminalStore.aliveBySession['s1']).toBe(false);
    });
  });

  describe('restart()', () => {
    it('kills then spawns', async () => {
      mockGroveBench.ptySpawn.mockResolvedValue(true);
      const result = await terminalStore.restart('s1');
      expect(mockGroveBench.ptyKill).toHaveBeenCalledWith('s1');
      expect(mockGroveBench.ptySpawn).toHaveBeenCalledWith('s1');
      expect(result).toBe(true);
    });
  });

  describe('checkAlive()', () => {
    it('queries main process and updates state', async () => {
      mockGroveBench.ptyIsAlive.mockResolvedValue(true);
      const result = await terminalStore.checkAlive('s1');
      expect(result).toBe(true);
      expect(terminalStore.aliveBySession['s1']).toBe(true);
    });

    it('updates state to false when not alive', async () => {
      mockGroveBench.ptyIsAlive.mockResolvedValue(false);
      const result = await terminalStore.checkAlive('s1');
      expect(result).toBe(false);
      expect(terminalStore.aliveBySession['s1']).toBe(false);
    });
  });

  describe('subscribe() / unsubscribe()', () => {
    it('registers IPC listeners on subscribe', () => {
      terminalStore.subscribe('s1');
      expect(mockGroveBench.onPtyData).toHaveBeenCalledWith('s1', expect.any(Function));
      expect(mockGroveBench.onPtyExit).toHaveBeenCalledWith('s1', expect.any(Function));
    });

    it('does not re-subscribe if already subscribed', () => {
      terminalStore.subscribe('s1');
      terminalStore.subscribe('s1');
      expect(mockGroveBench.onPtyData).toHaveBeenCalledTimes(1);
    });

    it('calls cleanup functions on unsubscribe', () => {
      const dataCleanup = vi.fn();
      const exitCleanup = vi.fn();
      mockGroveBench.onPtyData.mockReturnValue(dataCleanup);
      mockGroveBench.onPtyExit.mockReturnValue(exitCleanup);

      terminalStore.subscribe('s1');
      terminalStore.unsubscribe('s1');

      expect(dataCleanup).toHaveBeenCalled();
      expect(exitCleanup).toHaveBeenCalled();
    });

    it('forwards PTY data to registered handler', () => {
      let capturedCallback: (data: string) => void;
      mockGroveBench.onPtyData.mockImplementation((_id: string, cb: (data: string) => void) => {
        capturedCallback = cb;
        return vi.fn();
      });

      const dataHandler = vi.fn();
      terminalStore.onData('s1', dataHandler);
      terminalStore.subscribe('s1');

      capturedCallback!('hello');
      expect(dataHandler).toHaveBeenCalledWith('hello');
    });

    it('marks session dead and calls exit handler on PTY exit', () => {
      let capturedExitCb: (exitCode: number, signal?: number) => void;
      mockGroveBench.onPtyExit.mockImplementation((_id: string, cb: (exitCode: number, signal?: number) => void) => {
        capturedExitCb = cb;
        return vi.fn();
      });

      terminalStore.aliveBySession['s1'] = true;
      const exitHandler = vi.fn();
      terminalStore.onExit('s1', exitHandler);
      terminalStore.subscribe('s1');

      capturedExitCb!(0, undefined);
      expect(terminalStore.aliveBySession['s1']).toBe(false);
      expect(exitHandler).toHaveBeenCalledWith(0, undefined);
    });
  });

  describe('onData() / onExit()', () => {
    it('registers data handler', () => {
      const handler = vi.fn();
      terminalStore.onData('s1', handler);
      // Handler is stored internally; tested via subscribe forwarding above
    });

    it('registers exit handler', () => {
      const handler = vi.fn();
      terminalStore.onExit('s1', handler);
    });
  });
});
