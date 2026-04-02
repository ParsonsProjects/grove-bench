import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { gitStatusStore } from './gitStatus.svelte.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  gitStatusStore.statusBySession = {};
  gitStatusStore.loadingBySession = {};
  gitStatusStore.suppressRefresh = false;
  // Clear internal maps by calling clear for known sessions
  for (const id of ['s1', 's2']) {
    gitStatusStore.clear(id);
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GitStatusStore', () => {
  describe('getStatus()', () => {
    it('returns empty entries for unknown session', () => {
      expect(gitStatusStore.getStatus('unknown')).toEqual({ entries: [] });
    });

    it('returns stored status', () => {
      const status = { entries: [{ path: 'file.ts', status: 'M' }] };
      gitStatusStore.statusBySession = { s1: status as any };
      expect(gitStatusStore.getStatus('s1')).toEqual(status);
    });
  });

  describe('isLoading()', () => {
    it('returns false for unknown session', () => {
      expect(gitStatusStore.isLoading('unknown')).toBe(false);
    });

    it('returns true when loading', () => {
      gitStatusStore.loadingBySession = { s1: true };
      expect(gitStatusStore.isLoading('s1')).toBe(true);
    });
  });

  describe('refresh()', () => {
    it('fetches git status and updates store', async () => {
      const result = { entries: [{ path: 'a.ts', status: 'M' }] };
      mockGroveBench.getGitStatus.mockResolvedValue(result);

      await gitStatusStore.refresh('s1');

      expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('s1');
      expect(gitStatusStore.getStatus('s1')).toEqual(result);
      expect(gitStatusStore.isLoading('s1')).toBe(false);
    });

    it('does nothing when suppressRefresh is true', async () => {
      gitStatusStore.suppressRefresh = true;

      await gitStatusStore.refresh('s1');

      expect(mockGroveBench.getGitStatus).not.toHaveBeenCalled();
    });

    it('throttles calls within 500ms', async () => {
      mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });

      await gitStatusStore.refresh('s1');
      await gitStatusStore.refresh('s1'); // should be throttled

      expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(1);
    });

    it('allows calls after throttle window', async () => {
      mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });

      await gitStatusStore.refresh('s1');
      vi.advanceTimersByTime(501);
      await gitStatusStore.refresh('s1');

      expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(2);
    });

    it('handles errors gracefully', async () => {
      mockGroveBench.getGitStatus.mockRejectedValue(new Error('git error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await gitStatusStore.refresh('s1');

      expect(gitStatusStore.isLoading('s1')).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('scheduleRefresh()', () => {
    it('debounces and calls refresh after delay', async () => {
      mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });

      gitStatusStore.scheduleRefresh('s1', 300);

      expect(mockGroveBench.getGitStatus).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      // Allow the microtask from refresh() to complete
      await vi.runAllTimersAsync();

      expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('s1');
    });

    it('cancels previous scheduled refresh', async () => {
      mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });

      gitStatusStore.scheduleRefresh('s1', 300);
      gitStatusStore.scheduleRefresh('s1', 300);

      vi.advanceTimersByTime(300);
      await vi.runAllTimersAsync();

      // Only one call despite two schedules
      expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(1);
    });

    it('does nothing when suppressRefresh is true', () => {
      gitStatusStore.suppressRefresh = true;

      gitStatusStore.scheduleRefresh('s1', 300);
      vi.advanceTimersByTime(300);

      expect(mockGroveBench.getGitStatus).not.toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    it('removes status and loading for a session', () => {
      gitStatusStore.statusBySession = { s1: { entries: [] }, s2: { entries: [] } };
      gitStatusStore.loadingBySession = { s1: true, s2: false };

      gitStatusStore.clear('s1');

      expect(gitStatusStore.statusBySession).toEqual({ s2: { entries: [] } });
      expect(gitStatusStore.loadingBySession).toEqual({ s2: false });
    });

    it('cancels pending scheduled refresh', async () => {
      mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });

      gitStatusStore.scheduleRefresh('s1', 300);
      gitStatusStore.clear('s1');
      vi.advanceTimersByTime(300);

      expect(mockGroveBench.getGitStatus).not.toHaveBeenCalled();
    });
  });
});
