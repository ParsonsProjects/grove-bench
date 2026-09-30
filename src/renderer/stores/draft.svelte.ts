import type { ControlDescriptor, CreateSessionOpts } from '../../shared/types.js';
import { CONTROL_IDS } from '../../shared/types.js';
import { deriveSessionName } from '../../shared/session-name.js';
import { store as sessionStore } from './sessions.svelte.js';
import { messageStore } from './messages.svelte.js';
import { arrivalScene } from './arrivalScene.svelte.js';
import { agentsStore } from './agents.svelte.js';
import { settingsStore } from './settings.svelte.js';
import { resolveBaseBranch } from '../lib/base-branch.js';
import { trackEvent } from '../lib/analytics.js';

/**
 * A new conversation before its first message. Opening one creates nothing:
 * the choices that are fixed once a conversation starts (project, agent,
 * where it runs) sit in the draft's status bar, and sending the first message
 * creates the worktree, starts the agent and sends the message.
 */

/** Where a draft conversation will run once it starts. */
export type DraftStart =
  /** A separate copy (worktree) on a new branch. An empty name starts on a
   *  placeholder branch that is renamed after the first reply. */
  | { kind: 'new'; branchName: string; baseBranch: string }
  /** A separate copy of a branch that already exists, e.g. a PR's head. */
  | { kind: 'existing'; branch: string; pr?: { number: number; title: string } }
  /** The project folder itself, on whatever branch it has checked out. */
  | { kind: 'folder' };

export interface Draft {
  repoPath: string;
  agentId: string;
  /** Model picked for this draft; '' means the agent's default model. */
  model: string;
  /** Control values picked for this draft (mode included). Controls not
   *  listed start on the saved default. */
  controls: Record<string, string>;
  start: DraftStart;
  /** The first message, as typed so far. */
  text: string;
}

export interface DraftModelOption {
  value: string;
  label: string;
}

const newBranchStart = (): DraftStart => ({ kind: 'new', branchName: '', baseBranch: '' });

/** Where a new draft in `repo` starts: a new branch, or the folder itself
 *  for a project that isn't a git repository (the only place it can run). */
const defaultStart = (repo: string): DraftStart =>
  sessionStore.isFolderProject(repo) ? { kind: 'folder' } : newBranchStart();

class DraftStore {
  draft = $state<Draft | null>(null);
  starting = $state(false);
  error = $state('');
  /** Models and controls the draft's agent offers (controls for the model
   *  the draft would start on). */
  models = $state<DraftModelOption[]>([]);
  descriptors = $state<ControlDescriptor[]>([]);

  /** The user picked a mode; picking a PR no longer switches it to Plan. */
  private modeTouched = false;
  /** Guards against an older agent-info load landing after a newer one. */
  private infoRequest = 0;

  /** Whether the main pane shows the draft: one exists and no conversation
   *  is open over it. */
  get visible(): boolean {
    return !!this.draft && !sessionStore.activeSessionId;
  }

  /**
   * Open the draft in `repoPath` (default: the open conversation's project,
   * then the first project) and show it. An existing draft keeps its message
   * and moves to that project. A new one takes its agent and model from the
   * open conversation, or `agentId` when given.
   */
  open(repoPath = '', opts: { agentId?: string } = {}): void {
    const active = sessionStore.activeSession;
    const repo = repoPath || active?.repoPath || this.draft?.repoPath || sessionStore.repos[0] || '';
    if (!repo) return;

    if (this.draft) {
      if (repo !== this.draft.repoPath) this.setRepo(repo);
      if (opts.agentId && opts.agentId !== this.draft.agentId) this.setAgent(opts.agentId);
    } else {
      const agentId = opts.agentId || active?.agentType || agentsStore.defaultId || '';
      // Same agent as the open conversation: start on its model too.
      const model = active && active.agentType === agentId ? messageStore.getModel(active.id) : '';
      this.draft = { repoPath: repo, agentId, model, controls: {}, start: defaultStart(repo), text: '' };
      this.modeTouched = false;
      this.error = '';
      void this.prefillBaseBranch(repo);
      void this.loadAgentInfo();
      void this.refreshKind(repo);
    }
    sessionStore.activeSessionId = null;
  }

  /** Bring an existing draft back into view. */
  show(): void {
    if (this.draft) sessionStore.activeSessionId = null;
  }

  discard(): void {
    this.draft = null;
    this.error = '';
    this.models = [];
    this.descriptors = [];
  }

  setText(text: string): void {
    if (this.draft) this.draft.text = text;
  }

  setRepo(repo: string): void {
    if (!this.draft || repo === this.draft.repoPath) return;
    this.draft.repoPath = repo;
    // Branches belong to the old project.
    this.resetToNewBranch();
    void this.refreshKind(repo);
  }

  /** Check what the project is now: git may have been installed, or
   *  `git init` run in a folder project, since launch. When it changed, the
   *  draft goes back to that kind of project's default start. */
  private async refreshKind(repo: string): Promise<void> {
    let kind: Awaited<ReturnType<typeof window.groveBench.repoKind>>;
    try {
      kind = await window.groveBench.repoKind(repo);
    } catch {
      return;
    }
    if (kind === 'missing') return;
    const folder = kind === 'folder';
    if (folder === sessionStore.isFolderProject(repo)) return;
    sessionStore.setFolderProject(repo, folder);
    if (this.draft?.repoPath === repo) this.resetToNewBranch();
  }

  /** Back to the default place to run: a new branch from the project's
   *  default branch. */
  resetToNewBranch(): void {
    if (!this.draft) return;
    this.setStart(defaultStart(this.draft.repoPath));
    void this.prefillBaseBranch(this.draft.repoPath);
  }

  setAgent(agentId: string): void {
    if (!this.draft || agentId === this.draft.agentId) return;
    this.draft.agentId = agentId;
    // Models and controls are the agent's own.
    this.draft.model = '';
    this.draft.controls = {};
    this.modeTouched = false;
    void this.loadAgentInfo();
  }

  setModel(model: string): void {
    if (!this.draft || model === this.effectiveModel) return;
    this.draft.model = model;
    void this.loadAgentInfo({ keepModels: true });
  }

  setControl(controlId: string, value: string): void {
    if (!this.draft) return;
    this.draft.controls = { ...this.draft.controls, [controlId]: value };
    if (controlId === CONTROL_IDS.permissionMode) this.modeTouched = true;
  }

  setStart(start: DraftStart): void {
    if (!this.draft) return;
    this.draft.start = start;
    this.applyAutoMode();
  }

  /** Opening a PR is usually a review: start it in Plan mode unless the user
   *  chose a mode themselves. Anything else goes back to the default. Runs
   *  again once the agent's modes load, and after the agent changes. */
  private applyAutoMode(): void {
    const d = this.draft;
    if (!d || this.modeTouched) return;
    const { [CONTROL_IDS.permissionMode]: _mode, ...rest } = d.controls;
    const plan = d.start.kind === 'existing' && !!d.start.pr && this.offers(CONTROL_IDS.permissionMode, 'plan');
    d.controls = plan ? { ...rest, [CONTROL_IDS.permissionMode]: 'plan' } : rest;
  }

  /** The model the draft would start on. */
  get effectiveModel(): string {
    const d = this.draft;
    if (!d) return '';
    return d.model || settingsStore.current.defaultModels?.[d.agentId] || this.models[0]?.value || '';
  }

  /** A control's value as the draft would start: picked, saved default, or
   *  the control's own default. */
  controlValue(controlId: string): string {
    const d = this.draft;
    const descriptor = this.descriptors.find((c) => c.id === controlId);
    if (!d || !descriptor) return '';
    const offered = (v: string | undefined): v is string => !!v && descriptor.options.some((o) => o.value === v);
    const picked = d.controls[controlId];
    if (offered(picked)) return picked;
    const saved = settingsStore.current.adapterDefaults?.[d.agentId]?.[controlId];
    return offered(saved) ? saved : descriptor.default;
  }

  private offers(controlId: string, value: string): boolean {
    return !!this.descriptors.find((c) => c.id === controlId)?.options.some((o) => o.value === value);
  }

  private async prefillBaseBranch(repo: string): Promise<void> {
    // A folder without git has no branches to start from.
    if (sessionStore.isFolderProject(repo)) return;
    const base = await resolveBaseBranch(repo);
    const d = this.draft;
    if (d && d.repoPath === repo && d.start.kind === 'new' && !d.start.baseBranch) {
      d.start = { ...d.start, baseBranch: base };
    }
  }

  /** Load the agent's models and its controls for the effective model. */
  async loadAgentInfo(opts: { keepModels?: boolean } = {}): Promise<void> {
    const request = ++this.infoRequest;
    if (!this.draft) return;
    if (!this.draft.agentId) {
      await agentsStore.load();
      if (this.draft && !this.draft.agentId) this.draft.agentId = agentsStore.defaultId ?? '';
    }
    const agentId = this.draft?.agentId;
    if (!agentId) return;
    try {
      if (!opts.keepModels) {
        const models = await window.groveBench.getModels(agentId);
        if (request !== this.infoRequest) return;
        this.models = models.map((m) => ({ value: m.id, label: m.label }));
      }
      const descriptors = await window.groveBench.getAdapterControls(agentId, this.effectiveModel || null);
      if (request !== this.infoRequest) return;
      this.descriptors = descriptors;
      // Drop picks the new model doesn't offer.
      if (this.draft) {
        const kept = Object.entries(this.draft.controls).filter(([id, v]) => this.offers(id, v));
        this.draft.controls = Object.fromEntries(kept);
        this.applyAutoMode();
      }
    } catch (e) {
      console.warn('[draft] could not load the agent\'s models and controls:', e);
    }
  }

  /** The create options for the draft. Only what the user picked is sent;
   *  everything else starts on main's defaults, as before. */
  buildOpts(d: Draft, baseBranch: string): CreateSessionOpts {
    const { [CONTROL_IDS.permissionMode]: mode, ...others } = d.controls;
    const base = {
      repoPath: d.repoPath,
      ...(d.agentId ? { adapterType: d.agentId } : {}),
      ...(d.model ? { model: d.model } : {}),
      ...(Object.keys(others).length > 0 ? { controls: others } : {}),
      ...(mode ? { permissionMode: mode as CreateSessionOpts['permissionMode'] } : {}),
    };
    switch (d.start.kind) {
      case 'folder':
        return { ...base, branchName: '', direct: true };
      case 'existing':
        return { ...base, branchName: d.start.branch, useExisting: true };
      case 'new':
        return { ...base, branchName: d.start.branchName.trim(), baseBranch: baseBranch || undefined };
    }
  }

  /** Create the conversation and send the draft's message as its first turn.
   *  Returns whether it started; on failure the draft stays with the error. */
  async start(): Promise<boolean> {
    const draft = this.draft;
    if (!draft || this.starting) return false;
    // A copy: the pickers stay usable while this awaits, and changes made
    // meanwhile must not leak into the conversation being created.
    const d = $state.snapshot(draft) as Draft;
    if (d.start.kind === 'existing' && !d.start.branch) return false;
    if (!sessionStore.repos.includes(d.repoPath)) {
      this.error = 'This project was removed. Pick another project in the bar below.';
      return false;
    }
    this.starting = true;
    this.error = '';
    const text = d.text.trim();
    try {
      // No base picked yet (still resolving, or cleared): use the project's
      // default rather than whatever the project folder has checked out.
      const baseBranch = d.start.kind === 'new'
        ? (d.start.baseBranch.trim() || await resolveBaseBranch(d.repoPath))
        : '';
      const opts = this.buildOpts(d, baseBranch);
      const result = await window.groveBench.createSession(opts);
      const mode = d.start.kind === 'folder' ? 'direct' : d.start.kind;
      trackEvent('session_created', {
        mode,
        withPrompt: !!text,
        ...(d.start.kind === 'new' ? { autoBranch: !opts.branchName } : {}),
        ...(d.start.kind === 'existing' ? { picked: d.start.pr ? 'pr' : 'branch' } : {}),
        ...(opts.permissionMode ? { startMode: opts.permissionMode } : {}),
      });
      const direct = d.start.kind === 'folder';
      // Name the row from the message straight away; the automatic name
      // replaces it after the first reply.
      const placeholderName = text ? deriveSessionName(text) : null;
      sessionStore.addSession({
        id: result.id,
        branch: result.branch,
        repoPath: d.repoPath,
        // Direct sessions are ready immediately; worktree sessions go through
        // starting → installing → running.
        status: direct ? 'running' : 'starting',
        agentType: result.agentType,
        createdAt: Date.now(),
        ...(direct ? { direct: true } : {}),
        ...(result.noGit ? { noGit: true } : {}),
        ...(placeholderName ? { displayName: placeholderName } : {}),
      });
      // Main holds a prompt sent during setup until the agent is ready.
      if (text) {
        // The chat shows the agent walking to its bench until the first reply.
        arrivalScene.begin(result.id);
        messageStore.addUserMessage(result.id, text);
        window.groveBench.sendMessage(result.id, text);
        sessionStore.updateLastActive(result.id);
      }
      // Discarded (and maybe replaced by a new draft) while this ran: leave
      // the new one alone.
      if (this.draft === draft) this.discard();
      return true;
    } catch (e: any) {
      this.error = e?.message || String(e);
      return false;
    } finally {
      this.starting = false;
    }
  }
}

export const draftStore = new DraftStore();
