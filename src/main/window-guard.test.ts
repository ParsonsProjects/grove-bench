import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shell } from 'electron';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { isSameDocument, lockToAppPage } from './window-guard.js';

const APP_URL = 'file:///C:/Program%20Files/Grove%20Bench/resources/app.asar/dist/renderer/index.html';

function makeWebContents(url = APP_URL) {
  const listeners = new Map<string, (...args: any[]) => void>();
  let openHandler: ((details: { url: string }) => { action: string }) | undefined;
  const wc = {
    getURL: () => url,
    on: vi.fn((name: string, fn: (...args: any[]) => void) => { listeners.set(name, fn); }),
    setWindowOpenHandler: vi.fn((fn: typeof openHandler) => { openHandler = fn; }),
  };
  lockToAppPage(wc as never);
  return {
    navigate(target: string) {
      const event = { preventDefault: vi.fn() };
      listeners.get('will-navigate')!(event, target);
      return event.preventDefault.mock.calls.length > 0;
    },
    open: (target: string) => openHandler!({ url: target }),
  };
}

beforeEach(() => {
  vi.mocked(shell.openExternal).mockReset().mockResolvedValue(undefined as never);
});

describe('isSameDocument', () => {
  it('matches the same page with a different hash or query', () => {
    expect(isSameDocument(`${APP_URL}#x`, APP_URL)).toBe(true);
    expect(isSameDocument('http://localhost:5173/?t=1', 'http://localhost:5173/')).toBe(true);
  });

  it('rejects another path, host or scheme', () => {
    expect(isSameDocument(APP_URL.replace('index.html', 'src/foo.ts'), APP_URL)).toBe(false);
    expect(isSameDocument('http://localhost:5174/', 'http://localhost:5173/')).toBe(false);
    expect(isSameDocument('not a url', APP_URL)).toBe(false);
  });
});

describe('lockToAppPage', () => {
  it('allows a reload of the app page', () => {
    expect(makeWebContents().navigate(APP_URL)).toBe(false);
  });

  it('blocks a relative markdown link from replacing the app', () => {
    const blocked = makeWebContents().navigate(APP_URL.replace('index.html', 'src/main/git.ts'));
    expect(blocked).toBe(true);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('sends a web link to the system browser instead of navigating', () => {
    expect(makeWebContents().navigate('https://example.com/')).toBe(true);
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('denies new windows, opening web links in the system browser', () => {
    const wc = makeWebContents();
    expect(wc.open('https://example.com/a')).toEqual({ action: 'deny' });
    expect(wc.open('file:///C:/secret.txt')).toEqual({ action: 'deny' });
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/a');
  });
});
