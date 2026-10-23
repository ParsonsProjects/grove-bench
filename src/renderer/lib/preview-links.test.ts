import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openLink, opensInPreview } from './preview-links.js';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { previewStore } from '../stores/preview.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';

describe('openLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.activeSessionId = 's1';
    messageStore.setActiveTab('s1', 'activity');
    previewStore.forget('s1');
  });

  it("opens a local link in the conversation's Preview tab", async () => {
    openLink('http://0.0.0.0:5173/');
    expect(messageStore.getActiveTab('s1')).toBe('preview');
    expect(previewStore.getMode('s1')).toBe('user');
    expect(mockGroveBench.previewNavigate).toHaveBeenCalledWith('s1', 'user', 'http://localhost:5173/');
    expect(mockGroveBench.openExternal).not.toHaveBeenCalled();
  });

  it('opens in the system browser with Ctrl or Cmd held', () => {
    openLink('http://localhost:5173/', { ctrlKey: true });
    openLink('http://localhost:5173/', { metaKey: true });
    expect(mockGroveBench.openExternal).toHaveBeenCalledTimes(2);
    expect(mockGroveBench.previewNavigate).not.toHaveBeenCalled();
    expect(messageStore.getActiveTab('s1')).toBe('activity');
  });

  it('opens other sites in the system browser', () => {
    openLink('https://example.com/docs');
    expect(mockGroveBench.openExternal).toHaveBeenCalledWith('https://example.com/docs');
    expect(mockGroveBench.previewNavigate).not.toHaveBeenCalled();
  });

  it('opens in the system browser when no conversation is open', () => {
    store.activeSessionId = null;
    expect(opensInPreview('http://localhost:3000/')).toBe(false);
    openLink('http://localhost:3000/');
    expect(mockGroveBench.openExternal).toHaveBeenCalledWith('http://localhost:3000/');
  });

  it('falls back to the system browser when the preview refuses', async () => {
    mockGroveBench.previewNavigate.mockRejectedValueOnce(new Error("worktree isn't ready"));
    openLink('http://localhost:3000/');
    await vi.waitFor(() => expect(mockGroveBench.openExternal).toHaveBeenCalledWith('http://localhost:3000/'));
  });
});
