import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notification, type BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import type { GroveBenchSettings, OsNotificationRequest } from '../shared/types.js';
import { kindEnabled, shouldNotify, showOsNotification } from './notifications.js';

const mockNotification = vi.mocked(Notification);

function makeSettings(overrides: Partial<GroveBenchSettings> = {}): GroveBenchSettings {
  return {
    notifyOnTurnComplete: true,
    notifyOnPermission: true,
    notifyOnPrAlert: true,
    notifyTaskbarFlash: true,
    ...overrides,
  } as GroveBenchSettings;
}

function makeWin(overrides: Record<string, unknown> = {}) {
  return {
    isFocused: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    flashFrame: vi.fn(),
    webContents: { send: vi.fn() },
    ...overrides,
  } as unknown as BrowserWindow;
}

const REQ: OsNotificationRequest = {
  kind: 'turn_complete',
  sessionId: 'abc123',
  title: 'feat/x',
  body: 'Agent finished a turn',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Notification.isSupported).mockReturnValue(true);
});

describe('kindEnabled()', () => {
  it('maps each kind to its settings flag', () => {
    const s = makeSettings({ notifyOnTurnComplete: false, notifyOnPermission: true, notifyOnPrAlert: false });
    expect(kindEnabled(s, 'turn_complete')).toBe(false);
    expect(kindEnabled(s, 'permission_request')).toBe(true);
    expect(kindEnabled(s, 'pr_alert')).toBe(false);
  });
});

describe('shouldNotify()', () => {
  it('never notifies while the window is focused', () => {
    expect(shouldNotify(makeSettings(), 'turn_complete', true)).toBe(false);
  });

  it('notifies when unfocused and the kind is enabled', () => {
    expect(shouldNotify(makeSettings(), 'turn_complete', false)).toBe(true);
  });

  it('respects the per-kind setting', () => {
    expect(shouldNotify(makeSettings({ notifyOnPrAlert: false }), 'pr_alert', false)).toBe(false);
  });
});

describe('showOsNotification()', () => {
  it('shows a notification and flashes the taskbar when unfocused', () => {
    const win = makeWin();
    const shown = showOsNotification(win, REQ, makeSettings());
    expect(shown).toBe(true);
    expect(mockNotification).toHaveBeenCalledWith({ title: 'feat/x', body: 'Agent finished a turn' });
    const instance = mockNotification.mock.instances[0] as unknown as { show: ReturnType<typeof vi.fn> };
    expect(instance.show).toHaveBeenCalled();
    expect(win.flashFrame).toHaveBeenCalledWith(true);
  });

  it('does nothing while the window is focused', () => {
    const win = makeWin({ isFocused: vi.fn(() => true) });
    expect(showOsNotification(win, REQ, makeSettings())).toBe(false);
    expect(mockNotification).not.toHaveBeenCalled();
    expect(win.flashFrame).not.toHaveBeenCalled();
  });

  it('does nothing when the kind is disabled in settings', () => {
    const win = makeWin();
    const shown = showOsNotification(win, REQ, makeSettings({ notifyOnTurnComplete: false }));
    expect(shown).toBe(false);
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it('does nothing when notifications are unsupported', () => {
    vi.mocked(Notification.isSupported).mockReturnValue(false);
    const win = makeWin();
    expect(showOsNotification(win, REQ, makeSettings())).toBe(false);
  });

  it('skips the taskbar flash when disabled', () => {
    const win = makeWin();
    showOsNotification(win, REQ, makeSettings({ notifyTaskbarFlash: false }));
    expect(win.flashFrame).not.toHaveBeenCalled();
  });

  it('click restores + focuses the window and tells the renderer which session', () => {
    const win = makeWin({ isMinimized: vi.fn(() => true) });
    showOsNotification(win, REQ, makeSettings());

    const instance = mockNotification.mock.instances[0] as unknown as { on: ReturnType<typeof vi.fn> };
    const clickHandler = instance.on.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1] as () => void;
    expect(clickHandler).toBeTypeOf('function');
    clickHandler();

    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.NOTIFY_FOCUS_SESSION, 'abc123');
  });
});
