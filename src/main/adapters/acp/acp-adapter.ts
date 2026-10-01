/**
 * An agent that speaks the Agent Client Protocol (ACP, version 1) over stdio:
 * Gemini CLI (`gemini --acp`), GitHub Copilot CLI (`copilot --acp`), or any
 * agent the user adds in settings. One adapter instance per agent definition.
 * https://agentclientprotocol.com
 *
 * Grove is the ACP client. Per conversation query it starts the agent,
 * initializes, creates (or resumes) a session in the worktree and turns the
 * agent's `session/update` notifications into Grove events. The agent asks
 * before running tools with `session/request_permission`; Grove answers from
 * its rules, the conversation's mode, or the user. Grove advertises no file
 * system or terminal capability, so the agent works on the worktree itself.
 *
 * Grove's permission modes are applied here, on the client side, because
 * they work on the permission requests: Ask puts every request to the user,
 * Edit approves file edits inside the worktree, Read-safe also approves
 * read-only calls (session-permissions.ts). The agent's own modes (Gemini's
 * Auto Edit, YOLO, Plan, ...) are a separate control.
 */
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execa, type ResultPromise } from 'execa';
import type {
  AdapterConfig, AdapterEvent, AdapterPrerequisiteStatus, AgentAdapter, AgentCapabilities, AgentQueryHandle,
  CliSignInDescriptor, ModelInfo, PermissionResponse, UserMessage,
} from '../types.js';
import type { ControlDescriptor, ControlOption, PermissionMode, ImageMediaType } from '../../../shared/types.js';
import { CONTROL_IDS } from '../../../shared/types.js';
import { checkToolRules, cleanEnv, isPathInside } from '../../agent-utils.js';
import { logger } from '../../logger.js';
import { loadModelCatalog, saveModelCatalog } from '../../app-state.js';
import { memoryServer, previewServer, type GroveServer } from '../grove-tools.js';
import { startGroveMcpHttp, type GroveMcpHttp } from '../grove-mcp-http.js';
import { JsonRpcConnection, JsonRpcError, RPC_ERRORS } from './rpc.js';
import {
  ACP_PROTOCOL_VERSION,
  type AcpConfigOption, type AcpInitializeResponse, type AcpMcpServer, type AcpModeState, type AcpModelState,
  type AcpPermissionOutcome, type AcpPermissionRequest, type AcpPlanEntry, type AcpSessionSetup, type AcpSessionUpdate,
  type AcpStopReason, type AcpToolCall,
} from './protocol.js';
import {
  AGENT_MODE_CONTROL, agentControls, categoryForKind, configIdForControl, contentImages, contentText, firstText,
  mergeToolCall, modelList, pickPermissionOption, planSummary, planText, specifierFor, toolNameFor, toolViewFor,
  type AcpModelList,
} from './mapping.js';

/** An ACP agent Grove can start. */
export interface AcpAgentDefinition {
  /** Adapter id, stable across launches (conversations record it). */
  id: string;
  displayName: string;
  /** Program to run, found on PATH. */
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** How the user signs in with the agent's own CLI, when it has one. */
  cliSignIn?: CliSignInDescriptor;
  /** Shown when the program isn't found. */
  installInstructions?: string;
}

/** How long the agent gets to answer `initialize` and set up a session. */
const STARTUP_TIMEOUT_MS = 60_000;
/** How long to wait for the agent's slash commands, which agents send just
 *  after the session starts, before telling Grove the session is ready. */
const COMMANDS_WAIT_MS = 300;
/** How much of the agent's stderr is kept for error messages. */
const STDERR_TAIL_CHARS = 4_000;
const IMAGE_MEDIA: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const MODE_OPTIONS: ControlOption[] = [
  { value: 'default', label: 'Ask', tone: 'info', description: 'Check with you whenever the agent asks to run something' },
  { value: 'acceptEdits', label: 'Edit', tone: 'accent', description: 'Approve file edits inside the worktree; everything else still asks' },
  { value: 'readSafe', label: 'Read-safe', tone: 'success', group: 'Grove Bench', description: 'Approve edits and read-only commands inside the worktree; everything else asks' },
];

/** What a conversation taught us about the agent, kept for the next launch. */
interface LearnedAgent {
  models: AcpModelList['models'];
  controls: ControlDescriptor[];
}

/** A push-based async iterable: the adapter pushes events as they arrive. */
class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiting: ((r: IteratorResult<T>) => void) | null = null;
  private ended = false;

  push(item: T): void {
    if (this.ended) return;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: undefined as never, done: true });
    }
  }

  get isEnded(): boolean {
    return this.ended;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => { this.waiting = resolve; });
      },
      return: () => {
        this.end();
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export class AcpAdapter implements AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly authErrorMessage: string;
  readonly cliSignIn?: CliSignInDescriptor;
  readonly capabilities: AgentCapabilities = {
    permissions: true,
    permissionModes: true,
    // Resuming needs session/resume or session/load from the agent; start()
    // falls back to a new session (and says so) when it has neither.
    resume: true,
    rewind: false,
    modelSwitching: true,
    thinking: false,
    plugins: false,
    skills: false,
    usage: false,
    // Sent only when the agent says it takes images (promptCapabilities).
    imageAttachments: true,
    structuredOutput: false,
    sandbox: false,
  };

  private learned: LearnedAgent | null | undefined;
  private modelListeners = new Set<() => void>();
  /** Titles the agent gave its sessions (session_info_update). */
  private titles = new Map<string, string>();

  constructor(private readonly def: AcpAgentDefinition) {
    this.id = def.id;
    this.displayName = def.displayName;
    this.cliSignIn = def.cliSignIn;
    this.authErrorMessage = def.cliSignIn
      ? `${def.displayName} needs you to sign in. Run "${def.cliSignIn.command}" in a terminal, sign in, then try again.`
      : `${def.displayName} needs you to sign in. Sign in with its own command line tool, then try again.`;
  }

  // ─── What the agent offers (learned from its sessions) ───

  private learnedAgent(): LearnedAgent | null {
    if (this.learned === undefined) {
      try {
        const raw = loadModelCatalog(this.id)?.[0] as LearnedAgent | undefined;
        this.learned = raw && Array.isArray(raw.models) && Array.isArray(raw.controls) ? raw : null;
      } catch {
        this.learned = null;
      }
    }
    return this.learned;
  }

  /** Record what a session reported. Listeners hear only real changes. */
  private learn(configOptions: AcpConfigOption[] | null | undefined, modes: AcpModeState | null | undefined, models: AcpModelState | null | undefined): void {
    const next: LearnedAgent = {
      models: modelList(configOptions, models)?.models ?? this.learnedAgent()?.models ?? [],
      controls: agentControls(configOptions, modes),
    };
    if (JSON.stringify(next) === JSON.stringify(this.learnedAgent())) return;
    this.learned = next;
    try {
      saveModelCatalog(this.id, [next]);
    } catch (e) {
      logger.warn(`[${this.id}] could not save what the agent offers:`, e);
    }
    for (const l of this.modelListeners) l();
  }

  getModels(): ModelInfo[] {
    return (this.learnedAgent()?.models ?? []).map((m) => ({ id: m.id, label: m.label }));
  }

  onModelsChanged(listener: () => void): () => void {
    this.modelListeners.add(listener);
    return () => this.modelListeners.delete(listener);
  }

  getControls(): ControlDescriptor[] {
    return [
      { id: CONTROL_IDS.permissionMode, label: 'Mode', options: MODE_OPTIONS, default: 'default' },
      ...(this.learnedAgent()?.controls ?? []),
    ];
  }

  async getConversationTitle(providerSessionId: string): Promise<string | null> {
    return this.titles.get(providerSessionId) ?? null;
  }

  // ─── Install check ───

  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> {
    const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
    try {
      const { stdout, exitCode } = await execa(lookup, [this.def.command], { reject: false, timeout: 10_000, windowsHide: true });
      const found = exitCode === 0 ? String(stdout).trim().split(/\r?\n/)[0] : '';
      if (found) {
        // Signing in happens in the agent's own CLI and is only reported when
        // a session starts (an auth_required error), so it can't be checked here.
        return { available: true, path: found, authenticated: true };
      }
    } catch {
      // fall through
    }
    return {
      available: false,
      authenticated: false,
      errorMessage: `${this.displayName} not found (looked for "${this.def.command}")`,
      ...(this.def.installInstructions ? { installInstructions: this.def.installInstructions } : {}),
    };
  }

  // ─── One-shot text (commit messages, branch names, memory notes) ───

  /** Ask the agent once, in a session of its own, with every tool request
   *  turned down. ACP has no system prompt, so it leads the message. */
  async generateText(systemPrompt: string, userMessage: string, options?: { cwd?: string; abortSignal?: AbortSignal; model?: string }): Promise<string> {
    const proc = execa(this.def.command, this.def.args, {
      cwd: options?.cwd ?? os.tmpdir(),
      env: { ...cleanEnv(process.env), ...(this.def.env ?? {}) } as Record<string, string>,
      extendEnv: false,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
      buffer: false,
      reject: false,
      windowsHide: true,
      cleanup: true,
    });
    let sessionId: string | null = null;
    let text = '';
    const rpc = new JsonRpcConnection(proc.stdout!, proc.stdin!, {
      onRequest: async (method, params) => {
        if (method !== 'session/request_permission') throw new JsonRpcError(RPC_ERRORS.methodNotFound, `Not supported: ${method}`);
        const option = pickPermissionOption((params as AcpPermissionRequest)?.options ?? [], 'deny');
        return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } };
      },
      onNotification: (method, params) => {
        const p = params as { sessionId?: string; update?: AcpSessionUpdate } | null;
        if (method !== 'session/update' || !sessionId || p?.sessionId !== sessionId) return;
        const u = p.update;
        if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') text += u.content.text;
      },
    });
    const abort = () => {
      rpc.close(new Error('Aborted'));
      proc.kill();
    };
    options?.abortSignal?.addEventListener('abort', abort, { once: true });
    try {
      const init = await withTimeout(rpc.request<AcpInitializeResponse>('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: {}, clientInfo: { name: 'grove-bench', title: 'Grove Bench' },
      }), STARTUP_TIMEOUT_MS, `${this.displayName} start-up`);
      if (init?.protocolVersion !== ACP_PROTOCOL_VERSION) throw new Error(`${this.displayName} speaks ACP version ${init?.protocolVersion}`);
      const setup = await withTimeout(rpc.request<AcpSessionSetup>('session/new', { cwd: options?.cwd ?? os.tmpdir(), mcpServers: [] }), STARTUP_TIMEOUT_MS, `${this.displayName} session start`);
      if (!setup?.sessionId) throw new Error(`${this.displayName} did not start a session`);
      sessionId = setup.sessionId;
      const models = modelList(setup.configOptions, setup.models);
      if (options?.model && models && models.current !== options.model && models.models.some((m) => m.id === options.model)) {
        await (models.via === 'set_model'
          ? rpc.request('session/set_model', { sessionId, modelId: options.model })
          : rpc.request('session/set_config_option', { sessionId, configId: models.via.configId, value: options.model })
        ).catch((e) => logger.warn(`[${this.id}] background model not set:`, e));
      }
      await rpc.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: `${systemPrompt}\n\n${userMessage}` }] });
      return text.trim();
    } finally {
      options?.abortSignal?.removeEventListener('abort', abort);
      rpc.close();
      if (proc.exitCode === null) proc.kill();
    }
  }

  // ─── A conversation query ───

  async start(config: AdapterConfig): Promise<AgentQueryHandle> {
    return new AcpQuery(this, this.def, config, {
      learn: (c, m, models) => this.learn(c, m, models),
      setTitle: (sessionId, title) => { this.titles.set(sessionId, title); },
      currentModels: () => this.learnedAgent()?.models ?? [],
    }).handle();
  }
}

interface AdapterHooks {
  learn(configOptions: AcpConfigOption[] | null | undefined, modes: AcpModeState | null | undefined, models: AcpModelState | null | undefined): void;
  setTitle(sessionId: string, title: string): void;
  currentModels(): AcpModelList['models'];
}

/** One running agent process and its session. */
class AcpQuery {
  private readonly events = new EventQueue<AdapterEvent>();
  private proc: ResultPromise | null = null;
  private rpc: JsonRpcConnection | null = null;
  private mcp: GroveMcpHttp | null = null;
  private init: AcpInitializeResponse | null = null;
  private sessionId: string | null = null;
  private configOptions: AcpConfigOption[] = [];
  private modes: AcpModeState | null = null;
  private models: AcpModelList | null = null;
  private commands: string[] = [];
  private commandsSeen!: () => void;
  private readonly commandsArrived = new Promise<void>((resolve) => { this.commandsSeen = resolve; });
  private stderrTail = '';
  private closing = false;
  /** session/load replays the conversation; Grove has its own copy. */
  private replaying = false;
  private groveMode: PermissionMode;
  /** Grove's instructions (path rules, project memory, the user's own),
   *  sent ahead of the first prompt of a new session: ACP has no system
   *  prompt. A resumed session already has them. */
  private pendingInstructions: string | null = null;

  private readonly ready: Promise<boolean>;
  private queue: UserMessage[] = [];
  private promptInFlight: Promise<void> | null = null;
  private turns = 0;

  // Per turn
  private tools = new Map<string, AcpToolCall>();
  /** Tool calls reported to Grove and not yet finished. */
  private openTools = new Set<string>();
  private text = { kind: null as 'text' | 'thinking' | null, buffer: '', messageId: null as string | null };
  private planCallId: string | null = null;
  private contextSize: number | undefined;
  /** Permission requests waiting on the user; answered "cancelled" on interrupt. */
  private pendingPermissions = new Set<(outcome: AcpPermissionOutcome) => void>();

  constructor(
    private readonly adapter: AcpAdapter,
    private readonly def: AcpAgentDefinition,
    private readonly config: AdapterConfig,
    private readonly hooks: AdapterHooks,
  ) {
    this.groveMode = config.permissionMode;
    this.ready = this.setUp().then(
      () => true,
      (e) => {
        this.fail(e);
        return false;
      },
    );
  }

  handle(): AgentQueryHandle {
    return {
      events: this.events,
      sendMessage: (message) => this.enqueue(message),
      abort: () => { void this.shutdown(); },
      close: () => { void this.shutdown(); },
      interrupt: () => this.interrupt(),
      getSessionId: () => this.sessionId,
      closeInput: () => { /* prompts are sent one at a time; nothing to close */ },
      processId: () => (this.proc && this.proc.exitCode === null ? this.proc.pid : undefined),
      setModel: (model) => this.setModel(model),
      setPermissionMode: (mode) => { this.groveMode = mode; },
      setControl: (id, value) => this.setControl(id, value),
    };
  }

  private emit(event: AdapterEvent): void {
    if (!this.replaying) this.events.push(event);
  }

  // ─── Start-up ───

  private async setUp(): Promise<void> {
    const { config, def } = this;
    const env = {
      ...cleanEnv(process.env),
      ...(def.env ?? {}),
      ...(config.extraEnv ?? {}),
    } as Record<string, string>;
    const proc = execa(def.command, def.args, {
      cwd: config.cwd,
      env,
      extendEnv: false,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      buffer: false,
      reject: false,
      windowsHide: true,
      cleanup: true,
    });
    this.proc = proc;
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
    });
    void proc.then((result) => this.onExit(result.exitCode, result.failed ? result.message : undefined));

    if (!proc.stdout || !proc.stdin) throw new Error(`Could not start ${def.displayName}`);
    this.rpc = new JsonRpcConnection(proc.stdout, proc.stdin, {
      onRequest: (method, params) => this.onAgentRequest(method, params),
      onNotification: (method, params) => this.onAgentNotification(method, params),
      onBadLine: (line) => logger.debug(`[${def.id}] non-protocol output: ${line.slice(0, 200)}`),
    });

    // No fs or terminal capability: the agent reads, writes and runs commands
    // in the worktree itself, so its own tools and permission requests apply.
    const init = await withTimeout(this.rpc.request<AcpInitializeResponse>('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: 'grove-bench', title: 'Grove Bench' },
    }), STARTUP_TIMEOUT_MS, `${def.displayName} start-up`);
    if (init?.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new Error(`${def.displayName} speaks ACP version ${init?.protocolVersion}; Grove Bench speaks version ${ACP_PROTOCOL_VERSION}.`);
    }
    this.init = init;

    const mcpServers = await this.groveMcpServers();
    await withTimeout(this.openSession(mcpServers), STARTUP_TIMEOUT_MS, `${def.displayName} session start`);
    await this.applyStartingChoices();
    await Promise.race([this.commandsArrived, new Promise((resolve) => setTimeout(resolve, COMMANDS_WAIT_MS))]);

    this.emit({
      type: 'system_init',
      sessionId: this.sessionId!,
      model: this.models?.current ?? config.model ?? '',
      tools: [],
      slashCommands: this.commands,
      ...(this.mcp ? { mcpServers: this.mcp.endpoints.map((e) => ({ name: e.name, status: 'connected' })) } : {}),
    });
  }

  /** Grove's memory and Preview tools, served for agents that connect to MCP
   *  servers over HTTP (an ACP option every agent must declare). */
  private async groveMcpServers(): Promise<AcpMcpServer[]> {
    const servers: GroveServer[] = [];
    if (this.config.memoryOperations) servers.push(memoryServer(this.config.memoryOperations));
    if (this.config.previewOperations) servers.push(previewServer(this.config.previewOperations));
    if (servers.length === 0) return [];
    if (!this.init?.agentCapabilities?.mcpCapabilities?.http) {
      logger.info(`[${this.def.id}] agent can't connect to MCP servers over HTTP; Grove's memory and Preview tools are not offered`);
      return [];
    }
    this.mcp = await startGroveMcpHttp(servers);
    return this.mcp.endpoints.map((e) => ({ type: 'http', name: e.name, url: e.url, headers: e.headers }));
  }

  private async openSession(mcpServers: AcpMcpServer[]): Promise<void> {
    const rpc = this.rpc!;
    const { cwd, resumeSessionId } = this.config;
    const caps = this.init?.agentCapabilities;
    if (resumeSessionId) {
      try {
        if (caps?.sessionCapabilities?.resume) {
          this.takeSetup(await rpc.request<AcpSessionSetup>('session/resume', { sessionId: resumeSessionId, cwd, mcpServers }));
          this.sessionId = resumeSessionId;
          return;
        }
        if (caps?.loadSession) {
          this.replaying = true;
          try {
            this.takeSetup(await rpc.request<AcpSessionSetup>('session/load', { sessionId: resumeSessionId, cwd, mcpServers }));
          } finally {
            this.replaying = false;
          }
          this.sessionId = resumeSessionId;
          return;
        }
        this.emit({ type: 'status', level: 'warning', message: `${this.def.displayName} can't reopen earlier conversations, so it starts a new one. The thread above stays, but the agent won't remember it.` });
      } catch (e) {
        if (e instanceof JsonRpcError && e.code === RPC_ERRORS.authRequired) throw e;
        logger.warn(`[${this.def.id}] resume failed:`, e);
        this.emit({ type: 'status', level: 'warning', message: `${this.def.displayName} couldn't reopen this conversation, so it starts a new one. The thread above stays, but the agent won't remember it.` });
      }
    }
    const setup = await rpc.request<AcpSessionSetup>('session/new', { cwd, mcpServers });
    if (!setup?.sessionId) throw new Error(`${this.def.displayName} did not start a session`);
    this.sessionId = setup.sessionId;
    this.takeSetup(setup);
    this.pendingInstructions = this.instructions();
  }

  private instructions(): string | null {
    const text = this.config.customSystemPrompt || this.config.appendSystemPrompt;
    return text?.trim() ? `Instructions from Grove Bench, the app running this conversation:\n\n${text.trim()}` : null;
  }

  private takeSetup(setup: AcpSessionSetup | null | undefined): void {
    if (!setup) return;
    if (Array.isArray(setup.configOptions)) this.configOptions = setup.configOptions;
    if (setup.modes) this.modes = setup.modes;
    this.models = modelList(this.configOptions, setup.models);
    this.hooks.learn(this.configOptions, this.modes, setup.models);
  }

  /** Apply the conversation's model and control values where they differ
   *  from what the agent started with. */
  private async applyStartingChoices(): Promise<void> {
    const { model, controls } = this.config;
    if (model && this.models && model !== this.models.current && this.models.models.some((m) => m.id === model)) {
      await this.setModel(model).catch((e) => logger.warn(`[${this.def.id}] could not set model ${model}:`, e));
    }
    for (const [id, value] of Object.entries(controls ?? {})) {
      if (id === CONTROL_IDS.permissionMode) continue;
      await this.setControl(id, value).catch((e) => logger.warn(`[${this.def.id}] could not set ${id}=${value}:`, e));
    }
  }

  private fail(e: unknown): void {
    if (this.closing) return;
    const auth = e instanceof JsonRpcError && e.code === RPC_ERRORS.authRequired;
    const message = auth ? this.adapter.authErrorMessage
      : `${e instanceof Error ? e.message : String(e)}${this.stderrTail.trim() ? `\n${this.stderrTail.trim().slice(-800)}` : ''}`;
    logger.error(`[${this.def.id}] ${message}`);
    this.events.push({ type: 'error', message });
    void this.shutdown();
  }

  private onExit(exitCode: number | undefined, failure?: string): void {
    this.rpc?.close(new Error(`${this.def.displayName} exited`));
    if (this.closing) return;
    const detail = failure ?? `exited with code ${exitCode ?? 'unknown'}`;
    const stderr = this.stderrTail.trim();
    this.events.push({ type: 'error', message: `${this.def.displayName} ${detail}${stderr ? `\n${stderr.slice(-800)}` : ''}` });
    void this.shutdown();
  }

  async shutdown(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    for (const answer of this.pendingPermissions) answer({ outcome: { outcome: 'cancelled' } });
    this.pendingPermissions.clear();
    this.rpc?.close();
    if (this.proc && this.proc.exitCode === null) this.proc.kill();
    await this.mcp?.close().catch(() => {});
    this.events.end();
  }

  // ─── Prompts ───

  private enqueue(message: UserMessage): void {
    this.queue.push(message);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.promptInFlight || !(await this.ready)) return;
    const next = this.queue.shift();
    if (!next) return;
    this.promptInFlight = this.runTurn(next).finally(() => {
      this.promptInFlight = null;
      void this.drain();
    });
  }

  private async runTurn(message: UserMessage): Promise<void> {
    if (message.text.trim() === '/clear' && !message.images?.length) {
      await this.clear();
      return;
    }
    const started = Date.now();
    this.turns++;
    this.resetTurn();
    let stopReason: AcpStopReason | null = null;
    let error: string | null = null;
    try {
      const res = await this.rpc!.request<{ stopReason: AcpStopReason }>('session/prompt', {
        sessionId: this.sessionId,
        prompt: this.promptBlocks(message),
      });
      stopReason = res?.stopReason ?? 'end_turn';
    } catch (e) {
      if (this.closing) return;
      error = e instanceof JsonRpcError && e.code === RPC_ERRORS.authRequired ? this.adapter.authErrorMessage
        : e instanceof Error ? e.message : String(e);
    }
    this.flushText();
    this.finishOpenTools(stopReason === 'cancelled' ? 'Cancelled' : error ? 'The turn ended with an error' : '');
    const failed = error !== null || stopReason === 'refusal' || stopReason === 'max_tokens' || stopReason === 'max_turn_requests';
    const reason = error
      ?? (stopReason === 'refusal' ? `${this.def.displayName} refused to continue.`
        : stopReason === 'max_tokens' ? `${this.def.displayName} hit its output token limit.`
          : stopReason === 'max_turn_requests' ? `${this.def.displayName} hit its limit of model requests for one turn.`
            : null);
    this.emit({
      type: 'result',
      subtype: stopReason === 'max_turn_requests' ? 'error_max_turns' : failed ? 'error_during_execution' : 'success',
      isError: failed,
      ...(reason ? { errors: [reason] } : {}),
      durationMs: Date.now() - started,
      numTurns: this.turns,
      ...(this.contextSize ? { contextWindow: this.contextSize } : {}),
    });
  }

  private promptBlocks(message: UserMessage): unknown[] {
    const blocks: unknown[] = [];
    if (this.pendingInstructions) {
      blocks.push({ type: 'text', text: this.pendingInstructions });
      this.pendingInstructions = null;
    }
    blocks.push({ type: 'text', text: message.text });
    const takesImages = this.init?.agentCapabilities?.promptCapabilities?.image === true;
    for (const img of message.images ?? []) {
      if (takesImages && IMAGE_MEDIA.has(img.mediaType)) blocks.push({ type: 'image', data: img.data, mimeType: img.mediaType });
    }
    if (!takesImages && message.images?.length) {
      this.emit({ type: 'status', level: 'warning', message: `${this.def.displayName} can't take images, so the attached image${message.images.length > 1 ? 's were' : ' was'} left out.` });
    }
    return blocks;
  }

  /** /clear: a new session in the same process. */
  private async clear(): Promise<void> {
    try {
      const setup = await this.rpc!.request<AcpSessionSetup>('session/new', {
        cwd: this.config.cwd,
        mcpServers: this.mcp ? this.mcp.endpoints.map((e) => ({ type: 'http', name: e.name, url: e.url, headers: e.headers })) : [],
      });
      if (!setup?.sessionId) throw new Error(`${this.def.displayName} did not start a session`);
      this.sessionId = setup.sessionId;
      this.takeSetup(setup);
      this.pendingInstructions = this.instructions();
      this.turns = 0;
      this.emit({ type: 'system_init', sessionId: this.sessionId, model: this.models?.current ?? this.config.model ?? '', tools: [], slashCommands: this.commands });
      this.emit({ type: 'result', subtype: 'success', isError: false, numTurns: 0 });
    } catch (e) {
      this.emit({ type: 'result', subtype: 'error_during_execution', isError: true, errors: [e instanceof Error ? e.message : String(e)] });
    }
  }

  private async interrupt(): Promise<void> {
    if (!this.sessionId || !this.rpc) return;
    // The protocol asks clients to answer waiting permission requests first.
    for (const answer of this.pendingPermissions) answer({ outcome: { outcome: 'cancelled' } });
    this.pendingPermissions.clear();
    this.rpc.notify('session/cancel', { sessionId: this.sessionId });
    const inFlight = this.promptInFlight;
    if (inFlight) await withTimeout(inFlight, 10_000, 'Stopping the turn').catch(() => { /* turn result reports it */ });
  }

  // ─── Model and controls ───

  private async setModel(model: string): Promise<void> {
    if (!this.rpc || !this.sessionId) return;
    const via = this.models?.via;
    if (!via) throw new Error(`${this.def.displayName} has no models to choose from`);
    if (via === 'set_model') {
      await this.rpc.request('session/set_model', { sessionId: this.sessionId, modelId: model });
      if (this.models) this.models = { ...this.models, current: model };
      return;
    }
    const res = await this.rpc.request<{ configOptions?: AcpConfigOption[] }>('session/set_config_option', {
      sessionId: this.sessionId, configId: via.configId, value: model,
    });
    this.takeConfigOptions(res?.configOptions);
  }

  private async setControl(controlId: string, value: string): Promise<void> {
    if (!this.rpc || !this.sessionId || !controlId.startsWith('acp:')) return;
    const configId = configIdForControl(controlId, this.configOptions);
    if (configId) {
      const current = this.configOptions.find((o) => o.id === configId)?.currentValue;
      if (current === value) return;
      const res = await this.rpc.request<{ configOptions?: AcpConfigOption[] }>('session/set_config_option', {
        sessionId: this.sessionId, configId, value,
      });
      this.takeConfigOptions(res?.configOptions);
      return;
    }
    if (controlId === AGENT_MODE_CONTROL && this.modes) {
      if (this.modes.currentModeId === value) return;
      await this.rpc.request('session/set_mode', { sessionId: this.sessionId, modeId: value });
      this.modes = { ...this.modes, currentModeId: value };
    }
  }

  private takeConfigOptions(options: AcpConfigOption[] | null | undefined): void {
    if (!Array.isArray(options)) return;
    this.configOptions = options;
    this.models = modelList(options, null) ?? this.models;
    this.hooks.learn(options, this.modes, null);
  }

  // ─── Agent → Grove ───

  private async onAgentRequest(method: string, params: unknown): Promise<unknown> {
    if (method === 'session/request_permission') return this.onPermission(params as AcpPermissionRequest);
    // Grove advertised no fs, terminal or elicitation capability.
    throw new JsonRpcError(RPC_ERRORS.methodNotFound, `Grove Bench does not support ${method}`);
  }

  private onAgentNotification(method: string, params: unknown): void {
    if (method !== 'session/update') return;
    const p = params as { sessionId?: string; update?: AcpSessionUpdate } | null;
    if (!p?.update || (this.sessionId && p.sessionId !== this.sessionId)) return;
    try {
      this.onUpdate(p.update);
    } catch (e) {
      logger.warn(`[${this.def.id}] bad session/update:`, e);
    }
  }

  private onUpdate(update: AcpSessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        if (update.content?.type !== 'text' || !update.content.text) return;
        const kind = update.sessionUpdate === 'agent_message_chunk' ? 'text' : 'thinking';
        const messageId = update.messageId ?? null;
        if (this.text.kind !== kind || (messageId && this.text.messageId && messageId !== this.text.messageId)) {
          this.flushText();
          this.text = { kind, buffer: '', messageId };
          this.emit({ type: 'activity', activity: kind === 'text' ? 'generating' : 'thinking' });
        }
        this.text.buffer += update.content.text;
        this.emit(kind === 'text' ? { type: 'partial_text', text: update.content.text } : { type: 'partial_thinking', text: update.content.text });
        return;
      }
      case 'tool_call':
      case 'tool_call_update':
        this.onToolCall(update);
        return;
      case 'plan':
        this.onPlan(update.entries ?? []);
        return;
      case 'available_commands_update':
        this.commands = (update.availableCommands ?? []).map((c) => c?.name).filter((n): n is string => typeof n === 'string');
        this.commandsSeen();
        return;
      case 'current_mode_update':
        if (this.modes) this.modes = { ...this.modes, currentModeId: update.currentModeId };
        return;
      case 'config_option_update':
        this.takeConfigOptions(update.configOptions);
        return;
      case 'session_info_update':
        if (this.sessionId && typeof update.title === 'string' && update.title.trim()) this.hooks.setTitle(this.sessionId, update.title.trim());
        return;
      case 'usage_update':
        if (typeof update.used === 'number') this.emit({ type: 'usage', inputTokens: update.used, outputTokens: 0 });
        if (typeof update.size === 'number' && update.size > 0) this.contextSize = update.size;
        return;
      default:
        // user_message_chunk: Grove shows its own copy of what the user sent.
        return;
    }
  }

  private flushText(): void {
    const { kind, buffer, messageId } = this.text;
    if (kind && buffer) {
      const uuid = messageId ?? crypto.randomUUID();
      this.emit(kind === 'text' ? { type: 'assistant_text', text: buffer, uuid } : { type: 'thinking', thinking: buffer, uuid });
    }
    this.text = { kind: null, buffer: '', messageId: null };
  }

  private resetTurn(): void {
    this.tools.clear();
    this.openTools.clear();
    this.text = { kind: null, buffer: '', messageId: null };
    this.planCallId = null;
  }

  /** The Grove event fields for a call as known so far. */
  private describe(call: AcpToolCall) {
    return {
      toolName: toolNameFor(call),
      toolInput: call.rawInput ?? {},
      toolCategory: categoryForKind(call.kind),
      toolView: toolViewFor(call, this.config.cwd),
    };
  }

  private onToolCall(update: AcpToolCall): void {
    if (!update?.toolCallId) return;
    const id = update.toolCallId;
    const prev = this.tools.get(id);
    const call = mergeToolCall(prev, update);
    this.tools.set(id, call);
    // A late update to a call that already ended changes nothing shown.
    if (prev && !this.openTools.has(id)) return;
    if (!prev) {
      this.reportToolStart(call);
    } else {
      const before = this.describe(prev);
      const after = this.describe(call);
      if (JSON.stringify(before) !== JSON.stringify(after)) this.emit({ type: 'tool_update', toolUseId: id, ...after });
    }
    if (call.status === 'completed' || call.status === 'failed') this.reportToolEnd(call);
  }

  private reportToolStart(call: AcpToolCall): void {
    this.flushText();
    this.openTools.add(call.toolCallId);
    const d = this.describe(call);
    this.emit({ type: 'activity', activity: 'tool_starting', toolName: d.toolName });
    this.emit({ type: 'assistant_tool_use', toolUseId: call.toolCallId, uuid: crypto.randomUUID(), ...d });
  }

  private reportToolEnd(call: AcpToolCall, errorText?: string): void {
    if (!this.openTools.delete(call.toolCallId)) return;
    const images = contentImages(call.content)
      .filter((i) => IMAGE_MEDIA.has(i.mediaType))
      .map((i) => ({ data: i.data, mediaType: i.mediaType as ImageMediaType }));
    const raw = call.rawOutput;
    const text = contentText(call.content)
      || (typeof raw === 'string' ? raw : raw != null ? JSON.stringify(raw, null, 2) : '')
      || errorText
      || '';
    this.emit({
      type: 'tool_result',
      toolUseId: call.toolCallId,
      content: text,
      isError: call.status === 'failed' || errorText !== undefined,
      ...(images.length ? { imageData: images } : {}),
    });
  }

  /** Calls still open when the turn ends were cut short; the plan is done. */
  private finishOpenTools(reason: string): void {
    for (const id of [...this.openTools]) {
      const call = this.tools.get(id);
      if (!call) continue;
      if (id === this.planCallId) this.reportToolEnd({ ...call, status: 'completed' });
      else this.reportToolEnd(call, reason || 'Ended without a result');
    }
  }

  /** The agent's plan shows as one tool call per turn, updated in place and
   *  finished with the turn (finishOpenTools). */
  private onPlan(entries: AcpPlanEntry[]): void {
    const input = { entries };
    const toolView = { kind: 'other' as const, summary: planSummary(entries) };
    const isNew = !this.planCallId;
    const id = this.planCallId ?? `plan-${crypto.randomUUID()}`;
    this.planCallId = id;
    this.tools.set(id, {
      toolCallId: id, kind: 'think', rawInput: input, status: 'in_progress',
      content: [{ type: 'content', content: { type: 'text', text: planText(entries) } }],
    });
    if (isNew) {
      this.flushText();
      this.openTools.add(id);
      this.emit({ type: 'assistant_tool_use', toolName: 'plan', toolInput: input, toolUseId: id, uuid: crypto.randomUUID(), toolCategory: 'other', toolView });
    } else {
      this.emit({ type: 'tool_update', toolUseId: id, toolInput: input, toolView });
    }
  }

  // ─── Permissions ───

  private async onPermission(req: AcpPermissionRequest): Promise<AcpPermissionOutcome> {
    const cancelled: AcpPermissionOutcome = { outcome: { outcome: 'cancelled' } };
    if (!req?.toolCall?.toolCallId || (this.sessionId && req.sessionId !== this.sessionId) || this.closing) return cancelled;
    const options = Array.isArray(req.options) ? req.options : [];
    const answer = (decision: 'allow' | 'allowAlways' | 'deny'): AcpPermissionOutcome => {
      const option = pickPermissionOption(options, decision);
      return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : cancelled;
    };

    // The request carries the call; show it first if the agent hadn't yet.
    this.onToolCall(req.toolCall);
    const call = this.tools.get(req.toolCall.toolCallId)!;
    const { toolName, toolInput, toolCategory, toolView } = this.describe(call);
    const { config } = this;

    if (config.allowedTools && !config.allowedTools.has(toolName)) return answer('deny');

    const verdict = this.checkRules(toolName, toolCategory, specifierFor(toolView));
    if (verdict === 'deny') return answer('deny');
    if (verdict === 'allow') return answer('allow');
    if (config.alwaysAllowedTools.has(toolName)) return answer('allow');

    // Edit and Read-safe modes approve edits inside the worktree.
    if ((this.groveMode === 'acceptEdits' || this.groveMode === 'readSafe') && toolCategory === 'edit' && this.editsInsideWorktree(toolView)) {
      return answer('allow');
    }

    const isPlan = call.kind === 'switch_mode';
    const asked = config.onPermissionRequest({
      requestId: '',
      toolName,
      toolUseId: call.toolCallId,
      toolInput: (toolInput && typeof toolInput === 'object' ? toolInput : { value: toolInput }) as Record<string, unknown>,
      toolCategory,
      toolView,
      ...(isPlan ? { isPlanExecution: true, planText: firstText(call.content) ?? call.title ?? '' } : {}),
    });
    let settle!: (outcome: AcpPermissionOutcome) => void;
    const cancelledByTurn = new Promise<AcpPermissionOutcome>((resolve) => { settle = resolve; });
    this.pendingPermissions.add(settle);
    try {
      return await Promise.race([
        asked.then((res: PermissionResponse) => answer(res.behavior === 'allow' ? 'allow' : 'deny')),
        cancelledByTurn,
      ]);
    } finally {
      this.pendingPermissions.delete(settle);
    }
  }

  /** Grove's allow/deny rules. Shell commands are matched as both bash and
   *  PowerShell, since Grove can't tell which shell the agent uses: a deny
   *  in either denies, an allow needs both. */
  private checkRules(toolName: string, category: ReturnType<typeof categoryForKind>, specifier: string): 'allow' | 'deny' | null {
    const { toolAllowRules, toolDenyRules } = this.config;
    if (category !== 'bash') {
      return checkToolRules(toolAllowRules, toolDenyRules, toolName, specifier, category)?.behavior ?? null;
    }
    const bash = checkToolRules(toolAllowRules, toolDenyRules, toolName, specifier, category, 'bash');
    const ps = checkToolRules(toolAllowRules, toolDenyRules, toolName, specifier, category, 'powershell');
    if (bash?.behavior === 'deny' || ps?.behavior === 'deny') return 'deny';
    if (bash?.behavior === 'allow' && ps?.behavior === 'allow') return 'allow';
    return null;
  }

  private editsInsideWorktree(view: ReturnType<typeof toolViewFor>): boolean {
    const paths = [view.path, ...(view.morePaths ?? [])].filter((p): p is string => !!p);
    const cwd = this.config.cwd;
    return paths.length > 0 && paths.every((p) => isPathInside(cwd, path.resolve(cwd, p)));
  }
}

