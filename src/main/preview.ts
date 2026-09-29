/**
 * Preview tab: a browser per conversation.
 *
 * Each conversation gets two pages that share one in-memory storage partition
 * (cookies, localStorage), so logging in on one logs in the other:
 *
 * - Your page: a WebContentsView in the Grove window. The renderer reports
 *   where the Preview tab's content area is and the view is placed on top of
 *   it. Native views draw above the HTML, so the renderer hides the view (and
 *   shows a snapshot) whenever a Grove menu or dialog overlaps it.
 * - Claude's page: an offscreen-rendered hidden window the agent's browser
 *   tools drive. Offscreen rendering keeps it painting while nobody is
 *   looking, so screenshots, clicks and typing work from any tab. A hidden
 *   WebContentsView stops painting and can't be captured reliably. Claude's
 *   page only opens local URLs (see preview-policy.ts).
 *
 * Both pages run sandboxed with no preload and no Node, deny permission
 * requests (except writing to the clipboard) and are closed with the
 * conversation.
 */
import { BrowserWindow, Menu, WebContentsView, clipboard, session as electronSession, shell } from 'electron';
import type { MenuItemConstructorOptions, NativeImage, Session, WebContents } from 'electron';
import { IPC } from '../shared/types.js';
import type { PreviewBounds, PreviewCommand, PreviewKeyForward, PreviewPageKind, PreviewPageState } from '../shared/types.js';
import { isLocalHttpUrl, normalizeTypedUrl } from '../shared/preview-url.js';
import { checkFileRequest, checkNavigation } from './preview-policy.js';
import { PreviewLog, consoleLevel, formatLogEntries } from './preview-log.js';
import { previewKeyAction } from './preview-keys.js';
import { locateScript, readScript, type LocateResult, type PageReadResult } from './preview-scripts.js';
import type { PreviewOperations, PreviewScreenshot, PreviewTarget } from './adapters/types.js';
import { logger } from './logger.js';

/** Claude's page viewport. A common laptop size; the agent can change it. */
const AGENT_DEFAULT_SIZE = { width: 1280, height: 800 };
const AGENT_MIN_SIZE = { width: 320, height: 240 };
const AGENT_MAX_SIZE = { width: 2560, height: 1600 };
/** Offscreen paint rate for Claude's page. Enough to watch; low CPU. */
const AGENT_FRAME_RATE = 10;
const LOAD_TIMEOUT_MS = 20_000;
/** Longest any one browser tool call may take, so a stuck page can't stall
 *  the agent's turn. Longer than a load plus settling. */
const ACTION_TIMEOUT_MS = 45_000;
/** Pause after an action so scripts, transitions and fetches can land. */
const SETTLE_MS = 350;
const DEFAULT_READ_CHARS = 20_000;
/** Screenshots above this size are sent as JPEG instead of PNG. */
const MAX_PNG_BYTES = 1_500_000;

/** Errors that just mean a load was replaced by another one. */
const ERR_ABORTED = -3;

interface UserPage {
  view: WebContentsView;
  state: PreviewPageState;
  visible: boolean;
}

interface AgentPage {
  win: BrowserWindow;
  state: PreviewPageState;
  log: PreviewLog;
  /** Bumped on every offscreen paint, so the UI only fetches changed frames. */
  frameVersion: number;
  /** How to answer an alert or confirm the page opens. The action that may
   *  open one sets it; otherwise dialogs get OK. */
  dialogAnswer: 'accept' | 'dismiss';
  /** Attach the DevTools protocol client if it isn't (it can drop when the
   *  page's process restarts). */
  ensureDebugger: () => void;
}

interface Entry {
  sessionId: string;
  worktreePath: string;
  partition: string;
  user: UserPage | null;
  agent: AgentPage | null;
  /** Last bounds the renderer asked for; applied when your page is created. */
  viewport: PreviewBounds | null;
}

function blankState(): PreviewPageState {
  return { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: null, crashed: false };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wait for `promise` up to `ms`. Resolves true if it settled in time, false
 *  on timeout; rethrows its rejection. Clears its timer either way. */
export async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  try {
    return await Promise.race([promise.then(() => true as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** loadURL rejects with ERR_ABORTED when the page starts another navigation
 *  (a script redirect) before the first one finishes. */
function isAborted(message: string): boolean {
  return /ERR_ABORTED|\(-3\)/.test(message);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Electron's development-only security banner, printed into every page's
 *  console when the app isn't packaged. Not the page's own output. */
function isElectronNoise(message: string): boolean {
  return message.includes('Electron Security Warning');
}

export class PreviewManager {
  private window: BrowserWindow | null = null;
  private entries = new Map<string, Entry>();
  private configuredPartitions = new Set<string>();
  /** Agent tool calls per conversation, run one at a time in call order. */
  private queues = new Map<string, Promise<unknown>>();

  /** The Grove window your pages are placed in and state is sent to. */
  setWindow(win: BrowserWindow | null): void {
    this.window = win;
    // When Grove's UI reloads, the renderer forgets where your page goes and
    // would never hide it again; hide every page until it asks.
    win?.webContents.on('did-navigate', () => this.hideAll());
  }

  private hideAll(): void {
    for (const entry of this.entries.values()) {
      entry.viewport = null;
      this.applyViewport(entry, null);
    }
  }

  // ─── Lifecycle ───

  private partitionFor(sessionId: string): string {
    // No "persist:" prefix: storage lives in memory and is cleared on close.
    return `grove-preview-${sessionId}`;
  }

  private ensureEntry(sessionId: string, worktreePath: string): Entry {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { sessionId, worktreePath, partition: this.partitionFor(sessionId), user: null, agent: null, viewport: null };
      this.entries.set(sessionId, entry);
      this.configurePartition(entry.partition, sessionId);
    } else if (worktreePath) {
      entry.worktreePath = worktreePath;
    }
    return entry;
  }

  /** Close both pages and forget the conversation's storage. */
  close(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.entries.delete(sessionId);
    this.queues.delete(sessionId);
    if (entry.user) {
      const wc = entry.user.view.webContents;
      try { this.window?.contentView.removeChildView(entry.user.view); } catch { /* window gone */ }
      if (!wc.isDestroyed()) wc.close();
      this.sendState(sessionId, 'user', null);
    }
    if (entry.agent) {
      if (!entry.agent.win.isDestroyed()) entry.agent.win.destroy();
      this.sendState(sessionId, 'agent', null);
    }
    const ses = electronSession.fromPartition(entry.partition);
    ses.clearStorageData().catch(() => { /* best effort */ });
    ses.clearCache().catch(() => { /* best effort */ });
  }

  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id);
  }

  // ─── Partition (shared by both pages) ───

  private configurePartition(partition: string, sessionId: string): void {
    if (this.configuredPartitions.has(partition)) return;
    this.configuredPartitions.add(partition);
    const ses: Session = electronSession.fromPartition(partition);

    // Camera, microphone, notifications, geolocation, USB and the rest stay
    // off. Copy buttons in the page still work.
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
    ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write');
    ses.setDevicePermissionHandler(() => false);

    // Files load only from inside the worktree, and Claude's page only loads
    // web file types: an iframe or script tag could otherwise show it any file.
    // No URL filter: 'file:///*' would miss UNC paths (file://server/share).
    ses.webRequest.onBeforeRequest((details, callback) => {
      if (!details.url.startsWith('file:')) {
        callback({});
        return;
      }
      const entry = this.entries.get(sessionId);
      const agent = this.agentPageFor(sessionId, details.webContentsId);
      const check = checkFileRequest(details.url, agent ? 'agent' : 'user', entry?.worktreePath ?? '');
      if (!check.ok) {
        agent?.log.add({ kind: 'page', level: 'warning', text: check.reason });
        logger.info(`[preview] ${sessionId}: ${check.reason}`);
      }
      callback({ cancel: !check.ok });
    });

    // Claude reads failed requests with preview_logs. Handlers look the entry
    // up on each call: the partition outlives a closed and reopened page.
    ses.webRequest.onCompleted((details) => {
      if (details.statusCode < 400) return;
      const agent = this.agentPageFor(sessionId, details.webContentsId);
      agent?.log.add({ kind: 'network', level: 'error', text: `${details.method} ${details.url} → ${details.statusCode}${details.statusLine ? ` ${details.statusLine.replace(/^HTTP\/[\d.]+ \d+ ?/, '')}` : ''}`.trimEnd() });
    });
    ses.webRequest.onErrorOccurred((details) => {
      if (details.error === 'net::ERR_ABORTED') return;
      const agent = this.agentPageFor(sessionId, details.webContentsId);
      agent?.log.add({ kind: 'network', level: 'error', text: `${details.method} ${details.url} failed: ${details.error}` });
    });

    // Downloads from Claude's page would open a save dialog nobody asked for.
    ses.on('will-download', (event, item, wc) => {
      const agent = this.agentPageFor(sessionId, wc?.id);
      if (!agent) return;
      event.preventDefault();
      agent.log.add({ kind: 'page', level: 'warning', text: `Download blocked: ${item.getURL()}` });
    });
  }

  private agentPageFor(sessionId: string, webContentsId: number | undefined): AgentPage | null {
    const agent = this.entries.get(sessionId)?.agent;
    if (!agent || agent.win.isDestroyed() || webContentsId === undefined) return null;
    return agent.win.webContents.id === webContentsId ? agent : null;
  }

  // ─── Pages ───

  private ensureUserPage(entry: Entry): UserPage {
    if (entry.user) return entry.user;
    const win = this.window;
    if (!win || win.isDestroyed()) throw new Error('The Grove window is not ready.');
    const view = new WebContentsView({
      webPreferences: {
        partition: entry.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    view.setBackgroundColor('#ffffff');
    view.setVisible(false);
    win.contentView.addChildView(view);
    const page: UserPage = { view, state: blankState(), visible: false };
    entry.user = page;
    this.wirePage(entry, 'user', view.webContents);
    this.wireUserExtras(entry, view.webContents);
    if (entry.viewport) this.applyViewport(entry, entry.viewport);
    return page;
  }

  private ensureAgentPage(entry: Entry): AgentPage {
    if (entry.agent && !entry.agent.win.isDestroyed()) return entry.agent;
    const win = new BrowserWindow({
      show: false,
      width: AGENT_DEFAULT_SIZE.width,
      height: AGENT_DEFAULT_SIZE.height,
      useContentSize: true,
      skipTaskbar: true,
      webPreferences: {
        offscreen: true,
        partition: entry.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    const wc = win.webContents;
    wc.setFrameRate(AGENT_FRAME_RATE);
    wc.setAudioMuted(true);
    const page: AgentPage = {
      win,
      state: { ...blankState(), lastAction: null, size: { ...AGENT_DEFAULT_SIZE } },
      log: new PreviewLog(),
      frameVersion: 0,
      dialogAnswer: 'accept',
      ensureDebugger: () => {},
    };
    entry.agent = page;
    this.answerDialogs(page, wc);
    wc.on('paint', () => { page.frameVersion++; });
    wc.on('console-message', (_event, level, message, line, sourceId) => {
      if (isElectronNoise(message)) return;
      page.log.add({ kind: 'console', level: consoleLevel(level), text: message, source: sourceId ? `${sourceId}:${line}` : undefined });
    });
    win.on('closed', () => {
      if (entry.agent === page) entry.agent = null;
    });
    this.wirePage(entry, 'agent', wc);
    this.sendState(entry.sessionId, 'agent', page.state);
    return page;
  }

  /**
   * Answer alert and confirm dialogs on Claude's page. Nobody can click a
   * dialog on a hidden page, and an open one blocks it, so the action that
   * opened it and every later one would hang. What the dialog said and the
   * answer go in the log, so the action's result reports them. (Electron
   * doesn't support prompt().)
   */
  private answerDialogs(page: AgentPage, wc: WebContents): void {
    wc.debugger.on('message', (_event, method, params) => {
      if (method !== 'Page.javascriptDialogOpening') return;
      const accept = page.dialogAnswer === 'accept' || params.type === 'beforeunload';
      if (params.type !== 'beforeunload') {
        page.log.add({ kind: 'page', level: 'warning', text: `The page showed ${params.type}(${JSON.stringify(params.message)}) and it was answered ${accept ? 'OK' : 'Cancel'}.` });
      }
      wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept, promptText: params.defaultPrompt ?? '' }).catch(() => {});
    });
    page.ensureDebugger = () => {
      if (wc.isDestroyed() || wc.debugger.isAttached()) return;
      try {
        wc.debugger.attach('1.3');
      } catch (e) {
        logger.warn(`[preview] could not attach to Claude's page: ${errorText(e)}`);
        return;
      }
      // Resolves only after the page's first load, so it isn't awaited.
      wc.debugger.sendCommand('Page.enable').catch(() => {});
    };
    page.ensureDebugger();
  }

  /** Navigation rules and state tracking shared by both pages. */
  private wirePage(entry: Entry, kind: PreviewPageKind, wc: WebContents): void {
    const update = (patch: Partial<PreviewPageState>) => this.updateState(entry, kind, patch);
    const log = (level: 'warning' | 'error', text: string) => {
      if (kind === 'agent') entry.agent?.log.add({ kind: 'page', level, text });
    };
    const guard = (event: { preventDefault(): void }, url: string) => {
      const check = checkNavigation(url, kind, entry.worktreePath);
      if (check.ok) return;
      event.preventDefault();
      log('warning', `Blocked navigation to ${url}: ${check.reason}`);
      logger.info(`[preview] ${kind} page of ${entry.sessionId} blocked navigation to ${url}`);
    };

    wc.on('did-start-loading', () => update({ loading: true }));
    wc.on('did-stop-loading', () => update({ loading: false }));
    wc.on('did-navigate', (_e, url) => update({ url, error: null, crashed: false }));
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) update({ url }); });
    wc.on('page-title-updated', (_e, title) => update({ title }));
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      update({ error: { code, description, url }, url: url || entry[kind]?.state.url || '' });
      log('error', `Failed to load ${url}: ${description} (${code})`);
    });
    wc.on('render-process-gone', (_e, details) => {
      update({ crashed: true, loading: false });
      log('error', `The page's process ended (${details.reason}).`);
    });
    // Links and redirects the page starts itself. loadURL is checked by the caller.
    wc.on('will-navigate', (event, url) => guard(event, url));
    wc.on('will-redirect', (event, url, _isInPlace, isMainFrame) => { if (isMainFrame) guard(event, url); });
    // Pop-ups and target=_blank open in the same page.
    wc.setWindowOpenHandler(({ url }) => {
      if (checkNavigation(url, kind, entry.worktreePath).ok) {
        setImmediate(() => { if (!wc.isDestroyed()) wc.loadURL(url).catch(() => {}); });
      } else {
        log('warning', `Blocked pop-up to ${url}`);
      }
      return { action: 'deny' };
    });
    // Local dev servers often use self-signed certificates.
    wc.on('certificate-error', (event, url, _error, _cert, callback) => {
      if (isLocalHttpUrl(url)) {
        event.preventDefault();
        callback(true);
      } else {
        callback(false);
      }
    });
    // A beforeunload prompt would otherwise block navigation and close silently.
    wc.on('will-prevent-unload', (event) => event.preventDefault());
  }

  /** Context menu and keyboard shortcuts for your page. */
  private wireUserExtras(entry: Entry, wc: WebContents): void {
    wc.on('before-input-event', (event, input) => {
      const action = previewKeyAction(input);
      if (!action) return;
      event.preventDefault();
      if (action.kind === 'page') {
        this.runCommand(wc, action.command);
        return;
      }
      const win = this.window;
      if (!win || win.isDestroyed()) return;
      win.webContents.focus();
      const forward: PreviewKeyForward = action.kind === 'focusAddress'
        ? { action: 'focusAddress' }
        : { action: 'key', key: input.key, ctrlKey: input.control, shiftKey: input.shift, altKey: input.alt, metaKey: input.meta };
      win.webContents.send(IPC.PREVIEW_KEY, entry.sessionId, forward);
    });

    wc.on('context-menu', (_event, params) => {
      const items: MenuItemConstructorOptions[] = [];
      if (params.linkURL) {
        if (/^https?:/i.test(params.linkURL)) {
          items.push({ label: 'Open Link in System Browser', click: () => { shell.openExternal(params.linkURL).catch(() => {}); } });
        }
        items.push({ label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) }, { type: 'separator' });
      }
      if (params.isEditable) {
        items.push(
          { role: 'cut', enabled: params.editFlags.canCut },
          { role: 'copy', enabled: params.editFlags.canCopy },
          { role: 'paste', enabled: params.editFlags.canPaste },
          { role: 'selectAll' },
          { type: 'separator' },
        );
      } else if (params.selectionText) {
        items.push({ role: 'copy' }, { type: 'separator' });
      }
      items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => wc.reload() },
        { type: 'separator' },
        { label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) },
      );
      const win = this.window;
      if (win && !win.isDestroyed()) Menu.buildFromTemplate(items).popup({ window: win });
    });
  }

  private updateState(entry: Entry, kind: PreviewPageKind, patch: Partial<PreviewPageState>): void {
    // A closing page can still fire events; don't resurrect it in the UI.
    if (this.entries.get(entry.sessionId) !== entry) return;
    const page = kind === 'user' ? entry.user : entry.agent;
    if (!page) return;
    const wc = kind === 'user' ? entry.user!.view.webContents : entry.agent!.win.webContents;
    const history = wc.isDestroyed() ? null : wc.navigationHistory;
    page.state = {
      ...page.state,
      ...patch,
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
    };
    this.sendState(entry.sessionId, kind, page.state);
  }

  private sendState(sessionId: string, kind: PreviewPageKind, state: PreviewPageState | null): void {
    const win = this.window;
    if (win && !win.isDestroyed()) win.webContents.send(IPC.PREVIEW_STATE, sessionId, kind, state);
  }

  private pageContents(sessionId: string, kind: PreviewPageKind): WebContents | null {
    const entry = this.entries.get(sessionId);
    const wc = kind === 'user' ? entry?.user?.view.webContents : entry?.agent?.win.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  private runCommand(wc: WebContents, command: PreviewCommand): void {
    switch (command) {
      case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
      case 'reload': wc.reload(); break;
      case 'hardReload': wc.reloadIgnoringCache(); break;
      case 'stop': wc.stop(); break;
      case 'devtools':
        if (wc.isDevToolsOpened()) wc.closeDevTools();
        else wc.openDevTools({ mode: 'detach' });
        break;
    }
  }

  // ─── Renderer requests ───

  /** Load a URL the user typed or clicked. Throws a readable reason when the
   *  URL isn't allowed; load errors show up in the page state instead. */
  navigate(sessionId: string, worktreePath: string, kind: PreviewPageKind, input: string): void {
    const url = normalizeTypedUrl(input);
    if (!url) throw new Error(`"${input}" isn't a web address. Try something like localhost:3000.`);
    const check = checkNavigation(url, kind, worktreePath);
    if (!check.ok) throw new Error(check.reason);
    const entry = this.ensureEntry(sessionId, worktreePath);
    const wc = kind === 'user' ? this.ensureUserPage(entry).view.webContents : this.ensureAgentPage(entry).win.webContents;
    wc.loadURL(url).catch(() => { /* did-fail-load reports it */ });
  }

  command(sessionId: string, kind: PreviewPageKind, command: PreviewCommand): void {
    const wc = this.pageContents(sessionId, kind);
    if (wc) this.runCommand(wc, command);
  }

  /** Show your page at `bounds` (CSS pixels in the window), or hide it. */
  setViewport(sessionId: string, bounds: PreviewBounds | null): void {
    const entry = this.entries.get(sessionId);
    // The renderer only places a page it has seen state for.
    if (!entry) return;
    entry.viewport = bounds;
    if (bounds) {
      // Only one conversation's page is ever on screen.
      for (const other of this.entries.values()) {
        if (other !== entry && other.user?.visible) this.applyViewport(other, null);
      }
    }
    this.applyViewport(entry, bounds);
  }

  private applyViewport(entry: Entry, bounds: PreviewBounds | null): void {
    const page = entry.user;
    if (!page) return;
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      // The renderer measures in CSS pixels; views are placed in window
      // pixels, which differ when Grove's UI is zoomed.
      const win = this.window;
      const zoom = win && !win.isDestroyed() ? win.webContents.getZoomFactor() : 1;
      page.view.setBounds({
        x: Math.round(bounds.x * zoom),
        y: Math.round(bounds.y * zoom),
        width: Math.round(bounds.width * zoom),
        height: Math.round(bounds.height * zoom),
      });
      if (!page.visible) {
        page.view.setVisible(true);
        page.visible = true;
      }
    } else if (page.visible) {
      // Hand focus back to Grove so typing doesn't go to a hidden page.
      const win = this.window;
      if (page.view.webContents.isFocused() && win && !win.isDestroyed()) win.webContents.focus();
      page.view.setVisible(false);
      page.visible = false;
    }
  }

  /** A picture of your page while it's on screen, for the renderer to show
   *  in its place while an overlay covers it. */
  async snapshot(sessionId: string): Promise<string | null> {
    const page = this.entries.get(sessionId)?.user;
    if (!page?.visible || page.view.webContents.isDestroyed()) return null;
    try {
      const img = await page.view.webContents.capturePage();
      return img.isEmpty() ? null : `data:image/jpeg;base64,${img.toJPEG(90).toString('base64')}`;
    } catch {
      return null;
    }
  }

  async agentFrame(sessionId: string, sinceVersion: number): Promise<{ version: number; dataUrl: string } | null> {
    const page = this.entries.get(sessionId)?.agent;
    if (!page || page.win.isDestroyed() || !page.state.url) return null;
    const version = page.frameVersion;
    if (version === sinceVersion) return null;
    try {
      const img = await page.win.webContents.capturePage();
      if (img.isEmpty()) return null;
      return { version, dataUrl: `data:image/jpeg;base64,${img.toJPEG(80).toString('base64')}` };
    } catch {
      return null;
    }
  }

  getState(sessionId: string): { user: PreviewPageState | null; agent: PreviewPageState | null } {
    const entry = this.entries.get(sessionId);
    return { user: entry?.user?.state ?? null, agent: entry?.agent?.state ?? null };
  }

  getStates(): Record<string, { user: PreviewPageState | null; agent: PreviewPageState | null }> {
    const all: Record<string, { user: PreviewPageState | null; agent: PreviewPageState | null }> = {};
    for (const id of this.entries.keys()) all[id] = this.getState(id);
    return all;
  }

  // ─── Agent tools ───

  /** The operations the agent's browser tools call, bound to a conversation. */
  operationsFor(sessionId: string, worktreePath: string): PreviewOperations {
    const run = <T>(what: string, fn: () => Promise<T>) => this.serial(sessionId, what, fn);
    return {
      open: (opts) => run('Opening the page', () => this.agentOpen(sessionId, worktreePath, opts)),
      screenshot: () => run('The screenshot', () => this.agentScreenshot(sessionId)),
      read: (opts) => run('Reading the page', () => this.agentRead(sessionId, opts)),
      logs: (opts) => run('Reading the log', async () => this.agentLogs(sessionId, opts)),
      click: (target, opts) => run('The click', () => this.agentClick(sessionId, target, opts ?? {})),
      type: (target, text, opts) => run('Typing', () => this.agentType(sessionId, target, text, opts)),
    };
  }

  /**
   * Run one tool call at a time per conversation, in call order: the agent
   * may send several at once (say an open and a screenshot), and each must
   * see the page the previous one left. A call that takes longer than
   * ACTION_TIMEOUT_MS fails so the agent's turn can't stall on a stuck page.
   */
  private serial<T>(sessionId: string, what: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const result = previous.then(async () => {
      let value!: T;
      const done = await within(fn().then((v) => { value = v; }), ACTION_TIMEOUT_MS);
      if (!done) throw new Error(`${what} took longer than ${ACTION_TIMEOUT_MS / 1000}s. The page may be stuck in a long script or request.`);
      return value;
    });
    this.queues.set(sessionId, result.catch(() => {}));
    return result;
  }

  /** Claude's page with something loaded on a URL it's allowed to act on. */
  private requireAgentPage(sessionId: string): AgentPage {
    const entry = this.entries.get(sessionId);
    const page = entry?.agent;
    if (!entry || !page || page.win.isDestroyed() || !page.state.url) {
      throw new Error('No page is open. Open one first with preview_open.');
    }
    if (page.state.crashed) throw new Error('The page crashed. Reload it with preview_open (no url).');
    const check = checkNavigation(page.state.url, 'agent', entry.worktreePath);
    if (!check.ok) throw new Error(`The page is on ${page.state.url}, which Claude's browser can't act on. ${check.reason}`);
    return page;
  }

  private noteAction(sessionId: string, text: string): void {
    const entry = this.entries.get(sessionId);
    if (entry?.agent) this.updateState(entry, 'agent', { lastAction: { text, at: Date.now() } });
  }

  private async agentOpen(sessionId: string, worktreePath: string, opts: { url?: string; width?: number; height?: number }): Promise<string> {
    const entry = this.ensureEntry(sessionId, worktreePath);
    const existing = entry.agent && !entry.agent.win.isDestroyed() ? entry.agent : null;

    let url: string | null = null;
    if (opts.url) {
      const raw = opts.url.trim();
      // A path like "/settings" opens on the current page's server.
      url = raw.startsWith('/') && existing?.state.url && /^https?:/.test(existing.state.url)
        ? new URL(raw, existing.state.url).href
        : normalizeTypedUrl(raw);
      if (!url) throw new Error(`"${opts.url}" isn't a URL. Use something like http://localhost:5173/.`);
      const check = checkNavigation(url, 'agent', entry.worktreePath);
      if (!check.ok) throw new Error(check.reason);
    } else if (!existing?.state.url) {
      throw new Error('No page is open yet. Pass a url, like http://localhost:5173/.');
    }

    const page = this.ensureAgentPage(entry);
    const wc = page.win.webContents;
    if (opts.width || opts.height) {
      const width = clamp(opts.width ?? page.state.size!.width, AGENT_MIN_SIZE.width, AGENT_MAX_SIZE.width);
      const height = clamp(opts.height ?? page.state.size!.height, AGENT_MIN_SIZE.height, AGENT_MAX_SIZE.height);
      page.win.setContentSize(width, height);
      this.updateState(entry, 'agent', { size: { width, height } });
    }

    page.ensureDebugger();
    const mark = page.log.lastSeq;
    const target = url ?? page.state.url;
    this.noteAction(sessionId, url ? `Opened ${url}` : 'Reloaded the page');
    let stopWaiting: (() => void) | undefined;
    const load = url ? wc.loadURL(url) : new Promise<void>((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const fail = (_e: unknown, code: number, description: string, _u: string, isMainFrame: boolean) => {
        if (isMainFrame && code !== ERR_ABORTED) { cleanup(); reject(new Error(`${description} (${code})`)); }
      };
      const cleanup = () => { wc.off('did-finish-load', done); wc.off('did-fail-load', fail); };
      stopWaiting = cleanup;
      wc.on('did-finish-load', done);
      wc.on('did-fail-load', fail);
      wc.reload();
    });

    let timedOut = false;
    try {
      timedOut = !(await within(load, LOAD_TIMEOUT_MS));
    } catch (e) {
      const message = errorText(e);
      if (!isAborted(message)) {
        const hint = /ERR_CONNECTION_REFUSED/.test(message) ? ' Nothing is listening there. Is the dev server running?' : '';
        // A blocked redirect only shows up as ERR_FAILED; the log says why.
        throw new Error([`Couldn't load ${target}: ${message}.${hint}`, this.newProblems(page, mark)].filter(Boolean).join('\n'));
      }
      // The page moved on (a script redirect) before it finished loading.
      // Wait for wherever it went; a blocked redirect leaves it where it was.
      timedOut = !(await this.waitForStop(wc, LOAD_TIMEOUT_MS));
    } finally {
      stopWaiting?.();
    }
    await sleep(SETTLE_MS);
    const size = page.state.size!;
    const lead = timedOut
      ? `Still loading ${target} after ${LOAD_TIMEOUT_MS / 1000}s.`
      : `Opened ${page.state.url || target}${page.state.title ? ` ("${page.state.title}")` : ''} at ${size.width}×${size.height}.`;
    return [lead, this.newProblems(page, mark)].filter(Boolean).join('\n');
  }

  private async agentScreenshot(sessionId: string): Promise<PreviewScreenshot> {
    const page = this.requireAgentPage(sessionId);
    const img: NativeImage = await page.win.webContents.capturePage();
    if (img.isEmpty()) throw new Error('The page has not drawn anything yet. Try again in a moment.');
    const { width, height } = img.getSize();
    let data = img.toPNG();
    let mimeType: PreviewScreenshot['mimeType'] = 'image/png';
    if (data.length > MAX_PNG_BYTES) {
      data = img.toJPEG(80);
      mimeType = 'image/jpeg';
    }
    this.noteAction(sessionId, 'Took a screenshot');
    return { data, mimeType, width, height, url: page.state.url };
  }

  private async agentRead(sessionId: string, opts: { selector?: string; maxChars?: number }): Promise<string> {
    const page = this.requireAgentPage(sessionId);
    const maxChars = clamp(opts.maxChars ?? DEFAULT_READ_CHARS, 500, 100_000);
    const res = await page.win.webContents.executeJavaScript(readScript({ selector: opts.selector, maxChars })) as PageReadResult;
    if (!res.ok) throw new Error(res.error ?? 'Could not read the page.');
    this.noteAction(sessionId, opts.selector ? `Read ${opts.selector}` : 'Read the page');
    const parts = [`URL: ${res.url}`, `Title: ${res.title || '(none)'}`, '', res.text || '(no visible text)'];
    if (res.truncated) parts.push(`\n[Text cut at ${maxChars} characters. Pass a selector or a larger maxChars to see more.]`);
    if (res.controls.length > 0) parts.push('', 'Controls:', ...res.controls.map((c) => `- ${c}`));
    return parts.join('\n');
  }

  private agentLogs(sessionId: string, opts: { errorsOnly?: boolean; all?: boolean }): string {
    const page = this.entries.get(sessionId)?.agent;
    if (!page || page.win.isDestroyed()) throw new Error('No page is open. Open one first with preview_open.');
    let entries;
    let dropped = 0;
    if (opts.all) {
      entries = page.log.all();
      page.log.takeUnread();
    } else {
      ({ entries, dropped } = page.log.takeUnread());
    }
    const text = formatLogEntries(entries, { errorsOnly: opts.errorsOnly });
    const note = dropped > 0 ? `(${dropped} older entries were dropped before they could be read.)\n` : '';
    if (!text) return `${note}No ${opts.errorsOnly ? 'errors' : 'console or network messages'}${opts.all ? '' : ' since the last check'}.`;
    return note + text;
  }

  private async agentClick(sessionId: string, target: PreviewTarget, opts: { dialogs?: 'accept' | 'dismiss' }): Promise<string> {
    const page = this.requireAgentPage(sessionId);
    const wc = page.win.webContents;
    const mark = page.log.lastSeq;
    const found = await wc.executeJavaScript(locateScript(target, 'click')) as LocateResult;
    if (!found.ok) throw new Error(found.error);
    await this.withDialogAnswer(page, opts.dialogs, async () => {
      await this.withDebugger(wc, async (send) => {
        const at = { x: found.x, y: found.y };
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 });
      });
      this.noteAction(sessionId, `Clicked ${found.description}`);
      await this.settle(wc);
    });
    const which = found.matches > 1 ? ` (the first of ${found.matches} matches)` : '';
    return [`Clicked ${found.description}${which}.`, this.pageLine(page), this.newProblems(page, mark)].filter(Boolean).join('\n');
  }

  private async agentType(sessionId: string, target: PreviewTarget, text: string, opts: { clear?: boolean; submit?: boolean; dialogs?: 'accept' | 'dismiss' }): Promise<string> {
    const page = this.requireAgentPage(sessionId);
    const wc = page.win.webContents;
    const mark = page.log.lastSeq;
    const clear = opts.clear !== false;
    const found = await wc.executeJavaScript(locateScript(target, 'type', clear, text)) as LocateResult;
    if (!found.ok) throw new Error(found.error);
    const what = found.selected !== undefined ? `Chose "${found.selected}" in` : text ? `Typed ${JSON.stringify(text.length > 80 ? text.slice(0, 80) + '…' : text)} into` : 'Cleared';
    await this.withDialogAnswer(page, opts.dialogs, async () => {
      await this.withDebugger(wc, async (send) => {
        if (found.selected !== undefined) {
          // A <select>: the script already picked the option.
        } else if (text) {
          // Replaces the selection the script made when clearing.
          await send('Input.insertText', { text });
        } else if (clear) {
          await this.pressKey(send, 'Backspace', 8);
        }
        if (opts.submit) await this.pressKey(send, 'Enter', 13, '\r');
      });
      this.noteAction(sessionId, `${what} ${found.description}${opts.submit ? ' and pressed Enter' : ''}`);
      await this.settle(wc);
    });
    return [`${what} ${found.description}${opts.submit ? ' and pressed Enter' : ''}.`, this.pageLine(page), this.newProblems(page, mark)].filter(Boolean).join('\n');
  }

  private async pressKey(send: (method: string, params?: object) => Promise<unknown>, key: string, keyCode: number, text?: string): Promise<void> {
    const base = { key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  /** Real (trusted) input goes through the DevTools protocol, which works on
   *  an offscreen page without focus. Attached only for the action, so it
   *  doesn't hold on to the page if the user opens DevTools on it. */
  private async withDebugger<T>(wc: WebContents, fn: (send: (method: string, params?: object) => Promise<unknown>) => Promise<T>): Promise<T> {
    const dbg = wc.debugger;
    const attachedHere = !dbg.isAttached();
    if (attachedHere) dbg.attach('1.3');
    try {
      return await fn((method, params) => dbg.sendCommand(method, params));
    } finally {
      if (attachedHere && dbg.isAttached()) {
        try { dbg.detach(); } catch { /* already gone */ }
      }
    }
  }

  /** Answer dialogs the action opens as asked, then go back to OK. */
  private async withDialogAnswer(page: AgentPage, answer: 'accept' | 'dismiss' | undefined, fn: () => Promise<void>): Promise<void> {
    page.ensureDebugger();
    page.dialogAnswer = answer ?? 'accept';
    try {
      await fn();
    } finally {
      page.dialogAnswer = 'accept';
    }
  }

  /** Wait for whatever the action started: a navigation, then a short pause. */
  private async settle(wc: WebContents): Promise<void> {
    await sleep(SETTLE_MS);
    if (wc.isDestroyed() || !wc.isLoading()) return;
    await this.waitForStop(wc, LOAD_TIMEOUT_MS);
    await sleep(SETTLE_MS);
  }

  /** True once the page stops loading, false if it's still loading after `ms`. */
  private async waitForStop(wc: WebContents, ms: number): Promise<boolean> {
    if (wc.isDestroyed() || !wc.isLoading()) return true;
    let onStop: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => { onStop = resolve; wc.once('did-stop-loading', onStop); });
    try {
      return await within(stopped, ms);
    } finally {
      if (onStop && !wc.isDestroyed()) wc.off('did-stop-loading', onStop);
    }
  }

  private pageLine(page: AgentPage): string {
    return `Page: ${page.state.url}${page.state.title ? ` ("${page.state.title}")` : ''}${page.state.loading ? ' (still loading)' : ''}`;
  }

  /** Errors, dialogs and blocked loads logged since `mark`, as a short note
   *  for the action's result. */
  private newProblems(page: AgentPage, mark: number): string {
    const problems = page.log.since(mark).filter((e) => e.level === 'error' || e.kind === 'page');
    if (problems.length === 0) return '';
    const shown = problems.slice(-5);
    const more = problems.length > shown.length ? ` (last ${shown.length} shown; preview_logs has the rest)` : '';
    return `New in the page's log${more}:\n${formatLogEntries(shown)}`;
  }
}

export const previewManager = new PreviewManager();
