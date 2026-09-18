import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app, nativeImage, type BrowserWindow } from 'electron';
import { applyAttentionBadge, badgeDescription } from './attention-badge.js';

function makeWin() {
  return { setOverlayIcon: vi.fn(), isDestroyed: vi.fn(() => false) } as unknown as BrowserWindow;
}

beforeEach(() => vi.clearAllMocks());

describe('badgeDescription', () => {
  it('pluralises and clears at zero', () => {
    expect(badgeDescription(0)).toBe('');
    expect(badgeDescription(1)).toBe('1 conversation needs attention');
    expect(badgeDescription(3)).toBe('3 conversations need attention');
  });
});

describe('applyAttentionBadge', () => {
  it('sets a Windows overlay from the renderer-drawn image', () => {
    const win = makeWin();
    applyAttentionBadge(win, 2, 'data:image/png;base64,AAA', 'win32');
    expect(nativeImage.createFromDataURL).toHaveBeenCalledWith('data:image/png;base64,AAA');
    expect(win.setOverlayIcon).toHaveBeenCalledWith(expect.anything(), '2 conversations need attention');
  });

  it('clears the Windows overlay at zero or without an image', () => {
    const win = makeWin();
    applyAttentionBadge(win, 0, 'data:image/png;base64,AAA', 'win32');
    applyAttentionBadge(win, 2, null, 'win32');
    expect(win.setOverlayIcon).toHaveBeenNthCalledWith(1, null, '');
    expect(win.setOverlayIcon).toHaveBeenNthCalledWith(2, null, '2 conversations need attention');
    expect(nativeImage.createFromDataURL).not.toHaveBeenCalled();
  });

  it('uses the dock badge on macOS and the badge count elsewhere', () => {
    const win = makeWin();
    applyAttentionBadge(win, 4, null, 'darwin');
    expect(app.dock!.setBadge).toHaveBeenCalledWith('4');
    applyAttentionBadge(win, 0, null, 'darwin');
    expect(app.dock!.setBadge).toHaveBeenLastCalledWith('');
    applyAttentionBadge(win, 5, null, 'linux');
    expect(app.setBadgeCount).toHaveBeenCalledWith(5);
    expect(win.setOverlayIcon).not.toHaveBeenCalled();
  });

  it('swallows native errors', () => {
    const win = makeWin();
    (win.setOverlayIcon as any).mockImplementation(() => { throw new Error('no taskbar'); });
    expect(() => applyAttentionBadge(win, 1, 'data:x', 'win32')).not.toThrow();
  });
});
