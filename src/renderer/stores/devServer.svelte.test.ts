import { describe, it, expect, beforeEach } from 'vitest';
import { devServerStore } from './devServer.svelte.js';

const SID = 'test-session';

beforeEach(() => {
  devServerStore.serversBySession = {};
});

describe('devServerStore', () => {
  it('returns an empty array for unknown sessions', () => {
    expect(devServerStore.get('unknown')).toEqual([]);
  });

  it('adds a detected server', () => {
    devServerStore.add(SID, 3000, 'http://localhost:3000');
    expect(devServerStore.get(SID)).toEqual([{ port: 3000, url: 'http://localhost:3000', status: 'ok' }]);
  });

  it('does not duplicate the same port', () => {
    devServerStore.add(SID, 3000, 'http://localhost:3000');
    devServerStore.add(SID, 3000, 'http://localhost:3000');
    expect(devServerStore.get(SID)).toHaveLength(1);
  });

  it('keeps distinct ports', () => {
    devServerStore.add(SID, 3000, 'http://localhost:3000');
    devServerStore.add(SID, 5173, 'http://localhost:5173');
    expect(devServerStore.get(SID).map((s) => s.port)).toEqual([3000, 5173]);
  });

  it('removes a server by port', () => {
    devServerStore.add(SID, 3000, 'http://localhost:3000');
    devServerStore.add(SID, 5173, 'http://localhost:5173');
    devServerStore.remove(SID, 3000);
    expect(devServerStore.get(SID).map((s) => s.port)).toEqual([5173]);
  });

  it('destroy clears all servers for a session', () => {
    devServerStore.add(SID, 3000, 'http://localhost:3000');
    devServerStore.destroy(SID);
    expect(devServerStore.get(SID)).toEqual([]);
    expect(devServerStore.serversBySession[SID]).toBeUndefined();
  });
});
