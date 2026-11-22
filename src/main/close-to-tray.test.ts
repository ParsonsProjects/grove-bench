import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app, dialog, Menu, Notification, Tray, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import {
  CloseToTray, closeChoice, noticeBody, OFFER_BUTTONS, offerText, threadsWorking, trayMenuTemplate, type CloseToTrayOptions,
} from './close-to-tray.js';
import type { CloseWindowAction } from '../shared/types.js';

vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

type MockTray = { emit: (event: string) => void; popUpContextMenu: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
const trays = () => vi.mocked(Tray).mock.instances as unknown as MockTray[];

function makeWin() {
  let visible = true;
  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => visible),
    isMinimized: vi.fn(() => false),
    hide: vi.fn(() => { visible = false; }),
    show: vi.fn(() => { visible = true; }),
    minimize: vi.fn(),
    restore: vi.fn(),
    focus: vi.fn(),
  };
}

/** A CloseToTray installed over a window, with the setting, the thread
 *  count and the once-only flag held here. */
function setUp(state: { action?: CloseWindowAction; working?: number; introduced?: boolean } = {}) {
  const win = makeWin();
  const s = { action: state.action ?? 'quit', working: state.working ?? 0, introduced: state.introduced ?? false };
  const opts: CloseToTrayOptions = {
    getWindow: () => win as unknown as BrowserWindow,
    iconPath: '/icon.ico',
    closeAction: () => s.action,
    setCloseAction: vi.fn((action: CloseWindowAction) => { s.action = action; }),
    working: () => s.working,
    introduced: () => s.introduced,
    setIntroduced: vi.fn(() => { s.introduced = true; }),
  };
  const ctt = new CloseToTray();
  ctt.install(opts);
  const close = () => {
    const event = { preventDefault: vi.fn() };
    ctt.onClose(event);
    return event;
  };
  return { ctt, win, s, opts, close };
}

const settle = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('closeChoice', () => {
  it('quits by default, offering the tray once when threads are working', () => {
    expect(closeChoice({ quitting: false, action: 'quit', working: 0, introduced: false })).toBe('close');
    expect(closeChoice({ quitting: false, action: 'quit', working: 2, introduced: false })).toBe('offer');
    expect(closeChoice({ quitting: false, action: 'quit', working: 2, introduced: true })).toBe('close');
  });

  it('hides with the tray chosen, and always closes once the app is quitting', () => {
    expect(closeChoice({ quitting: false, action: 'tray', working: 0, introduced: true })).toBe('hide');
    expect(closeChoice({ quitting: true, action: 'tray', working: 2, introduced: false })).toBe('close');
    expect(closeChoice({ quitting: true, action: 'quit', working: 2, introduced: false })).toBe('close');
  });
});

describe('text', () => {
  it('counts threads', () => {
    expect(threadsWorking(0)).toBe('No threads working');
    expect(threadsWorking(1)).toBe('1 thread working');
    expect(threadsWorking(3)).toBe('3 threads working');
    expect(offerText(1).message).toBe('1 thread is still working');
    expect(offerText(2).message).toBe('2 threads are still working');
    expect(noticeBody(2)).toBe('2 threads are working. Open Grove Bench from the tray icon, or quit from its menu.');
    expect(noticeBody(0)).toBe('Open Grove Bench from the tray icon, or quit from its menu.');
  });

  it("builds the tray menu with what's working and what needs you", () => {
    const actions = { open: vi.fn(), quit: vi.fn() };
    const labels = (t: MenuItemConstructorOptions[]) => t.map((i) => i.label ?? i.type);
    expect(labels(trayMenuTemplate({ working: 2, attention: 1 }, actions))).toEqual([
      'Open Grove Bench', 'separator', '2 threads working', '1 thread needs attention', 'separator', 'Quit Grove Bench',
    ]);
    expect(labels(trayMenuTemplate({ working: 0, attention: 0 }, actions))).toEqual([
      'Open Grove Bench', 'separator', 'No threads working', 'separator', 'Quit Grove Bench',
    ]);
    const menu = trayMenuTemplate({ working: 2, attention: 1 }, actions);
    expect(menu[2].enabled).toBe(false);
    expect(menu[3].enabled).toBe(false);
  });
});

describe('CloseToTray', () => {
  it('lets the window close (and the app quit) by default', () => {
    const { win, close } = setUp();
    expect(close().preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
    expect(Tray).not.toHaveBeenCalled();
  });

  it('shows the tray icon while the setting is the tray, and hides the window there', () => {
    const { win, close } = setUp({ action: 'tray', introduced: true });
    expect(Tray).toHaveBeenCalledWith('/icon.ico');

    expect(close().preventDefault).toHaveBeenCalled();
    expect(win.hide).toHaveBeenCalled();
    expect(Notification).not.toHaveBeenCalled();

    trays()[0].emit('click');
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  it('says where the window went the first time only', () => {
    const { opts, close } = setUp({ action: 'tray', working: 2 });
    close();
    expect(Notification).toHaveBeenCalledWith({ title: 'Still running in the tray', body: noticeBody(2) });
    expect(opts.setIntroduced).toHaveBeenCalled();
    close();
    expect(Notification).toHaveBeenCalledTimes(1);
  });

  it('opens the menu with current counts, and quits from it', () => {
    const { ctt, s } = setUp({ action: 'tray', working: 1 });
    ctt.noteAttention(2);
    s.working = 3;
    trays()[0].emit('right-click');
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0] as MenuItemConstructorOptions[];
    expect(template.map((i) => i.label)).toContain('3 threads working');
    expect(template.map((i) => i.label)).toContain('2 threads need attention');
    expect(trays()[0].popUpContextMenu).toHaveBeenCalled();

    template.find((i) => i.label === 'Quit Grove Bench')!.click!({} as never, undefined, {});
    expect(app.quit).toHaveBeenCalled();
  });

  it('closes for real once the app is quitting', () => {
    const { ctt, win, close } = setUp({ action: 'tray', introduced: true });
    ctt.markQuitting();
    expect(close().preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it('removes the icon when the setting goes back to Quit, but not while the window is in the tray', () => {
    const { ctt, win, close } = setUp({ action: 'tray', introduced: true });
    close();
    ctt.apply('quit');
    expect(trays()[0].destroy).not.toHaveBeenCalled();
    win.show();
    ctt.apply('quit');
    expect(trays()[0].destroy).toHaveBeenCalled();
  });

  it('minimises instead when the tray icon can\'t be made, so the window is never lost', () => {
    // At start-up, and again on closing.
    const noTray = () => { throw new Error('no tray'); };
    vi.mocked(Tray).mockImplementationOnce(noTray).mockImplementationOnce(noTray);
    const { win, close } = setUp({ action: 'tray', introduced: true });
    close();
    expect(win.hide).not.toHaveBeenCalled();
    expect(win.minimize).toHaveBeenCalled();
  });

  describe('the first close with threads working', () => {
    it('offers the tray, and Keep running saves the setting and hides the window', async () => {
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
      const { win, s, opts, close } = setUp({ working: 2 });

      expect(close().preventDefault).toHaveBeenCalled();
      await settle();

      expect(dialog.showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({
        message: '2 threads are still working', buttons: [...OFFER_BUTTONS], defaultId: 0, cancelId: 2,
      }));
      expect(opts.setCloseAction).toHaveBeenCalledWith('tray');
      expect(s.introduced).toBe(true);
      expect(win.hide).toHaveBeenCalled();
      // It was just offered: no notice on top.
      expect(Notification).not.toHaveBeenCalled();
    });

    it('quits on Quit, and asks no more', async () => {
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false });
      const { win, s, close } = setUp({ working: 1 });
      close();
      await settle();
      expect(app.quit).toHaveBeenCalled();
      expect(win.hide).not.toHaveBeenCalled();
      expect(s.introduced).toBe(true);
      expect(s.action).toBe('quit');
    });

    it('keeps the window open on Cancel, and asks again next time', async () => {
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 2, checkboxChecked: false });
      const { win, s, close } = setUp({ working: 1 });
      close();
      await settle();
      expect(app.quit).not.toHaveBeenCalled();
      expect(win.hide).not.toHaveBeenCalled();
      expect(s.introduced).toBe(false);
      expect(close().preventDefault).toHaveBeenCalled();
    });

    it('still goes to the tray if the setting fails to save', async () => {
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
      const { win, opts, close } = setUp({ working: 1 });
      vi.mocked(opts.setCloseAction).mockImplementation(() => { throw new Error('read failed'); });
      close();
      await settle();
      expect(win.hide).toHaveBeenCalled();
    });

    it('shows one dialog when close is pressed again while it is open', async () => {
      let answer!: (r: { response: number; checkboxChecked: boolean }) => void;
      vi.mocked(dialog.showMessageBox).mockReturnValue(new Promise((r) => { answer = r; }));
      const { close } = setUp({ working: 1 });
      close();
      close();
      expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
      answer({ response: 2, checkboxChecked: false });
      await settle();
    });
  });
});
