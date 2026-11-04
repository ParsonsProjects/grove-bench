import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { app, session } from 'electron';
import { PreviewManager, blocksCookies, isOffMachineRequest, previewPartition, withoutHeader } from './preview.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('PreviewManager tool calls', () => {
  type Serial = <T>(sessionId: string, what: string, fn: () => Promise<T>) => Promise<T>;
  const serialOf = (m: PreviewManager) => (m as unknown as { serial: Serial }).serial.bind(m);

  it('runs one conversation\'s calls one at a time, in call order', async () => {
    const serial = serialOf(new PreviewManager());
    const order: string[] = [];
    let finishOpen!: () => void;
    const open = serial('s1', 'Open', () => new Promise<string>((r) => { finishOpen = () => { order.push('open'); r('opened'); }; }));
    const shot = serial('s1', 'Shot', async () => { order.push('shot'); return 'shot'; });
    const other = serial('s2', 'Other', async () => { order.push('other conversation'); return 'x'; });
    await other;
    expect(order).toEqual(['other conversation']);
    finishOpen();
    await expect(open).resolves.toBe('opened');
    await expect(shot).resolves.toBe('shot');
    expect(order).toEqual(['other conversation', 'open', 'shot']);
  });

  it('keeps going after a failed call', async () => {
    const serial = serialOf(new PreviewManager());
    await expect(serial('s1', 'Bad', async () => { throw new Error('No page is open.'); })).rejects.toThrow('No page is open.');
    await expect(serial('s1', 'Good', async () => 'ok')).resolves.toBe('ok');
  });

  it('fails a call that takes too long, so the turn does not stall', async () => {
    vi.useFakeTimers();
    const serial = serialOf(new PreviewManager());
    const stuck = serial('s1', 'The click', () => new Promise(() => {}));
    const check = expect(stuck).rejects.toThrow('The click took longer than 45s');
    await vi.advanceTimersByTimeAsync(45_000);
    await check;
    const next = serial('s1', 'Next', async () => 'ran');
    await vi.advanceTimersByTimeAsync(0);
    await expect(next).resolves.toBe('ran');
  });
});

describe('PreviewManager.closeAgentPage', () => {
  type Internals = { entries: Map<string, { agent: unknown; user: unknown }>; window: unknown };

  function setUp() {
    const m = new PreviewManager();
    const win = { isDestroyed: vi.fn(() => false), destroy: vi.fn() };
    const send = vi.fn();
    const internals = m as unknown as Internals;
    internals.window = { isDestroyed: () => false, webContents: { send } };
    const user = { visible: false };
    internals.entries.set('s1', { agent: { win }, user });
    return { m, win, send, internals, user };
  }

  it('closes the agent\'s page and tells the renderer, keeping yours', () => {
    const { m, win, send, internals, user } = setUp();

    m.closeAgentPage('s1');

    expect(win.destroy).toHaveBeenCalledOnce();
    expect(internals.entries.get('s1')).toMatchObject({ agent: null, user });
    expect(send).toHaveBeenCalledWith('preview:state', 's1', 'agent', null);
  });

  it('does nothing without a page', () => {
    const { m, win, send } = setUp();
    m.closeAgentPage('s1');
    m.closeAgentPage('s1');
    m.closeAgentPage('unknown');
    expect(win.destroy).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('previewPartition', () => {
  it('gives each project one store kept on disk, whatever the path\'s case', () => {
    const a = previewPartition('C:/dev/App', true);
    expect(a).toMatch(/^persist:grove-preview-[0-9a-f]{16}$/);
    expect(previewPartition('c:/DEV/app', true)).toBe(a);
    expect(previewPartition('C:/dev/other', true)).not.toBe(a);
  });

  it('gives a dev build its own store, which the installed app\'s encrypted cookies would break', () => {
    expect(previewPartition('C:/dev/App', false)).toMatch(/^persist:grove-preview-dev-[0-9a-f]{16}$/);
    expect(previewPartition('C:/dev/App', false).slice(-16)).toBe(previewPartition('C:/dev/App', true).slice(-16));
  });
});

describe('isOffMachineRequest, blocksCookies and withoutHeader', () => {
  it('counts requests to other sites, in any scheme, as off this machine', () => {
    expect(isOffMachineRequest('https://github.com/login')).toBe(true);
    expect(isOffMachineRequest('wss://api.example.com/socket')).toBe(true);
    for (const local of ['http://localhost:3000/', 'ws://localhost:5173/', 'http://127.0.0.1:8080', 'http://[::1]:3000', 'http://app.localhost/']) {
      expect(isOffMachineRequest(local)).toBe(false);
    }
    expect(isOffMachineRequest('file:///C:/repo/index.html')).toBe(false);
    expect(isOffMachineRequest('data:text/plain,hi')).toBe(false);
    expect(isOffMachineRequest('not a url')).toBe(false);
  });

  it('blocks cookies to other sites for the agent\'s page and for workers a local page started', () => {
    const site = 'https://github.com/api';
    expect(blocksCookies('agent', site, 'http://localhost:3000/')).toBe(true);
    expect(blocksCookies('user', site, 'http://localhost:3000/')).toBe(false);
    // A service worker's request has no page; its referrer is its own origin.
    expect(blocksCookies(null, site, 'http://localhost:3000/')).toBe(true);
    expect(blocksCookies(null, site, '')).toBe(true);
    expect(blocksCookies(null, site, undefined)).toBe(true);
    expect(blocksCookies(null, site, 'https://github.com/sw.js')).toBe(false);
    // Local requests keep their cookies, whoever makes them.
    expect(blocksCookies('agent', 'http://localhost:3000/api', 'http://localhost:3000/')).toBe(false);
    expect(blocksCookies(null, 'ws://127.0.0.1:5173/', '')).toBe(false);
  });

  it('drops a header in any case and keeps the rest', () => {
    expect(withoutHeader({ Cookie: 'a=1', cookie: 'b=2', Accept: '*/*' }, 'cookie')).toEqual({ Accept: '*/*' });
    expect(withoutHeader({ 'Set-Cookie': ['a=1'], 'content-type': ['text/html'] }, 'set-cookie')).toEqual({ 'content-type': ['text/html'] });
  });
});

describe('PreviewManager: one store per project', () => {
  type Handler = (details: Record<string, unknown>, callback: (r: unknown) => void) => void;
  type Internals = {
    ensureEntry(sessionId: string, worktreePath: string, repoPath: string): { partition: string; user: unknown; agent: unknown };
    entries: Map<string, { partition: string; user: unknown; agent: unknown }>;
  };

  function fakeSession() {
    const handlers: Record<string, Handler> = {};
    const capture = (name: string) => vi.fn((fn: Handler) => { handlers[name] = fn; });
    return {
      handlers,
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
      webRequest: {
        onBeforeRequest: capture('beforeRequest'),
        onBeforeSendHeaders: capture('beforeSendHeaders'),
        onHeadersReceived: capture('headersReceived'),
        onCompleted: vi.fn(),
        onErrorOccurred: vi.fn(),
      },
      on: vi.fn(),
      clearStorageData: vi.fn(() => Promise.resolve()),
      clearCache: vi.fn(() => Promise.resolve()),
      clearAuthCache: vi.fn(() => Promise.resolve()),
    };
  }

  const contents = (id: number, url = 'http://localhost:3000/') =>
    ({ id, isDestroyed: () => false, getURL: () => url, reload: vi.fn() });
  const userPage = (id: number, url?: string) => ({ view: { webContents: contents(id, url) } });
  const agentPage = (id: number, url?: string) => ({ win: { isDestroyed: () => false, webContents: contents(id, url) } });

  const repo = path.resolve('/projects/app');
  const wt1 = path.join(repo, 'wt1');
  const wt2 = path.join(repo, 'wt2');
  let ses: ReturnType<typeof fakeSession>;
  let m: PreviewManager;
  let internals: Internals;

  beforeEach(() => {
    ses = fakeSession();
    vi.mocked(session.fromPartition).mockReset().mockReturnValue(ses as never);
    m = new PreviewManager();
    internals = m as unknown as Internals;
  });

  function request(handler: string, details: Record<string, unknown>): unknown {
    let result: unknown;
    ses.handlers[handler](details, (r) => { result = r; });
    return result;
  }

  it('sets up a project\'s store once, for all its threads', () => {
    const a = internals.ensureEntry('s1', wt1, repo);
    const b = internals.ensureEntry('s2', wt2, repo);
    expect(a.partition).toBe(b.partition);
    expect(ses.webRequest.onBeforeRequest).toHaveBeenCalledOnce();
    expect(internals.ensureEntry('s3', '/elsewhere/wt', '/elsewhere').partition).not.toBe(a.partition);
  });

  it('loads a file only for the page whose worktree holds it', () => {
    internals.ensureEntry('s1', wt1, repo).user = userPage(1);
    internals.ensureEntry('s2', wt2, repo).user = userPage(2);
    const file = pathToFileURL(path.join(wt2, 'index.html')).href;

    expect(request('beforeRequest', { url: file, webContentsId: 2 })).toEqual({ cancel: false });
    expect(request('beforeRequest', { url: file, webContentsId: 1 })).toEqual({ cancel: true });
    // A request no open page made has no worktree, so no file loads.
    expect(request('beforeRequest', { url: file, webContentsId: 99 })).toEqual({ cancel: true });
    expect(request('beforeRequest', { url: file })).toEqual({ cancel: true });
    expect(request('beforeRequest', { url: 'https://example.com/', webContentsId: 1 })).toEqual({});
  });

  it('sends no cookies from the agent\'s page or a local worker to other sites, and takes none back', () => {
    internals.ensureEntry('s1', wt1, repo).user = userPage(1);
    internals.entries.get('s1')!.agent = agentPage(2);
    const requestHeaders = { Cookie: 'session=secret', Accept: '*/*' };
    const responseHeaders = { 'Set-Cookie': ['planted=1'], 'Content-Type': ['text/html'] };
    const local = 'http://localhost:3000/';
    const send = (url: string, webContentsId: number | undefined, referrer = local) =>
      request('beforeSendHeaders', { url, webContentsId, referrer, requestHeaders });
    const reply = (url: string, webContentsId: number | undefined, referrer = local) =>
      request('headersReceived', { url, webContentsId, referrer, responseHeaders });

    expect(send('https://github.com/api', 2)).toEqual({ requestHeaders: { Accept: '*/*' } });
    expect(reply('https://github.com/login', 2)).toEqual({ responseHeaders: { 'Content-Type': ['text/html'] } });
    // A service worker the local page started: no page, local referrer.
    expect(send('https://github.com/api', undefined)).toEqual({ requestHeaders: { Accept: '*/*' } });
    expect(reply('https://github.com/login', undefined, '')).toEqual({ responseHeaders: { 'Content-Type': ['text/html'] } });

    expect(send('http://localhost:3000/api', 2)).toEqual({});
    expect(reply('http://localhost:3000/login', 2)).toEqual({});
    expect(send('https://github.com/api', 1)).toEqual({});
    expect(reply('https://github.com/login', 1)).toEqual({});
    expect(send('https://github.com/api', undefined, 'https://github.com/sw.js')).toEqual({});
  });

  it('closing a thread keeps the project\'s sign-ins', () => {
    internals.ensureEntry('s1', wt1, repo);
    m.close('s1');
    expect(ses.clearStorageData).not.toHaveBeenCalled();
    expect(ses.clearCache).not.toHaveBeenCalled();
  });

  it('Clear sign-ins empties the project\'s store and reloads its open pages only', async () => {
    const mine = userPage(1);
    const mineAgent = agentPage(2);
    const blank = userPage(3, '');
    internals.ensureEntry('s1', wt1, repo).user = mine;
    internals.entries.get('s1')!.agent = mineAgent;
    internals.ensureEntry('s2', wt2, repo).user = blank;
    const other = userPage(4);
    internals.ensureEntry('s3', '/elsewhere/wt', '/elsewhere').user = other;

    await m.clearSignIns(repo);

    expect(session.fromPartition).toHaveBeenLastCalledWith(previewPartition(repo, false));
    expect(ses.clearStorageData).toHaveBeenCalledOnce();
    expect(ses.clearCache).toHaveBeenCalledOnce();
    expect(ses.clearAuthCache).toHaveBeenCalledOnce();
    expect(mine.view.webContents.reload).toHaveBeenCalledOnce();
    expect(mineAgent.win.webContents.reload).toHaveBeenCalledOnce();
    expect(blank.view.webContents.reload).not.toHaveBeenCalled();
    expect(other.view.webContents.reload).not.toHaveBeenCalled();
  });

  it('Remove project clears its store only if Preview was used there', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-preview-'));
    vi.mocked(app.getPath).mockReturnValue(userData);
    try {
      await m.forgetProject(repo);
      expect(ses.clearStorageData).not.toHaveBeenCalled();

      const name = previewPartition(repo, false).slice('persist:'.length);
      fs.mkdirSync(path.join(userData, 'Partitions', name), { recursive: true });
      await m.forgetProject(repo);
      expect(ses.clearStorageData).toHaveBeenCalledOnce();
    } finally {
      vi.mocked(app.getPath).mockImplementation((n: string) => `/mock/${n}`);
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});
