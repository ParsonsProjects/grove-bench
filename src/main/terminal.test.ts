import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebContents } from 'electron';

// Track per-PTY callbacks so tests can trigger them on specific instances
interface MockPty {
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  _onDataCb: ((data: string) => void) | null;
  _onExitCb: ((e: { exitCode: number; signal?: number }) => void) | null;
}

/** All PTY instances created in order. */
const spawnedPtys: MockPty[] = [];

function makeMockPty(): MockPty {
  const p: MockPty = {
    _onDataCb: null,
    _onExitCb: null,
    onData: vi.fn((cb: (data: string) => void) => { p._onDataCb = cb; }),
    onExit: vi.fn((cb: (e: { exitCode: number; signal?: number }) => void) => { p._onExitCb = cb; }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
  spawnedPtys.push(p);
  return p;
}

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => makeMockPty()),
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { TerminalManager } from './terminal.js';
import * as pty from 'node-pty';

function makeSender(): WebContents {
  return { send: vi.fn(), isDestroyed: vi.fn(() => false) } as unknown as WebContents;
}

/** Helper: get the Nth spawned PTY (0-indexed). */
function ptyAt(n: number): MockPty {
  return spawnedPtys[n];
}

describe('TerminalManager', () => {
  let tm: TerminalManager;
  let sender: WebContents;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    spawnedPtys.length = 0;
    tm = new TerminalManager();
    sender = makeSender();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('spawn and kill basics', () => {
    it('spawns a PTY and marks session alive', () => {
      const ok = tm.spawnPty('s1', '/tmp', sender);
      expect(ok).toBe(true);
      expect(tm.isAlive('s1')).toBe(true);
      expect(pty.spawn).toHaveBeenCalledOnce();
    });

    it('returns false and marks dead when pty.spawn throws', () => {
      vi.mocked(pty.spawn).mockImplementationOnce(() => { throw new Error('fail'); });
      const ok = tm.spawnPty('s1', '/tmp', sender);
      expect(ok).toBe(false);
      expect(tm.isAlive('s1')).toBe(false);
    });

    it('kill removes session from map', () => {
      tm.spawnPty('s1', '/tmp', sender);
      tm.killPty('s1');
      expect(tm.isAlive('s1')).toBe(false);
      expect(ptyAt(0).kill).toHaveBeenCalledOnce();
    });

    it('kill on non-existent session is a no-op', () => {
      tm.killPty('nope');
      // No PTY was spawned, nothing to call kill on
      expect(spawnedPtys).toHaveLength(0);
    });

    it('killAll kills all sessions', async () => {
      tm.spawnPty('s1', '/tmp', sender);
      tm.spawnPty('s2', '/tmp', sender);
      await tm.killAll();
      expect(tm.isAlive('s1')).toBe(false);
      expect(tm.isAlive('s2')).toBe(false);
      expect(ptyAt(0).kill).toHaveBeenCalled();
      expect(ptyAt(1).kill).toHaveBeenCalled();
    });
  });

  describe('write and resize', () => {
    it('write forwards to pty', () => {
      tm.spawnPty('s1', '/tmp', sender);
      tm.write('s1', 'hello');
      expect(ptyAt(0).write).toHaveBeenCalledWith('hello');
    });

    it('write to non-existent session is a no-op', () => {
      tm.write('nope', 'hello');
      expect(spawnedPtys).toHaveLength(0);
    });

    it('resize forwards to pty', () => {
      tm.spawnPty('s1', '/tmp', sender);
      tm.resize('s1', 120, 40);
      expect(ptyAt(0).resize).toHaveBeenCalledWith(120, 40);
    });
  });

  describe('data buffering and flush', () => {
    it('buffers data and flushes after 8ms', () => {
      tm.spawnPty('s1', '/tmp', sender);
      const p = ptyAt(0);
      p._onDataCb!('chunk1');
      p._onDataCb!('chunk2');

      // Not sent yet
      expect(sender.send as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();

      // Advance past the 8ms flush timer
      vi.advanceTimersByTime(10);

      expect(sender.send as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'pty:data:s1',
        'chunk1chunk2',
      );
    });
  });

  describe('onExit sends exit event for active PTY', () => {
    it('sends exit event and removes session', () => {
      tm.spawnPty('s1', '/tmp', sender);
      expect(tm.isAlive('s1')).toBe(true);

      ptyAt(0)._onExitCb!({ exitCode: 0, signal: undefined });

      expect(tm.isAlive('s1')).toBe(false);
      expect(sender.send as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'pty:exit:s1',
        0,
        undefined,
      );
    });
  });

  describe('stale PTY guards (restart scenario)', () => {
    it('killPty removes session before calling kill so sync onExit is guarded', () => {
      tm.spawnPty('s1', '/tmp', sender);
      const p = ptyAt(0);

      // Simulate onExit firing synchronously during kill() (Windows behavior)
      p.kill.mockImplementationOnce(() => {
        p._onExitCb!({ exitCode: -1073741510, signal: undefined });
      });

      const sendBefore = (sender.send as ReturnType<typeof vi.fn>).mock.calls.length;
      tm.killPty('s1');

      // The exit event should NOT have been sent (session was removed before kill)
      const exitCalls = (sender.send as ReturnType<typeof vi.fn>).mock.calls
        .slice(sendBefore)
        .filter((c: unknown[]) => c[0] === 'pty:exit:s1');
      expect(exitCalls).toHaveLength(0);
      expect(tm.isAlive('s1')).toBe(false);
    });

    it('old PTY onExit after kill+spawn does not delete new session', () => {
      tm.spawnPty('s1', '/tmp', sender);
      const oldPty = ptyAt(0);

      // Kill and spawn new PTY (simulates restart flow: kill + spawn)
      tm.killPty('s1');
      tm.spawnPty('s1', '/tmp', sender);
      expect(tm.isAlive('s1')).toBe(true);
      expect(spawnedPtys).toHaveLength(2);

      // Old PTY's onExit fires asynchronously
      oldPty._onExitCb!({ exitCode: -1073741510, signal: undefined });

      // New session should still be alive
      expect(tm.isAlive('s1')).toBe(true);

      // No exit event should have been sent for the stale PTY
      const exitCalls = (sender.send as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === 'pty:exit:s1');
      expect(exitCalls).toHaveLength(0);
    });

    it('old PTY flush timer does not send data after new PTY replaces it', () => {
      tm.spawnPty('s1', '/tmp', sender);
      const oldPty = ptyAt(0);

      // Old PTY buffers some data
      oldPty._onDataCb!('stale-data');

      // Kill and spawn new PTY before flush fires
      tm.killPty('s1');
      tm.spawnPty('s1', '/tmp', sender);

      // Advance past the 8ms flush timer of the old PTY
      vi.advanceTimersByTime(10);

      // The stale data should NOT have been sent
      const dataCalls = (sender.send as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === 'pty:data:s1' && c[1] === 'stale-data');
      expect(dataCalls).toHaveLength(0);
    });

    it('old PTY onExit does not flush stale buffer after replacement', () => {
      tm.spawnPty('s1', '/tmp', sender);
      const oldPty = ptyAt(0);

      // Old PTY buffers data
      oldPty._onDataCb!('stale-buffered');

      // Kill and spawn new PTY
      tm.killPty('s1');
      tm.spawnPty('s1', '/tmp', sender);

      // Old PTY exits
      oldPty._onExitCb!({ exitCode: 0, signal: undefined });

      // Stale buffer should not have been sent
      const dataCalls = (sender.send as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === 'pty:data:s1' && c[1] === 'stale-buffered');
      expect(dataCalls).toHaveLength(0);
    });
  });

  describe('spawnPty kills existing PTY for same session', () => {
    it('auto-kills existing session before spawning new one', () => {
      tm.spawnPty('s1', '/tmp', sender);
      expect(tm.isAlive('s1')).toBe(true);

      // Spawn again with same sessionId
      tm.spawnPty('s1', '/other', sender);
      expect(tm.isAlive('s1')).toBe(true);
      expect(ptyAt(0).kill).toHaveBeenCalledOnce();
      expect(spawnedPtys).toHaveLength(2);
    });
  });
});
