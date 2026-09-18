import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Tray, Menu, type BrowserWindow } from 'electron';
import {
  ensureTray,
  destroyTray,
  setTrayAttention,
  showFirstHideBalloon,
  restoreWindow,
  tooltipText,
  _resetForTests,
} from './tray.js';

const mockTray = vi.mocked(Tray);

function makeOpts() {
  return { iconPath: 'C:\\app\\icon.ico', show: vi.fn(), quit: vi.fn() };
}

function makeWin(overrides: Record<string, unknown> = {}) {
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  } as unknown as BrowserWindow;
}

/** The mock Tray is a plain function: instances are `mock.instances`. */
function lastTray() {
  return mockTray.mock.instances[mockTray.mock.instances.length - 1] as unknown as {
    setToolTip: ReturnType<typeof vi.fn>;
    setContextMenu: ReturnType<typeof vi.fn>;
    displayBalloon: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTests();
});

describe('tooltipText', () => {
  it('is the bare app name at zero and carries the attention text otherwise', () => {
    expect(tooltipText(0)).toBe('Grove Bench');
    expect(tooltipText(1)).toBe('Grove Bench: 1 conversation needs attention');
    expect(tooltipText(4)).toBe('Grove Bench: 4 conversations need attention');
  });
});

describe('ensureTray', () => {
  it('creates the tray from the icon path with a Show/Quit menu and click handlers', () => {
    const opts = makeOpts();
    const tray = ensureTray(opts);
    expect(tray).not.toBeNull();
    expect(mockTray).toHaveBeenCalledTimes(1);
    expect(mockTray).toHaveBeenCalledWith(opts.iconPath);

    const t = lastTray();
    expect(t.setToolTip).toHaveBeenCalledWith('Grove Bench');

    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0] as Array<{ label?: string; click?: () => void }>;
    const show = template.find((i) => i.label === 'Show Grove Bench');
    const quit = template.find((i) => i.label === 'Quit');
    expect(show && quit).toBeTruthy();
    show!.click!();
    expect(opts.show).toHaveBeenCalledTimes(1);
    quit!.click!();
    expect(opts.quit).toHaveBeenCalledTimes(1);

    const events = t.on.mock.calls.map((c) => c[0]);
    expect(events).toContain('click');
    expect(events).toContain('balloon-click');
  });

  it('is idempotent while the tray is alive', () => {
    const opts = makeOpts();
    const first = ensureTray(opts);
    const second = ensureTray(opts);
    expect(second).toBe(first);
    expect(mockTray).toHaveBeenCalledTimes(1);
  });

  it('recreates the tray after destroyTray', () => {
    ensureTray(makeOpts());
    const t = lastTray();
    destroyTray();
    expect(t.destroy).toHaveBeenCalledTimes(1);
    ensureTray(makeOpts());
    expect(mockTray).toHaveBeenCalledTimes(2);
  });

  it('returns null and does not throw when the native Tray fails', () => {
    mockTray.mockImplementationOnce(() => { throw new Error('no shell'); });
    expect(ensureTray(makeOpts())).toBeNull();
    // A later call retries rather than staying broken.
    expect(ensureTray(makeOpts())).not.toBeNull();
  });
});

describe('setTrayAttention', () => {
  it('updates the tooltip and is a no-op without a tray', () => {
    expect(() => setTrayAttention(3)).not.toThrow();
    ensureTray(makeOpts());
    setTrayAttention(3);
    expect(lastTray().setToolTip).toHaveBeenLastCalledWith('Grove Bench: 3 conversations need attention');
    setTrayAttention(0);
    expect(lastTray().setToolTip).toHaveBeenLastCalledWith('Grove Bench');
  });
});

describe('showFirstHideBalloon', () => {
  it('shows the balloon once per run on Windows', () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      ensureTray(makeOpts());
      showFirstHideBalloon();
      showFirstHideBalloon();
      const t = lastTray();
      expect(t.displayBalloon).toHaveBeenCalledTimes(1);
      expect(t.displayBalloon.mock.calls[0][0]).toMatchObject({
        title: 'Grove Bench is still running',
        iconType: 'info',
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: platform });
    }
  });

  it('does nothing without a tray', () => {
    expect(() => showFirstHideBalloon()).not.toThrow();
    expect(mockTray).not.toHaveBeenCalled();
  });
});

describe('restoreWindow', () => {
  it('shows a hidden window and focuses it', () => {
    const win = makeWin();
    restoreWindow(win);
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(win.restore).not.toHaveBeenCalled();
  });

  it('restores a minimised window and skips show when already visible', () => {
    const win = makeWin({ isMinimized: vi.fn(() => true), isVisible: vi.fn(() => true) });
    restoreWindow(win);
    expect(win.restore).toHaveBeenCalledTimes(1);
    expect(win.show).not.toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalledTimes(1);
  });

  it('ignores null or destroyed windows', () => {
    expect(() => restoreWindow(null)).not.toThrow();
    const win = makeWin({ isDestroyed: vi.fn(() => true) });
    restoreWindow(win);
    expect(win.focus).not.toHaveBeenCalled();
  });
});
