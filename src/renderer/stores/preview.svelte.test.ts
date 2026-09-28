import { describe, it, expect, beforeEach, vi } from 'vitest';
import { previewStore } from './preview.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';
import type { PreviewPageState } from '../../shared/types.js';

const page = (over: Partial<PreviewPageState> = {}): PreviewPageState => ({
  url: 'http://localhost:5173/', title: '', loading: false, canGoBack: false, canGoForward: false, error: null, crashed: false, ...over,
});

describe('previewStore', () => {
  beforeEach(() => {
    previewStore.forget('s1');
    vi.clearAllMocks();
  });

  describe('page state', () => {
    it('stores each page and clears it on null', () => {
      previewStore.applyState('s1', 'user', page({ title: 'App' }));
      expect(previewStore.getUser('s1')?.title).toBe('App');
      previewStore.applyState('s1', 'user', null);
      expect(previewStore.getUser('s1')).toBeNull();
    });

    it("switches to Claude's page the first time it acts while yours is empty", () => {
      expect(previewStore.getMode('s1')).toBe('user');
      previewStore.applyState('s1', 'agent', page({ lastAction: { text: 'Opened', at: 1 } }));
      expect(previewStore.getMode('s1')).toBe('agent');
      expect(previewStore.hasUnseenAgentActivity('s1')).toBe(true);
    });

    it("stays on your page when it has something open", () => {
      previewStore.applyState('s1', 'user', page());
      previewStore.applyState('s1', 'agent', page({ lastAction: { text: 'Opened', at: 1 } }));
      expect(previewStore.getMode('s1')).toBe('user');
      expect(previewStore.hasUnseenAgentActivity('s1')).toBe(true);
    });

    it('does not flag activity while the user is watching, and clears it when they look', () => {
      previewStore.applyState('s1', 'agent', page({ lastAction: { text: 'Opened', at: 1 } }));
      previewStore.setWatchingAgent('s1', true);
      expect(previewStore.hasUnseenAgentActivity('s1')).toBe(false);
      previewStore.applyState('s1', 'agent', page({ lastAction: { text: 'Clicked', at: 2 } }));
      expect(previewStore.hasUnseenAgentActivity('s1')).toBe(false);
      previewStore.setWatchingAgent('s1', false);
      previewStore.applyState('s1', 'agent', page({ lastAction: { text: 'Typed', at: 3 } }));
      expect(previewStore.hasUnseenAgentActivity('s1')).toBe(true);
    });

    it('ignores agent state updates that are not new actions', () => {
      previewStore.applyState('s1', 'agent', page({ lastAction: null }));
      previewStore.applyState('s1', 'agent', page({ loading: true, lastAction: null }));
      expect(previewStore.hasUnseenAgentActivity('s1')).toBe(false);
      expect(previewStore.getMode('s1')).toBe('user');
    });
  });

  describe('spotting local URLs', () => {
    it('keeps local URLs from tool output, newest last, without duplicates', () => {
      previewStore.noteText('s1', 'VITE ready\n  ➜  Local:   http://localhost:5173/\n');
      previewStore.noteText('s1', 'also http://localhost:5173/ and http://127.0.0.1:8080/api');
      expect(previewStore.getDetected('s1')).toEqual(['http://localhost:5173/', 'http://127.0.0.1:8080/api']);
    });

    it('ignores output without local URLs', () => {
      previewStore.noteText('s1', 'see https://example.com');
      expect(previewStore.getDetected('s1')).toEqual([]);
    });

    it('finds a URL split across terminal chunks', () => {
      previewStore.noteStream('s1', 'Local: http://local');
      previewStore.noteStream('s1', 'host:3000/\r\n');
      expect(previewStore.getDetected('s1')).toContain('http://localhost:3000/');
    });

    it('keeps only the newest few', () => {
      for (let port = 3000; port < 3010; port++) previewStore.noteText('s1', `http://localhost:${port}/`);
      const detected = previewStore.getDetected('s1');
      expect(detected).toHaveLength(6);
      expect(detected.at(-1)).toBe('http://localhost:3009/');
    });
  });

  describe('keys from the page', () => {
    it('hands Ctrl+L to the panel that registered for it', () => {
      const focus = vi.fn();
      const off = previewStore.onFocusAddress('s1', focus);
      (previewStore as unknown as { handleKey: (id: string, k: unknown) => void }).handleKey('s1', { action: 'focusAddress' });
      expect(focus).toHaveBeenCalledTimes(1);
      off();
      (previewStore as unknown as { handleKey: (id: string, k: unknown) => void }).handleKey('s1', { action: 'focusAddress' });
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it("replays Grove's shortcuts as a window keydown", () => {
      const seen: KeyboardEvent[] = [];
      const listener = (e: KeyboardEvent) => seen.push(e);
      window.addEventListener('keydown', listener);
      (previewStore as unknown as { handleKey: (id: string, k: unknown) => void }).handleKey('s1', {
        action: 'key', key: '1', ctrlKey: false, shiftKey: false, altKey: true, metaKey: false,
      });
      window.removeEventListener('keydown', listener);
      expect(seen).toHaveLength(1);
      expect(seen[0].key).toBe('1');
      expect(seen[0].altKey).toBe(true);
    });
  });

  it('navigates through the bridge', async () => {
    await previewStore.navigate('s1', 'agent', 'localhost:3000');
    expect(mockGroveBench.previewNavigate).toHaveBeenCalledWith('s1', 'agent', 'localhost:3000');
  });
});
