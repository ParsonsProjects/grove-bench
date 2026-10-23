/**
 * Preview tab state per conversation: the two pages the main process runs
 * (yours and the agent's), which one the tab shows, and local URLs spotted in the
 * conversation's output so they can be opened with one click.
 */
import type { PreviewCommand, PreviewKeyForward, PreviewPageKind, PreviewPageState } from '../../shared/types.js';
import { findLocalUrls } from '../../shared/preview-url.js';

export type PreviewMode = PreviewPageKind;

/** How many spotted URLs to keep per conversation (newest last). */
const MAX_DETECTED = 6;
/** Longest unfinished terminal line kept while waiting for its newline. */
const MAX_PARTIAL_LINE = 2000;

class PreviewStore {
  userBySession = $state<Record<string, PreviewPageState | null>>({});
  agentBySession = $state<Record<string, PreviewPageState | null>>({});
  modeBySession = $state<Record<string, PreviewMode>>({});
  detectedBySession = $state<Record<string, string[]>>({});
  /** The agent did something on its page that the user hasn't looked at yet. */
  agentUnseenBySession = $state<Record<string, boolean>>({});

  private streamTails = new Map<string, string>();
  private focusAddressHandlers = new Map<string, () => void>();
  private started = false;
  /** Whether the user is looking at the agent's page right now (set by the panel). */
  private watchingAgent = new Set<string>();

  /** Subscribe to page state and forwarded keys. Safe to call more than once. */
  init(): void {
    if (this.started) return;
    this.started = true;
    window.groveBench.onPreviewState((sessionId, page, state) => this.applyState(sessionId, page, state));
    window.groveBench.onPreviewKey((sessionId, key) => this.handleKey(sessionId, key));
    // Pages outlive a reload of Grove's UI; pick up the ones already open.
    // State pushed since subscribing is newer, so it wins.
    window.groveBench.previewGetStates().then((all) => {
      for (const [sessionId, { user, agent }] of Object.entries(all ?? {})) {
        if (user && !(sessionId in this.userBySession)) this.userBySession[sessionId] = user;
        if (agent && !(sessionId in this.agentBySession)) this.agentBySession[sessionId] = agent;
      }
    }).catch(() => { /* nothing to restore */ });
  }

  getUser(sessionId: string): PreviewPageState | null {
    return this.userBySession[sessionId] ?? null;
  }

  getAgent(sessionId: string): PreviewPageState | null {
    return this.agentBySession[sessionId] ?? null;
  }

  getMode(sessionId: string): PreviewMode {
    return this.modeBySession[sessionId] ?? 'user';
  }

  setMode(sessionId: string, mode: PreviewMode): void {
    this.modeBySession[sessionId] = mode;
  }

  getDetected(sessionId: string): string[] {
    return this.detectedBySession[sessionId] ?? [];
  }

  hasUnseenAgentActivity(sessionId: string): boolean {
    return this.agentUnseenBySession[sessionId] ?? false;
  }

  /** The panel reports whether the agent's page is on screen, which clears the
   *  unseen-activity dot and keeps it from coming back while watched. */
  setWatchingAgent(sessionId: string, watching: boolean): void {
    if (watching) {
      this.watchingAgent.add(sessionId);
      if (this.agentUnseenBySession[sessionId]) this.agentUnseenBySession[sessionId] = false;
    } else {
      this.watchingAgent.delete(sessionId);
    }
  }

  applyState(sessionId: string, page: PreviewPageKind, state: PreviewPageState | null): void {
    if (page === 'user') {
      this.userBySession[sessionId] = state;
      return;
    }
    const before = this.agentBySession[sessionId];
    this.agentBySession[sessionId] = state;
    const acted = state?.lastAction && state.lastAction.at !== before?.lastAction?.at;
    if (!acted) return;
    // The agent's first page, with nothing open on yours: show the agent's.
    if (!before?.lastAction && !this.getUser(sessionId)?.url) this.modeBySession[sessionId] = 'agent';
    if (!this.watchingAgent.has(sessionId)) this.agentUnseenBySession[sessionId] = true;
  }

  /** Load a URL in one of the pages. Rejects with the reason it isn't allowed. */
  async navigate(sessionId: string, page: PreviewPageKind, url: string): Promise<void> {
    await window.groveBench.previewNavigate(sessionId, page, url);
  }

  command(sessionId: string, page: PreviewPageKind, command: PreviewCommand): void {
    window.groveBench.previewCommand(sessionId, page, command).catch(() => { /* page may be gone */ });
  }

  /** Remember local URLs in a piece of tool output. */
  noteText(sessionId: string, text: string): void {
    if (!text || !/localhost|127\.0\.0\.1|0\.0\.0\.0|\[::/.test(text)) return;
    this.addDetected(sessionId, findLocalUrls(text));
  }

  /** Remember local URLs in streamed terminal output. Only whole lines are
   *  scanned: a chunk can end mid-URL, and scanning it would save a cut-off
   *  address like http://localhost:51/. */
  noteStream(sessionId: string, chunk: string): void {
    const text = (this.streamTails.get(sessionId) ?? '') + chunk;
    const end = text.lastIndexOf('\n') + 1;
    let partial = text.slice(end);
    if (end > 0) this.noteText(sessionId, text.slice(0, end));
    if (partial.length > MAX_PARTIAL_LINE) {
      // A line this long isn't a dev server banner; don't grow forever.
      this.noteText(sessionId, partial);
      partial = '';
    }
    this.streamTails.set(sessionId, partial);
  }

  private addDetected(sessionId: string, urls: string[]): void {
    if (urls.length === 0) return;
    const current = this.detectedBySession[sessionId] ?? [];
    const fresh = urls.filter((u) => !current.includes(u));
    if (fresh.length === 0) return;
    this.detectedBySession[sessionId] = [...current, ...fresh].slice(-MAX_DETECTED);
  }

  /** The panel registers how to focus its address bar (Ctrl+L in the page). */
  onFocusAddress(sessionId: string, handler: () => void): () => void {
    this.focusAddressHandlers.set(sessionId, handler);
    return () => {
      if (this.focusAddressHandlers.get(sessionId) === handler) this.focusAddressHandlers.delete(sessionId);
    };
  }

  private handleKey(sessionId: string, key: PreviewKeyForward): void {
    if (key.action === 'focusAddress') {
      this.focusAddressHandlers.get(sessionId)?.();
      return;
    }
    // A Grove shortcut pressed inside the page: replay it so the usual
    // window keydown handlers (tab switching, bookmarks, ...) run.
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: key.key, ctrlKey: key.ctrlKey, shiftKey: key.shiftKey, altKey: key.altKey, metaKey: key.metaKey,
      bubbles: true, cancelable: true,
    }));
  }

  /** Drop everything for a destroyed conversation. */
  forget(sessionId: string): void {
    delete this.userBySession[sessionId];
    delete this.agentBySession[sessionId];
    delete this.modeBySession[sessionId];
    delete this.detectedBySession[sessionId];
    delete this.agentUnseenBySession[sessionId];
    this.streamTails.delete(sessionId);
    this.focusAddressHandlers.delete(sessionId);
    this.watchingAgent.delete(sessionId);
  }
}

export const previewStore = new PreviewStore();
