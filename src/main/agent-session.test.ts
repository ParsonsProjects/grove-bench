import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentAdapter, AgentQueryHandle, AdapterConfig, PermissionResponse } from './adapters/types.js';
import { IPC, PERMISSION_TIMEOUT_MINUTES, type AgentEvent } from '../shared/types.js';
import * as fs from 'node:fs';
import { perfSteps } from './perf-steps.js';

// ─── Mock infrastructure ───

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  app: { getPath: () => '/fake/userData', quit: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

// Mock node:fs
vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
    statSync: vi.fn(() => { throw new Error('ENOENT'); }),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  readFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
  statSync: vi.fn(() => { throw new Error('ENOENT'); }),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock dependencies
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), close: vi.fn() },
}));
vi.mock('./worktree-manager.js', () => ({
  worktreeManager: {
    saveProviderSessionId: vi.fn().mockResolvedValue(undefined),
    updateLastActive: vi.fn().mockResolvedValue(undefined),
    saveModel: vi.fn().mockResolvedValue(undefined),
    getModel: vi.fn().mockResolvedValue(undefined),
    getAdapterType: vi.fn().mockResolvedValue(undefined),
    getAgentAndModel: vi.fn().mockResolvedValue({}),
    saveAdapterType: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    getWorktreeOrManifest: vi.fn().mockResolvedValue(undefined),
  },
}));
const processTree = vi.hoisted(() => ({
  killTree: vi.fn(async (_pid: number) => {}),
}));
vi.mock('./process-tree.js', () => processTree);
vi.mock('./settings.js', () => ({
  getSettings: vi.fn(() => ({
    defaultSystemPromptAppend: null,
    toolAllowRules: [],
    toolDenyRules: [],
    cavemanMode: 'off',
  })),
  loadSettings: vi.fn(() => ({ alwaysOnTop: false, theme: 'system' })),
}));
vi.mock('./memory.js', () => ({
  getMemoryForSystemPrompt: vi.fn(() => ''),
  ensureRepoMemory: vi.fn(),
  listMemoryFiles: vi.fn(() => []),
}));
vi.mock('./memory-autosave.js', () => ({
  triggerAutoSave: vi.fn(),
  triggerAutoSaveImmediate: vi.fn().mockResolvedValue(undefined),
  cancelAutoSave: vi.fn(),
  saveSessionMetadata: vi.fn(),
}));

vi.mock('./git.js', () => ({
  getGitIdentity: vi.fn().mockResolvedValue({ name: 'Test User', email: 'test@example.com' }),
  isGitRepo: vi.fn().mockResolvedValue(true),
}));

vi.mock('./checkpoints.js', () => {
  class MockCheckpointManager {
    static instances: MockCheckpointManager[] = [];
    constructor() { MockCheckpointManager.instances.push(this); }
    capture = vi.fn().mockResolvedValue(true);
    captureBaseline = vi.fn().mockResolvedValue(true);
    restore = vi.fn().mockResolvedValue(undefined);
    pruneAfter = vi.fn().mockResolvedValue(undefined);
    resume = vi.fn().mockResolvedValue(undefined);
    cleanup = vi.fn().mockResolvedValue(undefined);
    markCleared = vi.fn().mockResolvedValue(undefined);
    list = vi.fn().mockResolvedValue([]);
    diff = vi.fn().mockResolvedValue('');
  }
  return { CheckpointManager: MockCheckpointManager };
});

// Mock the adapter registry with a controllable mock adapter
let mockAdapter: MockAdapter;

/** Other agents a test registers alongside the mock adapter. */
let extraAdapters: Record<string, AgentAdapter> = {};
vi.mock('./adapters/index.js', () => ({
  adapterRegistry: {
    get: (id: string) => id === 'mock' ? mockAdapter : extraAdapters[id],
    getDefault: () => mockAdapter,
    list: () => [mockAdapter, ...Object.values(extraAdapters)],
    register: vi.fn(),
  },
}));
vi.mock('./skill-suggestions.js', () => ({
  analyzeRepo: vi.fn(async () => [{ id: 'analyzed' }]),
  getCachedSuggestions: vi.fn(() => [{ id: 'cached' }]),
}));

// Images are saved by content hash in real use; here each gets a fixed name.
const attachments = vi.hoisted(() => ({
  saveImages: vi.fn(async (_id: string, images: { name?: string }[]) =>
    images.map((img, i) => ({ file: `img${i}.png`, ...(img.name ? { name: img.name } : {}) }))),
  removeImages: vi.fn(async () => {}),
  pruneImages: vi.fn(async () => {}),
  storeToolImages: vi.fn(async (_id: string, event: any) => {
    const { imageData, ...rest } = event;
    return { ...rest, images: imageData.map((_: unknown, i: number) => ({ file: `tool${i}.png` })) };
  }),
}));
vi.mock('./attachments.js', () => attachments);
vi.mock('./credentials.js', () => ({ markApiKeyRejected: vi.fn() }));

// ─── Mock Adapter ───

interface MockQueryControl {
  emitEvent: (event: AgentEvent) => void;
  finish: () => void;
  error: (err: Error) => void;
  permissionHandler: ((req: any) => Promise<PermissionResponse>) | null;
}

class MockAdapter implements AgentAdapter {
  readonly id = 'mock';
  readonly displayName = 'Mock Agent';
  readonly authErrorMessage = 'Auth failed. Please configure mock credentials.';
  readonly capabilities = {
    permissions: true,
    permissionModes: true,
    resume: true,
    rewind: true,
    modelSwitching: true,
    thinking: true,
    usage: true,
    plugins: false,
    imageAttachments: true,
    structuredOutput: false,
    sandbox: true,
  };

  control: MockQueryControl | null = null;
  startCallCount = 0;
  lastConfig: AdapterConfig | null = null;
  /** One-shot gate: when set, the next start() blocks on it (used to simulate
   *  a stop arriving while a query is still starting up). */
  startGate: Promise<void> | null = null;
  /** PID the query handle reports for its agent process. */
  pid: number | undefined = undefined;
  /** The handle the last start() returned. */
  lastHandle: AgentQueryHandle | null = null;
  /** Every handle start() has returned, to check none is left running. */
  handles: AgentQueryHandle[] = [];

  getModels() { return [{ id: 'mock-model', label: 'Mock' }, { id: 'mock-lite', label: 'Mock Lite' }]; }
  /** Two universal controls plus one ('speed') that only the full model offers,
   *  so tests can cover per-model reconciliation. */
  getControls(model?: string | null) {
    // Like Claude's Haiku, the lite model does not offer native auto mode.
    const modeOptions = [
      { value: 'default', label: 'Ask' }, { value: 'plan', label: 'Plan' }, { value: 'acceptEdits', label: 'Edit' },
      { value: 'auto', label: 'Auto' }, { value: 'readSafe', label: 'Read-safe', group: 'Grove Bench' },
    ].filter((o) => o.value !== 'auto' || model !== 'mock-lite');
    const controls = [
      { id: 'permissionMode', label: 'Mode', default: 'default', options: modeOptions },
      { id: 'thinking', label: 'Thinking', default: 'high', options: [
        { value: 'off', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'high', label: 'High' },
      ] },
    ];
    if (model !== 'mock-lite') {
      controls.push({ id: 'speed', label: 'Speed', default: 'standard', options: [
        { value: 'standard', label: 'Standard' }, { value: 'fast', label: 'Fast' },
      ] });
    }
    return controls;
  }
  async checkPrerequisites() { return { available: true }; }

  async start(config: AdapterConfig): Promise<AgentQueryHandle> {
    this.startCallCount++;
    if (this.startGate) { const gate = this.startGate; this.startGate = null; await gate; }
    this.lastConfig = config;

    let resolveIter: (() => void) | null = null;
    let rejectIter: ((err: Error) => void) | null = null;
    const eventQueue: AgentEvent[] = [];
    let done = false;
    let waitForEvent: Promise<void> | null = null;

    const control: MockQueryControl = {
      emitEvent: (event: AgentEvent) => {
        eventQueue.push(event);
        resolveIter?.();
      },
      finish: () => {
        done = true;
        resolveIter?.();
      },
      error: (err: Error) => {
        rejectIter?.(err);
      },
      permissionHandler: config.onPermissionRequest,
    };
    this.control = control;

    async function* eventGenerator(): AsyncGenerator<AgentEvent> {
      while (true) {
        if (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        } else if (done) {
          return;
        } else {
          waitForEvent = new Promise<void>((resolve, reject) => {
            resolveIter = resolve;
            rejectIter = reject;
          });
          await waitForEvent;
        }
      }
    }

    let sessionId = 'mock-session-id';
    const abortController = new AbortController();

    const handle: AgentQueryHandle = {
      events: eventGenerator(),
      sendMessage: vi.fn(),
      abort: vi.fn(() => {
        abortController.abort();
        done = true;
        resolveIter?.();
      }),
      interrupt: vi.fn(async () => {
        // Interrupt keeps the process alive — the event stream stays open and
        // the handle remains valid for follow-up messages.
      }),
      stopTask: vi.fn(async (_taskId: string) => {}),
      close: vi.fn(() => {
        done = true;
        resolveIter?.();
      }),
      getSessionId: () => sessionId,
      processId: () => this.pid,
      closeInput: vi.fn(),
      setModel: vi.fn(),
      setPermissionMode: vi.fn(),
      setControl: vi.fn(),
      getUsage: vi.fn(async () => ({ available: true, plan: 'max', windows: [{ id: 'five_hour', label: '5-hour', utilization: 0.4 }], fetchedAt: 1 })),
    };
    this.lastHandle = handle;
    this.handles.push(handle);
    return handle;
  }
}

// ─── Helpers ───

function makeMockWindow() {
  const send = vi.fn();
  return {
    isDestroyed: () => false,
    webContents: { send },
    _send: send,
  } as any;
}

// ─── Tests ───

// Import the module under test AFTER mocks are set up
const { sessionManager } = await import('./agent-session.js');
const { sanitizeElicitationResponse } = await import('./session-permissions.js');
const { READ_SAFE_SANDBOX_WARNING } = await import('./session-config.js');
const settingsMock = await import('./settings.js') as unknown as { getSettings: ReturnType<typeof vi.fn> };
const { getGitIdentity, isGitRepo } = await import('./git.js');
const { CheckpointManager } = await import('./checkpoints.js') as unknown as { CheckpointManager: { instances: unknown[] } };
const { logger } = await import('./logger.js');
const { markApiKeyRejected } = await import('./credentials.js');
const { ResumeNotFoundError } = await import('./adapters/types.js');

beforeEach(() => {
  mockAdapter = new MockAdapter();
  extraAdapters = {};
  vi.clearAllMocks();
});

describe('AgentSessionManager.createSession()', () => {
  it('creates a session and starts the adapter', async () => {
    const win = makeMockWindow();
    const result = await sessionManager.createSession({
      id: 'test-1',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    expect(result.id).toBe('test-1');
    expect(result.branch).toBe('main');
    expect(result.status).toBe('starting');
    expect(result.agentType).toBe('mock');
    // runQuery is fire-and-forget — wait for adapter.start() to be called
    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(1));

    // Clean up
    await sessionManager.destroySession('test-1');
  });

  it('throws for unknown adapter type', async () => {
    const win = makeMockWindow();
    await expect(sessionManager.createSession({
      id: 'test-bad',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'nonexistent',
    })).rejects.toThrow('Unknown agent adapter: nonexistent');
  });

  it('passes permission mode and system prompt to adapter config', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-config',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
      permissionMode: 'plan',
    });

    // runQuery is fire-and-forget — wait for adapter.start() to be called
    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.permissionMode).toBe('plan');
    expect(mockAdapter.lastConfig?.appendSystemPrompt).toBeTruthy();

    await sessionManager.destroySession('test-config');
  });
});

describe('AgentSessionManager in a folder without git', () => {
  it('skips checkpoints and the identity check, and says files can\'t be restored', async () => {
    vi.mocked(getGitIdentity).mockClear();
    const before = CheckpointManager.instances.length;

    await sessionManager.createSession({
      id: 'test-folder', branch: '', cwd: '/notes', repoPath: '/notes', window: makeMockWindow(), adapterType: 'mock', noGit: true,
    });
    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());

    expect(CheckpointManager.instances.length).toBe(before);
    expect(getGitIdentity).not.toHaveBeenCalled();
    expect(sessionManager.getEventHistory('test-folder').some((e) => e.type === 'git_identity_missing')).toBe(false);
    await expect(sessionManager.rewindFiles('test-folder', 'u1', { filesOnly: true }))
      .rejects.toThrow(/isn't a git repository/);

    await sessionManager.destroySession('test-folder');
  });

  it('sends messages without a "checkpoint could not be captured" error', async () => {
    await sessionManager.createSession({
      id: 'test-folder-send', branch: '', cwd: '/notes', repoPath: '/notes', window: makeMockWindow(), adapterType: 'mock', noGit: true,
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));
    const session = sessionManager.getSession('test-folder-send')!;

    expect(await sessionManager.sendMessage('test-folder-send', 'Tidy my notes')).toBe(true);
    expect(session.queryHandle!.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'Tidy my notes' }));
    expect(session.eventHistory.filter((e) => e.type === 'error')).toHaveLength(0);

    await sessionManager.destroySession('test-folder-send');
  });

  it('keeps checkpoints for a git conversation even if git is briefly unavailable', async () => {
    vi.mocked(isGitRepo).mockResolvedValue(false);
    const before = CheckpointManager.instances.length;
    await sessionManager.createSession({
      id: 'test-git-flaky', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
    });
    expect(CheckpointManager.instances.length).toBe(before + 1);
    vi.mocked(isGitRepo).mockResolvedValue(true);
    await sessionManager.destroySession('test-git-flaky');
  });
});

describe('AgentSessionManager git identity env', () => {
  const start = (id: string) => sessionManager.createSession({
    id, branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
  });
  const identityNotices = (id: string) =>
    sessionManager.getEventHistory(id).filter((e) => e.type === 'git_identity_missing').length;

  afterEach(() => {
    // Drop any unused once-values and restore the module-level default.
    vi.mocked(getGitIdentity).mockReset().mockResolvedValue({ name: 'Test User', email: 'test@example.com' });
  });

  it('forces the configured identity on agent commits', async () => {
    await start('test-identity');
    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.extraEnv).toMatchObject({
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    });
    expect(identityNotices('test-identity')).toBe(0);
    await sessionManager.destroySession('test-identity');
  });

  it('leaves the identity vars unset when git has no identity', async () => {
    vi.mocked(getGitIdentity).mockResolvedValueOnce(null);
    await start('test-no-identity');
    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    const env = mockAdapter.lastConfig?.extraEnv ?? {};
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) {
      expect(env).not.toHaveProperty(key);
    }
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('user.name/user.email not set'));
    expect(identityNotices('test-no-identity')).toBe(1);
    await sessionManager.destroySession('test-no-identity');
  });

  it('tells the user once per conversation, not on every query restart', async () => {
    vi.mocked(getGitIdentity).mockResolvedValue(null);
    await start('test-identity-once');
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    await sessionManager.stopQuery('test-identity-once');
    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(2));

    expect(getGitIdentity).toHaveBeenCalledTimes(2);
    expect(identityNotices('test-identity-once')).toBe(1);
    await sessionManager.destroySession('test-identity-once');
  });
});

describe('Read-safe mode sandbox enforcement', () => {
  it('passes a hardened sandbox config when the session starts in read-safe mode', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-auto-sandbox',
      branch: 'main',
      cwd: '/repo-wt',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
      permissionMode: 'readSafe',
    });

    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    const sandbox = mockAdapter.lastConfig?.sandbox as Record<string, any>;
    expect(sandbox).toBeTruthy();
    expect(sandbox.enabled).toBe(true);
    // Bash approval must stay with the read-only classifier, not the sandbox.
    expect(sandbox.autoAllowBashIfSandboxed).toBe(false);
    // The model must not be able to opt commands out of the sandbox.
    expect(sandbox.allowUnsandboxedCommands).toBe(false);
    // Missing sandbox deps degrade gracefully instead of failing the query.
    expect(sandbox.failIfUnavailable).toBe(false);
    expect(sandbox.filesystem?.allowWrite).toEqual(['/repo-wt']);

    await sessionManager.destroySession('test-auto-sandbox');
  });

  it('passes no sandbox to an agent that has none', async () => {
    (mockAdapter.capabilities as Record<string, boolean>).sandbox = false;
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-no-sandbox', branch: 'main', cwd: '/repo-wt', repoPath: '/repo', window: win,
      adapterType: 'mock', permissionMode: 'readSafe',
    });
    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.sandbox).toBeNull();
    await sessionManager.destroySession('test-no-sandbox');
  });

  it('passes native auto mode to the adapter without a Grove sandbox', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-native-auto',
      branch: 'main',
      cwd: '/repo-wt',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
      permissionMode: 'auto',
    });

    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.permissionMode).toBe('auto');
    expect(mockAdapter.lastConfig?.sandbox).toBeNull();

    await sessionManager.destroySession('test-native-auto');
  });

  it('falls a requested mode back to the adapter default when the model does not offer it', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-auto-unsupported',
      branch: 'main',
      cwd: '/repo-wt',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
      model: 'mock-lite',
      permissionMode: 'auto',
    });

    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.permissionMode).toBe('default');
    expect(sessionManager.getSession('test-auto-unsupported')?.permissionMode).toBe('default');

    await sessionManager.destroySession('test-auto-unsupported');
  });

  it('does not set a sandbox for non-read-safe modes', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-no-sandbox',
      branch: 'main',
      cwd: '/repo-wt',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
      permissionMode: 'acceptEdits',
    });

    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.sandbox).toBeNull();

    await sessionManager.destroySession('test-no-sandbox');
  });

  it('explicit per-session sandbox settings win over the read-safe sandbox', async () => {
    const win = makeMockWindow();
    const explicit = { enabled: true, autoAllowBashIfSandboxed: true };
    await sessionManager.createSession({
      id: 'test-explicit-sandbox',
      branch: 'main',
      cwd: '/repo-wt',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
      permissionMode: 'readSafe',
      sandbox: explicit,
    });

    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.sandbox).toEqual(explicit);

    await sessionManager.destroySession('test-explicit-sandbox');
  });
});

describe('AgentSessionManager caveman mode', () => {
  afterEach(() => {
    // mockReturnValue outlives the test (clearAllMocks keeps it): put back
    // the module mock's default so later tests see caveman mode off.
    settingsMock.getSettings.mockReturnValue({
      defaultSystemPromptAppend: null,
      toolAllowRules: [],
      toolDenyRules: [],
      cavemanMode: 'off',
    });
  });

  it('does not include caveman prompt when mode is off', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-cave-off',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.appendSystemPrompt).not.toContain('Caveman Mode');

    await sessionManager.destroySession('test-cave-off');
  });

  it('includes caveman prompt when mode is full', async () => {
    settingsMock.getSettings.mockReturnValue({
        defaultSystemPromptAppend: null,
      toolAllowRules: [],
      toolDenyRules: [],
      cavemanMode: 'full',
    });

    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-cave-full',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.appendSystemPrompt).toContain('Caveman Mode: Full');

    await sessionManager.destroySession('test-cave-full');
  });

  it('places caveman prompt after path rules', async () => {
    settingsMock.getSettings.mockReturnValue({
        defaultSystemPromptAppend: null,
      toolAllowRules: [],
      toolDenyRules: [],
      cavemanMode: 'lite',
    });

    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-cave-order',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    const prompt = mockAdapter.lastConfig?.appendSystemPrompt ?? '';
    const pathIdx = prompt.indexOf('IMPORTANT PATH RULES');
    const caveIdx = prompt.indexOf('Caveman Mode');
    expect(pathIdx).toBeGreaterThanOrEqual(0);
    expect(caveIdx).toBeGreaterThan(pathIdx);

    await sessionManager.destroySession('test-cave-order');
  });
});

describe('AgentSessionManager event processing', () => {
  it('transitions to running on system_init and sends SESSION_STATUS', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-init',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    // Wait for adapter.start() to be called
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    mockAdapter.control!.emitEvent({
      type: 'system_init',
      sessionId: 'mock-session-id',
      model: 'mock-model',
      tools: [],
    });

    // Give the event loop time to process
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-init');
    expect(session?.status).toBe('running');

    // Should have sent SESSION_STATUS 'running' to renderer
    expect(win._send).toHaveBeenCalledWith(
      expect.any(String), // IPC.SESSION_STATUS
      'test-init',
      'running',
    );

    await sessionManager.destroySession('test-init');
  });

  it('emits events to the renderer window', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-emit',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'Hello', uuid: 'u1' });
    await new Promise((r) => setTimeout(r, 50));

    // The agent event channel sends events
    const agentEventCalls = win._send.mock.calls.filter(
      (c: any[]) => c[0].includes('agent:event'),
    );
    expect(agentEventCalls.length).toBeGreaterThanOrEqual(1);

    await sessionManager.destroySession('test-emit');
  });

  it('buffers events in eventHistory', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-history',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'msg1', uuid: 'u1' });
    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'msg2', uuid: 'u2' });
    await new Promise((r) => setTimeout(r, 50));

    const history = sessionManager.getEventHistory('test-history');
    const textEvents = history.filter((e) => e.type === 'assistant_text');
    expect(textEvents).toHaveLength(2);

    await sessionManager.destroySession('test-history');
  });

  it('starts the history with the setup steps already shown, without sending them again', async () => {
    const win = makeMockWindow();
    const setup = [{ type: 'status' as const, message: 'Creating worktree…' }, { type: 'status' as const, message: 'Starting agent…' }];
    const adoptSetupEvents = vi.fn(() => setup);
    await sessionManager.createSession({
      id: 'test-setup', branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock', adoptSetupEvents,
    });

    expect(adoptSetupEvents).toHaveBeenCalledTimes(1);
    const history = sessionManager.getEventHistory('test-setup');
    expect(history.slice(0, 2)).toEqual(setup);
    const sent = win._send.mock.calls.filter((c: any[]) => c[0].includes('agent:event')).map((c: any[]) => c[1]);
    expect(sent).not.toContainEqual(setup[0]);

    await sessionManager.destroySession('test-setup');
  });

  it('flags a saved key the provider refused', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-refused', branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    mockAdapter.control!.emitEvent({ type: 'error', message: 'Sign in again', auth: true, keyRejected: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(markApiKeyRejected).toHaveBeenCalledWith('mock');

    vi.mocked(markApiKeyRejected).mockClear();
    mockAdapter.control!.emitEvent({ type: 'error', message: 'Something else' });
    await new Promise((r) => setTimeout(r, 50));
    expect(markApiKeyRejected).not.toHaveBeenCalled();

    await sessionManager.destroySession('test-refused');
  });

  it('forwards transient streaming events to the renderer without buffering them', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-transient',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    mockAdapter.control!.emitEvent({ type: 'partial_text', text: 'Hel' });
    mockAdapter.control!.emitEvent({ type: 'partial_text', text: 'lo' });
    mockAdapter.control!.emitEvent({ type: 'activity', activity: 'generating' });
    mockAdapter.control!.emitEvent({ type: 'usage', inputTokens: 1, outputTokens: 1 });
    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'Hello', uuid: 'u1' });
    await new Promise((r) => setTimeout(r, 50));

    const history = sessionManager.getEventHistory('test-transient');
    expect(history.some((e) => e.type === 'partial_text')).toBe(false);
    expect(history.some((e) => e.type === 'activity')).toBe(false);
    expect(history.some((e) => e.type === 'usage')).toBe(false);
    expect(history.filter((e) => e.type === 'assistant_text')).toHaveLength(1);

    // The renderer still receives them live
    const sentTypes = win._send.mock.calls
      .filter((c: any[]) => c[0].includes('agent:event'))
      .map((c: any[]) => c[1].type);
    expect(sentTypes).toContain('partial_text');
    expect(sentTypes).toContain('activity');

    await sessionManager.destroySession('test-transient');
  });

  it('destroySession does not trigger a memory auto-save from the ended event loop', async () => {
    const autosave = await import('./memory-autosave.js');
    vi.mocked(autosave.triggerAutoSaveImmediate).mockClear();

    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-destroy-autosave',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'hi', uuid: 'u1' });
    await new Promise((r) => setTimeout(r, 20));

    await sessionManager.destroySession('test-destroy-autosave');
    await new Promise((r) => setTimeout(r, 50));

    expect(autosave.triggerAutoSaveImmediate).not.toHaveBeenCalled();
    expect(sessionManager.getSession('test-destroy-autosave')).toBeUndefined();
  });

  it('clearEventHistory keeps checkpoint refs and records a clear marker (pre-/clear turns stay restorable)', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-clear-cp',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    const session = sessionManager.getSession('test-clear-cp')!;
    sessionManager.clearEventHistory('test-clear-cp');

    expect(session.checkpoints.markCleared).toHaveBeenCalledWith('test-clear-cp', expect.any(String));
    expect(session.checkpoints.cleanup).not.toHaveBeenCalled();
    // No event refers to the thread's images any more.
    expect(attachments.removeImages).toHaveBeenCalledWith('test-clear-cp');

    await sessionManager.destroySession('test-clear-cp');
  });
});

describe('AgentSessionManager.respondToPermission()', () => {
  it('returns false for non-existent session', () => {
    const result = sessionManager.respondToPermission('nonexistent', {
      requestId: 'perm_1',
      behavior: 'allow',
    });
    expect(result).toBe(false);
  });

  it('resolves a pending permission with allow and emits permission_resolved', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-perm',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    // Trigger a permission request through the adapter's handler
    let permResponse: PermissionResponse | null = null;
    const permPromise = mockAdapter.control!.permissionHandler!({
      requestId: 'adapter_1',
      toolName: 'Bash',
      toolUseId: 'tu_1',
      toolInput: { command: 'ls' },
    }).then((r) => { permResponse = r; });

    // Wait for the permission_request event to arrive
    await new Promise((r) => setTimeout(r, 50));

    // Find the requestId that the session manager assigned
    const session = sessionManager.getSession('test-perm');
    const pendingIds = [...session!.pendingPermissions.keys()];
    expect(pendingIds).toHaveLength(1);
    const requestId = pendingIds[0];

    // Resolve it
    const resolved = sessionManager.respondToPermission('test-perm', {
      requestId,
      behavior: 'allow',
    });
    expect(resolved).toBe(true);

    await permPromise;
    expect(permResponse).toMatchObject({ behavior: 'allow' });

    // Should have emitted permission_resolved
    const history = sessionManager.getEventHistory('test-perm');
    const resolvedEvents = history.filter((e) => e.type === 'permission_resolved');
    expect(resolvedEvents.length).toBeGreaterThanOrEqual(1);
    expect(resolvedEvents[resolvedEvents.length - 1]).toMatchObject({
      type: 'permission_resolved',
      requestId,
      decision: 'allow',
    });

    await sessionManager.destroySession('test-perm');
  });

  it('carries the deny message on permission_resolved so question answers replay', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-perm-msg',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    const permPromise = mockAdapter.control!.permissionHandler!({
      requestId: 'adapter_q',
      toolName: 'AskUserQuestion',
      toolUseId: 'tu_q',
      toolInput: { questions: [] },
    });
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-perm-msg');
    const requestId = [...session!.pendingPermissions.keys()][0];

    expect(sessionManager.respondToPermission('test-perm-msg', {
      requestId,
      behavior: 'deny',
      message: 'Option B',
    })).toBe(true);
    await permPromise;

    const history = sessionManager.getEventHistory('test-perm-msg');
    const resolved = history.filter((e) => e.type === 'permission_resolved');
    expect(resolved[resolved.length - 1]).toMatchObject({
      requestId,
      decision: 'deny',
      message: 'Option B',
    });

    await sessionManager.destroySession('test-perm-msg');
  });

  it('denies an unanswered request after the timeout and says it timed out', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-perm-timeout',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    vi.useFakeTimers();
    try {
      const permPromise = mockAdapter.control!.permissionHandler!({
        requestId: 't1',
        toolName: 'Bash',
        toolUseId: 'tu_timeout',
        toolInput: { command: 'npm test' },
      });
      await vi.advanceTimersByTimeAsync(PERMISSION_TIMEOUT_MINUTES * 60 * 1000);
      await expect(permPromise).resolves.toMatchObject({ behavior: 'deny' });
    } finally {
      vi.useRealTimers();
    }

    const resolved = sessionManager.getEventHistory('test-perm-timeout').filter((e) => e.type === 'permission_resolved');
    expect(resolved[resolved.length - 1]).toMatchObject({ decision: 'deny', reason: 'timeout' });

    await sessionManager.destroySession('test-perm-timeout');
  });

  it('adds tool to alwaysAllowedTools on allowAlways', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-always',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    mockAdapter.control!.permissionHandler!({
      requestId: 'a1',
      toolName: 'Edit',
      toolUseId: 'tu_2',
      toolInput: {},
    });
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-always');
    const requestId = [...session!.pendingPermissions.keys()][0];

    sessionManager.respondToPermission('test-always', {
      requestId,
      behavior: 'allowAlways',
    });

    expect(session!.alwaysAllowedTools.has('Edit')).toBe(true);

    await sessionManager.destroySession('test-always');
  });

  it('returns false for already-resolved permission', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-double',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    mockAdapter.control!.permissionHandler!({
      requestId: 'a1',
      toolName: 'Bash',
      toolUseId: 'tu_3',
      toolInput: {},
    });
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-double');
    const requestId = [...session!.pendingPermissions.keys()][0];

    // First resolve succeeds
    expect(sessionManager.respondToPermission('test-double', { requestId, behavior: 'allow' })).toBe(true);
    // Second resolve fails (already resolved)
    expect(sessionManager.respondToPermission('test-double', { requestId, behavior: 'allow' })).toBe(false);

    await sessionManager.destroySession('test-double');
  });
});

describe('AgentSessionManager.permRequestCounter', () => {
  it('generates unique IDs across permission requests', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-counter',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    // Trigger two permission requests
    mockAdapter.control!.permissionHandler!({
      requestId: 'a1', toolName: 'Bash', toolUseId: 'tu_1', toolInput: {},
    });
    mockAdapter.control!.permissionHandler!({
      requestId: 'a2', toolName: 'Read', toolUseId: 'tu_2', toolInput: {},
    });
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-counter');
    const ids = [...session!.pendingPermissions.keys()];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2); // All unique

    await sessionManager.destroySession('test-counter');
  });
});

describe('read-safe sandbox warning', () => {
  const warnings = (win: ReturnType<typeof makeMockWindow>) => win._send.mock.calls
    .map(([, event]: [string, AgentEvent | undefined]) => event)
    .filter((e: AgentEvent | undefined) => e?.type === 'status' && (e as { level?: string }).level === 'warning');

  it('warns once, when a conversation starts in read-safe mode', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rs-warn', branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock', permissionMode: 'readSafe',
    });
    await vi.waitFor(() => expect(sessionManager.getSession('test-rs-warn')?.queryHandle).toBeTruthy());

    expect(warnings(win)).toEqual([{ type: 'status', level: 'warning', message: READ_SAFE_SANDBOX_WARNING }]);

    // A restart doesn't repeat it.
    await sessionManager.stopQuery('test-rs-warn');
    await vi.waitFor(() => expect(sessionManager.getSession('test-rs-warn')?.queryHandle).toBeTruthy());
    expect(warnings(win)).toHaveLength(1);
    await sessionManager.destroySession('test-rs-warn');
  });

  it('warns when switching a running conversation into read-safe mode', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rs-switch', branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock',
    });
    await vi.waitFor(() => expect(sessionManager.getSession('test-rs-switch')?.queryHandle).toBeTruthy());
    expect(warnings(win)).toHaveLength(0);

    sessionManager.setMode('test-rs-switch', 'readSafe');

    expect(warnings(win).length).toBeGreaterThan(0);
    await sessionManager.destroySession('test-rs-switch');
  });

  it('does not warn in other modes', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rs-none', branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock', permissionMode: 'acceptEdits',
    });
    await vi.waitFor(() => expect(sessionManager.getSession('test-rs-none')?.queryHandle).toBeTruthy());
    expect(warnings(win)).toHaveLength(0);
    await sessionManager.destroySession('test-rs-none');
  });
});

describe('AgentSessionManager.setMode()', () => {
  it('refuses a mode the app does not offer, such as the SDK\'s bypassPermissions', async () => {
    await sessionManager.createSession({
      id: 'test-mode-bypass', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
    });
    await vi.waitFor(() => expect(sessionManager.getSession('test-mode-bypass')?.queryHandle).toBeTruthy());
    const session = sessionManager.getSession('test-mode-bypass')!;
    const before = session.permissionMode;

    sessionManager.setMode('test-mode-bypass', 'bypassPermissions');

    expect(session.permissionMode).toBe(before);
    expect(session.queryHandle!.setPermissionMode).not.toHaveBeenCalledWith('bypassPermissions');
    await sessionManager.destroySession('test-mode-bypass');
  });

  it('stores permissionMode on session even without queryHandle', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-mode',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    sessionManager.setMode('test-mode', 'acceptEdits');
    const session = sessionManager.getSession('test-mode');
    expect(session?.permissionMode).toBe('acceptEdits');

    await sessionManager.destroySession('test-mode');
  });

  it('passes acceptEdits through to the adapter', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-mode2',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    // Give time for queryHandle to be set
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    sessionManager.setMode('test-mode2', 'acceptEdits');

    const session = sessionManager.getSession('test-mode2');
    // Every app mode is passed to the adapter, which decides which it offers
    // per model; only modes outside PERMISSION_MODES are refused (test above).
    const handle = session?.queryHandle;
    if (handle?.setPermissionMode) {
      expect(handle.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
    }

    await sessionManager.destroySession('test-mode2');
  });
});

describe('AgentSessionManager.stopQuery()', () => {
  it('resolves all pending permissions as denied on stop', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-stop',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    let permResolved: PermissionResponse | null = null;
    mockAdapter.control!.permissionHandler!({
      requestId: 'a1', toolName: 'Bash', toolUseId: 'tu_1', toolInput: {},
    }).then((r) => { permResolved = r; });
    await new Promise((r) => setTimeout(r, 50));
    const modeSyncCount = () => sessionManager.getEventHistory('test-stop').filter((e) => e.type === 'mode_sync').length;
    const beforeStop = modeSyncCount();

    await sessionManager.stopQuery('test-stop');
    await new Promise((r) => setTimeout(r, 50));

    expect(permResolved).toMatchObject({ behavior: 'deny' });

    // Should have emitted mode_sync after stop
    expect(modeSyncCount()).toBeGreaterThan(beforeStop);

    await sessionManager.destroySession('test-stop');
  });

  it('starts a new query after stopping (adapter.start called again)', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-restart',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    expect(mockAdapter.startCallCount).toBe(1);

    await sessionManager.stopQuery('test-restart');
    await new Promise((r) => setTimeout(r, 100));

    // adapter.start() should have been called a second time
    expect(mockAdapter.startCallCount).toBe(2);

    await sessionManager.destroySession('test-restart');
  });
});

describe('AgentSessionManager.stopTask()', () => {
  it('forwards the task id to the live handle without touching the turn', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-stop-task',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    const handle = sessionManager.getSession('test-stop-task')?.queryHandle;

    await sessionManager.stopTask('test-stop-task', 'bg-42');

    expect((handle as any).stopTask).toHaveBeenCalledWith('bg-42');
    expect((handle as any).interrupt).not.toHaveBeenCalled();
    expect((handle as any).abort).not.toHaveBeenCalled();
    expect(mockAdapter.startCallCount).toBe(1);
    expect(sessionManager.getSession('test-stop-task')?.queryHandle).toBe(handle);

    await sessionManager.destroySession('test-stop-task');
  });

  it('rejects for an unknown session', async () => {
    await expect(sessionManager.stopTask('nope', 'bg-1')).rejects.toThrow(/not found/i);
  });

  it('rejects when the handle cannot stop tasks', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-stop-task-unsupported',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    const session = sessionManager.getSession('test-stop-task-unsupported')!;
    delete (session.queryHandle as any).stopTask;

    await expect(sessionManager.stopTask('test-stop-task-unsupported', 'bg-1')).rejects.toThrow(/cannot stop/i);

    await sessionManager.destroySession('test-stop-task-unsupported');
  });
});

describe('AgentSessionManager.interruptQuery()', () => {
  it('interrupts in place without respawning the query', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-interrupt',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    expect(mockAdapter.startCallCount).toBe(1);
    const handle = sessionManager.getSession('test-interrupt')?.queryHandle;
    const modeSyncCount = () => sessionManager.getEventHistory('test-interrupt').filter((e) => e.type === 'mode_sync').length;
    const beforeInterrupt = modeSyncCount();

    await sessionManager.interruptQuery('test-interrupt');
    await new Promise((r) => setTimeout(r, 50));

    // No respawn: adapter.start() not called again, same handle kept alive.
    expect(mockAdapter.startCallCount).toBe(1);
    expect((handle as any).interrupt).toHaveBeenCalledTimes(1);
    expect(sessionManager.getSession('test-interrupt')?.queryHandle).toBe(handle);

    // mode_sync emitted for parity with stopQuery (clears renderer guard).
    expect(modeSyncCount()).toBeGreaterThan(beforeInterrupt);

    await sessionManager.destroySession('test-interrupt');
  });

  it('resolves pending permissions as denied on interrupt', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-interrupt-perm',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    let permResolved: PermissionResponse | null = null;
    mockAdapter.control!.permissionHandler!({
      requestId: 'a1', toolName: 'Bash', toolUseId: 'tu_1', toolInput: {},
    }).then((r) => { permResolved = r; });
    await new Promise((r) => setTimeout(r, 50));

    await sessionManager.interruptQuery('test-interrupt-perm');
    await new Promise((r) => setTimeout(r, 50));

    expect(permResolved).toMatchObject({ behavior: 'deny' });
    expect(mockAdapter.startCallCount).toBe(1); // no respawn

    await sessionManager.destroySession('test-interrupt-perm');
  });

  it('falls back to stopQuery (respawn) when interrupt throws', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-interrupt-fail',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    const handle = sessionManager.getSession('test-interrupt-fail')?.queryHandle;
    (handle as any).interrupt.mockRejectedValueOnce(new Error('no active turn'));

    await sessionManager.interruptQuery('test-interrupt-fail');
    await new Promise((r) => setTimeout(r, 100));

    // Fallback teardown respawns the query.
    expect(mockAdapter.startCallCount).toBe(2);

    await sessionManager.destroySession('test-interrupt-fail');
  });

  it('falls back to stopQuery when there is no live query handle', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-interrupt-nohandle',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    const session = sessionManager.getSession('test-interrupt-nohandle');
    (session as any).queryHandle = null;

    await sessionManager.interruptQuery('test-interrupt-nohandle');
    await new Promise((r) => setTimeout(r, 100));

    // With no handle to interrupt, the teardown path respawns.
    expect(mockAdapter.startCallCount).toBe(2);

    await sessionManager.destroySession('test-interrupt-nohandle');
  });

  it('sanitizes abort/teardown errors from the result of an interrupted turn', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-interrupt-sanitize',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    // User clicks Stop → in-place interrupt.
    await sessionManager.interruptQuery('test-interrupt-sanitize');

    // The interrupted turn reports abort/teardown noise via the result event.
    mockAdapter.control!.emitEvent({
      type: 'result',
      subtype: 'error_during_execution',
      isError: true,
      errors: ['Error: File does not exist.', 'Error: Request was aborted.'],
    } as any);

    await vi.waitFor(() => {
      const history = sessionManager.getEventHistory('test-interrupt-sanitize');
      expect(history.some((e) => e.type === 'result')).toBe(true);
    });

    const result = sessionManager.getEventHistory('test-interrupt-sanitize')
      .find((e) => e.type === 'result') as any;
    expect(result.isError).toBe(false);
    expect(result.errors).toBeUndefined();

    await sessionManager.destroySession('test-interrupt-sanitize');
  });

  it('keeps genuine result errors when the turn was not interrupted', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-result-errors',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    // No interrupt — a real failure must still surface to the user.
    mockAdapter.control!.emitEvent({
      type: 'result',
      subtype: 'error_during_execution',
      isError: true,
      errors: ['Real tool failure'],
    } as any);

    await vi.waitFor(() => {
      const history = sessionManager.getEventHistory('test-result-errors');
      expect(history.some((e) => e.type === 'result')).toBe(true);
    });

    const result = sessionManager.getEventHistory('test-result-errors')
      .find((e) => e.type === 'result') as any;
    expect(result.isError).toBe(true);
    expect(result.errors).toEqual(['Real tool failure']);

    await sessionManager.destroySession('test-result-errors');
  });
});

describe('AgentSessionManager.healthCheckAll()', () => {
  it('marks running sessions with null queryHandle as stopped', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-health',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    // Simulate system_init to move to running
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-health');
    expect(session?.status).toBe('running');

    // Simulate query dying silently (null out queryHandle)
    (session as any).queryHandle = null;

    sessionManager.healthCheckAll();

    expect(session?.status).toBe('stopped');

    await sessionManager.destroySession('test-health');
  });
});

describe('AgentSessionManager.destroySession()', () => {
  it('removes session from the manager', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-destroy',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    expect(sessionManager.getSession('test-destroy')).toBeDefined();

    await sessionManager.destroySession('test-destroy');

    expect(sessionManager.getSession('test-destroy')).toBeUndefined();
  });

  it('resolves pending permissions as denied on destroy', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-destroy-perm',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    let permResolved: PermissionResponse | null = null;
    mockAdapter.control!.permissionHandler!({
      requestId: 'a1', toolName: 'Bash', toolUseId: 'tu_1', toolInput: {},
    }).then((r) => { permResolved = r; });
    await new Promise((r) => setTimeout(r, 50));

    await sessionManager.destroySession('test-destroy-perm');

    expect(permResolved).toMatchObject({ behavior: 'deny', message: 'Session destroyed' });
  });
});

describe('AgentSessionManager.closeSession()', () => {
  async function startSession(id: string) {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id, branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock',
    });
    await vi.waitFor(() => expect(sessionManager.getSession(id)?.queryHandle).toBeTruthy());
    return { win, session: sessionManager.getSession(id)! };
  }

  it('drops the live session, keeps its checkpoints and reports it stopped', async () => {
    const { win, session } = await startSession('test-close');
    const handle = session.queryHandle!;

    await sessionManager.closeSession('test-close');

    expect(handle.close).toHaveBeenCalled();
    expect(sessionManager.getSession('test-close')).toBeUndefined();
    expect(session.checkpoints.cleanup).not.toHaveBeenCalled();
    expect(win._send).toHaveBeenCalledWith(expect.any(String), 'test-close', 'stopped');
    // No process to clean up when the handle reports none
    expect(processTree.killTree).not.toHaveBeenCalled();
  });

  it('kills the agent process tree before closing its query', async () => {
    mockAdapter.pid = 4242;
    const { session } = await startSession('test-close-tree');
    const handle = session.queryHandle!;

    await sessionManager.closeSession('test-close-tree');

    expect(processTree.killTree).toHaveBeenCalledWith(4242);
    expect(processTree.killTree.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(handle.close).mock.invocationCallOrder[0]);
  });

  it('does not report the killed agent process as an error', async () => {
    mockAdapter.pid = 4343;
    const { win } = await startSession('test-close-quiet');
    processTree.killTree.mockImplementationOnce(async () => {
      mockAdapter.control!.error(new Error('Claude Code process exited with code 1'));
      await new Promise((r) => setTimeout(r, 10));
    });

    await sessionManager.closeSession('test-close-quiet');

    await new Promise((r) => setTimeout(r, 20));
    const errors = win._send.mock.calls.filter(([, event]: [string, AgentEvent | undefined]) => event?.type === 'error');
    expect(errors).toEqual([]);
  });

  it('resolves pending permissions as denied', async () => {
    await startSession('test-close-perm');
    let permResolved: PermissionResponse | null = null;
    mockAdapter.control!.permissionHandler!({
      requestId: 'a1', toolName: 'Bash', toolUseId: 'tu_1', toolInput: {},
    }).then((r) => { permResolved = r; });
    await new Promise((r) => setTimeout(r, 50));

    await sessionManager.closeSession('test-close-perm');

    expect(permResolved).toMatchObject({ behavior: 'deny', message: 'Conversation closed' });
  });

  it('makes a reopen wait until the old agent has shut down', async () => {
    mockAdapter.pid = 5150;
    await startSession('test-reopen');
    let releaseExit!: () => void;
    processTree.killTree.mockImplementationOnce(() => new Promise((r) => { releaseExit = () => r(); }));

    const closing = sessionManager.closeSession('test-reopen');
    expect(sessionManager.getSession('test-reopen')).toBeUndefined();
    const reopening = sessionManager.createSession({
      id: 'test-reopen', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
    });
    await vi.waitFor(() => expect(releaseExit).toBeDefined());
    await new Promise((r) => setTimeout(r, 20));
    expect(mockAdapter.startCallCount).toBe(1);

    releaseExit();
    await closing;
    await reopening;
    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(2));

    await sessionManager.destroySession('test-reopen');
  });

  it('shuts down an agent whose start() finishes after the close', async () => {
    let openGate!: () => void;
    mockAdapter.startGate = new Promise<void>((r) => { openGate = r; });
    await sessionManager.createSession({
      id: 'test-close-starting', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(1));

    await sessionManager.closeSession('test-close-starting');
    openGate();

    await vi.waitFor(() => expect(mockAdapter.lastHandle?.close).toHaveBeenCalled());
  });

  it('destroying a closed conversation cancels its pending auto-save and saves its metadata', async () => {
    await startSession('test-close-memory');
    await sessionManager.closeSession('test-close-memory');
    const { worktreeManager } = await import('./worktree-manager.js');
    vi.mocked(worktreeManager.getWorktreeOrManifest).mockResolvedValueOnce({
      id: 'test-close-memory', path: '/wt/test-close-memory', branch: 'feat-x', repoPath: '/repo', createdAt: 0,
    });
    const autosave = await import('./memory-autosave.js');
    vi.mocked(autosave.cancelAutoSave).mockClear();
    vi.mocked(autosave.saveSessionMetadata).mockClear();

    await sessionManager.destroySession('test-close-memory');

    expect(autosave.cancelAutoSave).toHaveBeenCalledWith('test-close-memory');
    expect(autosave.saveSessionMetadata).toHaveBeenCalledWith('/repo', 'test-close-memory', expect.any(Array), 'feat-x');
  });

  it('destroying a closed conversation still removes its checkpoint refs', async () => {
    await startSession('test-close-destroy');
    await sessionManager.closeSession('test-close-destroy');
    const { worktreeManager } = await import('./worktree-manager.js');
    vi.mocked(worktreeManager.getWorktreeOrManifest).mockResolvedValueOnce({
      id: 'test-close-destroy', path: '/wt/test-close-destroy', branch: 'main', repoPath: '/repo', createdAt: 0,
    });

    await sessionManager.destroySession('test-close-destroy');

    const { CheckpointManager } = await import('./checkpoints.js');
    const instances = (CheckpointManager as unknown as { instances: { cleanup: ReturnType<typeof vi.fn> }[] }).instances;
    expect(instances.at(-1)!.cleanup).toHaveBeenCalledWith('test-close-destroy', '/wt/test-close-destroy');
  });
});

describe('AgentSessionManager close/destroy during setup', () => {
  /** A setup (worktree, npm install) that creates the session when released. */
  function pendingSetup(id: string) {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const setup = gate.then(() => sessionManager.createSession({
      id, branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
    }));
    sessionManager.trackPendingSetup(id, setup);
    return { release, setup };
  }

  it('closing a conversation still being set up closes it once setup creates it', async () => {
    const { release } = pendingSetup('test-close-setup');

    const closing = sessionManager.closeSession('test-close-setup');
    release();
    await closing;

    expect(sessionManager.getSession('test-close-setup')).toBeUndefined();
    expect(mockAdapter.lastHandle?.close).toHaveBeenCalled();
  });

  it('destroying a conversation still being set up waits and destroys what setup created', async () => {
    const { release, setup } = pendingSetup('test-destroy-setup');
    let destroyed = false;

    const destroying = sessionManager.destroySession('test-destroy-setup').then(() => { destroyed = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(destroyed).toBe(false);

    release();
    await setup;
    const session = sessionManager.getSession('test-destroy-setup')!;
    await destroying;

    expect(sessionManager.getSession('test-destroy-setup')).toBeUndefined();
    expect(session.checkpoints.cleanup).toHaveBeenCalledWith('test-destroy-setup', '/repo');
  });

  it('deleting a conversation stops a setup that can stop', async () => {
    const abort = new AbortController();
    // Like a setup killed mid-install: it settles once aborted.
    const setup = new Promise<void>((resolve) => abort.signal.addEventListener('abort', () => resolve()));
    sessionManager.trackPendingSetup('test-destroy-abort', setup, abort);

    await sessionManager.destroySession('test-destroy-abort');

    expect(abort.signal.aborted).toBe(true);
  });

  it('closing a conversation lets its setup finish instead of stopping it', async () => {
    const abort = new AbortController();
    let release!: () => void;
    const setup = new Promise<void>((r) => { release = r; });
    sessionManager.trackPendingSetup('test-close-noabort', setup, abort);

    const closing = sessionManager.closeSession('test-close-noabort');
    release();
    await closing;

    expect(abort.signal.aborted).toBe(false);
  });

  it('a failed setup leaves nothing to close', async () => {
    sessionManager.trackPendingSetup('test-close-failed', Promise.reject(new Error('worktree failed')));
    await expect(sessionManager.closeSession('test-close-failed')).resolves.toBeUndefined();
    expect(sessionManager.getSession('test-close-failed')).toBeUndefined();
  });
});

describe('AgentSessionManager.closeAll()', () => {
  it('stops every live agent on quit and keeps their checkpoints', async () => {
    const sessions = [];
    for (const id of ['test-quit-a', 'test-quit-b']) {
      await sessionManager.createSession({
        id, branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
      });
      await vi.waitFor(() => expect(sessionManager.getSession(id)?.queryHandle).toBeTruthy());
      sessions.push(sessionManager.getSession(id)!);
    }
    await sessionManager.closeAll();

    expect(sessionManager.count).toBe(0);
    expect(sessionManager.closingCount).toBe(0);
    for (const session of sessions) {
      expect(session.queryHandle!.close).toHaveBeenCalled();
      expect(session.checkpoints.cleanup).not.toHaveBeenCalled();
    }
  });
});

describe('AgentSessionManager sleep and wake', () => {
  /** A live session whose provider session has initialised (status 'running'). */
  async function startSession(id: string) {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id, branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock',
    });
    await vi.waitFor(() => expect(sessionManager.getSession(id)?.queryHandle).toBeTruthy());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'provider-1', model: 'mock-model', tools: [] });
    await vi.waitFor(() => expect(sessionManager.getSession(id)?.status).toBe('running'));
    return { win, session: sessionManager.getSession(id)! };
  }

  const statusesSent = (win: ReturnType<typeof makeMockWindow>, id: string) =>
    win._send.mock.calls
      .filter(([channel, sessionId]: [string, string]) => channel === IPC.SESSION_STATUS && sessionId === id)
      .map(([, , status]: [string, string, string]) => status);

  it('kills the agent but keeps the session open and reports it sleeping', async () => {
    mockAdapter.pid = 6100;
    const { win, session } = await startSession('test-sleep');
    const handle = session.queryHandle!;

    expect(await sessionManager.sleepSession('test-sleep')).toBe(true);

    expect(processTree.killTree).toHaveBeenCalledWith(6100);
    expect(processTree.killTree.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(handle.close).mock.invocationCallOrder[0]);
    expect(sessionManager.getSession('test-sleep')).toBe(session);
    expect(session.status).toBe('sleeping');
    expect(session.queryHandle).toBeNull();
    expect(statusesSent(win, 'test-sleep').at(-1)).toBe('sleeping');

    await sessionManager.destroySession('test-sleep');
  });

  it('is not reported as the conversation ending or as an error', async () => {
    mockAdapter.pid = 6200;
    const { win } = await startSession('test-sleep-quiet');
    processTree.killTree.mockImplementationOnce(async () => {
      mockAdapter.control!.error(new Error('Claude Code process exited with code 1'));
      await new Promise((r) => setTimeout(r, 10));
    });

    await sessionManager.sleepSession('test-sleep-quiet');
    await new Promise((r) => setTimeout(r, 20));

    const events = win._send.mock.calls.map(([, event]: [string, AgentEvent | undefined]) => event?.type);
    expect(events).not.toContain('error');
    expect(events).not.toContain('process_exit');
    expect(statusesSent(win, 'test-sleep-quiet')).not.toContain('stopped');
    const { triggerAutoSaveImmediate } = await import('./memory-autosave.js');
    expect(triggerAutoSaveImmediate).not.toHaveBeenCalled();

    await sessionManager.destroySession('test-sleep-quiet');
  });

  it('wakes on the same transcript with its mode, controls and always-allowed tools', async () => {
    const { win, session } = await startSession('test-wake');
    sessionManager.setMode('test-wake', 'plan');
    await sessionManager.setControl('test-wake', 'thinking', 'low');
    session.alwaysAllowedTools.add('Bash(npm test)');

    await sessionManager.sleepSession('test-wake');
    sessionManager.wakeSession('test-wake');

    expect(session.status).toBe('running');
    expect(statusesSent(win, 'test-wake').at(-1)).toBe('running');
    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(2));
    expect(mockAdapter.lastConfig).toMatchObject({
      resumeSessionId: 'mock-session-id',
      permissionMode: 'plan',
      controls: expect.objectContaining({ thinking: 'low' }),
    });
    expect(mockAdapter.lastConfig!.alwaysAllowedTools).toBe(session.alwaysAllowedTools);
    expect(session.alwaysAllowedTools.has('Bash(npm test)')).toBe(true);

    await sessionManager.destroySession('test-wake');
  });

  it("won't sleep mid-turn, whatever the renderer thinks", async () => {
    await startSession('test-sleep-turn');

    await sessionManager.sendMessage('test-sleep-turn', 'run the tests');
    expect(await sessionManager.sleepSession('test-sleep-turn')).toBe(false);

    mockAdapter.control!.emitEvent({ type: 'result', subtype: 'success', isError: false });
    await vi.waitFor(async () => expect(await sessionManager.sleepSession('test-sleep-turn')).toBe(true));

    await sessionManager.destroySession('test-sleep-turn');
  });

  it('counts a turn the agent starts itself, and an interrupt ends it', async () => {
    await startSession('test-sleep-own-turn');

    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'A background task finished.', uuid: 'u1' });
    await vi.waitFor(() => expect(sessionManager.getSession('test-sleep-own-turn')!.turnHandle).not.toBeNull());
    expect(await sessionManager.sleepSession('test-sleep-own-turn')).toBe(false);

    await sessionManager.interruptQuery('test-sleep-own-turn');
    expect(await sessionManager.sleepSession('test-sleep-own-turn')).toBe(true);

    await sessionManager.destroySession('test-sleep-own-turn');
  });

  it('a background subagent working after the turn ends does not start one', async () => {
    const { win } = await startSession('test-sleep-subagent');

    mockAdapter.control!.emitEvent({
      type: 'assistant_tool_use', toolName: 'Grep', toolInput: {}, toolUseId: 'tu-sub', uuid: 'sub-1', parentToolUseId: 'tu-agent',
    });
    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'Report', uuid: 'sub-2', parentToolUseId: 'tu-agent' });
    // Drained in order: once this marker shows, the subagent's events were handled.
    mockAdapter.control!.emitEvent({ type: 'status', message: 'marker' });
    await vi.waitFor(() => expect(win._send.mock.calls.some(
      ([, event]: [string, AgentEvent | undefined]) => event?.type === 'status' && event.message === 'marker',
    )).toBe(true));

    expect(sessionManager.getSession('test-sleep-subagent')!.turnHandle).toBeNull();
    expect(await sessionManager.sleepSession('test-sleep-subagent')).toBe(true);

    await sessionManager.destroySession('test-sleep-subagent');
  });

  it('a stop while waking waits for the old agent and leaves one agent running', async () => {
    mockAdapter.pid = 7100;
    const { session } = await startSession('test-wake-stop');
    let releaseKill!: () => void;
    processTree.killTree.mockImplementationOnce(() => new Promise<void>((r) => { releaseKill = () => r(); }));
    const sleeping = sessionManager.sleepSession('test-wake-stop');
    await vi.waitFor(() => expect(releaseKill).toBeDefined());
    const startsBefore = mockAdapter.startCallCount;

    sessionManager.wakeSession('test-wake-stop');
    const sent = sessionManager.sendMessage('test-wake-stop', 'still there?');
    const stopping = sessionManager.interruptQuery('test-wake-stop');
    await new Promise((r) => setTimeout(r, 30));
    // Nothing starts while the old agent is still being killed
    expect(mockAdapter.startCallCount).toBe(startsBefore);

    releaseKill();
    await sleeping;
    await stopping;
    await expect(sent).resolves.toBe(true);
    const running = mockAdapter.handles.filter((h) => vi.mocked(h.close).mock.calls.length === 0);
    expect(running).toEqual([session.queryHandle]);

    await sessionManager.destroySession('test-wake-stop');
  });

  it('wakes when sent a message and delivers it to the new agent', async () => {
    const { session } = await startSession('test-wake-send');
    await sessionManager.sleepSession('test-wake-send');

    const sent = await sessionManager.sendMessage('test-wake-send', 'Are you there?');

    expect(sent).toBe(true);
    expect(mockAdapter.startCallCount).toBe(2);
    expect(session.status).toBe('running');
    expect(session.queryHandle).toBe(mockAdapter.lastHandle);
    expect(mockAdapter.lastHandle!.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'Are you there?' }));

    await sessionManager.destroySession('test-wake-send');
  });

  it('wakes back into starting when the agent had not initialised yet', async () => {
    await sessionManager.createSession({
      id: 'test-wake-starting', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
    });
    await vi.waitFor(() => expect(sessionManager.getSession('test-wake-starting')?.queryHandle).toBeTruthy());
    const session = sessionManager.getSession('test-wake-starting')!;
    expect(session.status).toBe('starting');

    expect(await sessionManager.sleepSession('test-wake-starting')).toBe(true);
    sessionManager.wakeSession('test-wake-starting');

    expect(session.status).toBe('starting');
    await sessionManager.destroySession('test-wake-starting');
  });

  it('stays awake while a permission is pending', async () => {
    const { session } = await startSession('test-sleep-perm');
    void mockAdapter.control!.permissionHandler!({
      requestId: 'a1', toolName: 'Bash', toolUseId: 'tu_1', toolInput: {},
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(await sessionManager.sleepSession('test-sleep-perm')).toBe(false);
    expect(session.status).toBe('running');
    expect(session.queryHandle).not.toBeNull();

    await sessionManager.destroySession('test-sleep-perm');
  });

  it('stays awake while its agent is still starting', async () => {
    let openGate!: () => void;
    mockAdapter.startGate = new Promise<void>((r) => { openGate = r; });
    await sessionManager.createSession({
      id: 'test-sleep-starting', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(1));

    expect(await sessionManager.sleepSession('test-sleep-starting')).toBe(false);
    expect(sessionManager.getSession('test-sleep-starting')!.status).toBe('starting');

    openGate();
    await vi.waitFor(() => expect(sessionManager.getSession('test-sleep-starting')?.queryHandle).toBeTruthy());
    await sessionManager.destroySession('test-sleep-starting');
  });

  it('is left alone by the wake-from-suspend health check', async () => {
    await startSession('test-sleep-health');
    sessionManager.captureSuspendState();
    await sessionManager.sleepSession('test-sleep-health');

    sessionManager.healthCheckAll();

    expect(sessionManager.getSession('test-sleep-health')!.status).toBe('sleeping');
    await sessionManager.destroySession('test-sleep-health');
  });

  it('a stop does not wake it', async () => {
    await startSession('test-sleep-stop');
    await sessionManager.sleepSession('test-sleep-stop');

    await sessionManager.interruptQuery('test-sleep-stop');
    await new Promise((r) => setTimeout(r, 20));

    expect(mockAdapter.startCallCount).toBe(1);
    expect(sessionManager.getSession('test-sleep-stop')!.status).toBe('sleeping');
    await sessionManager.destroySession('test-sleep-stop');
  });

  it('can be closed while asleep', async () => {
    const { win } = await startSession('test-sleep-close');
    await sessionManager.sleepSession('test-sleep-close');

    await sessionManager.closeSession('test-sleep-close');

    expect(sessionManager.getSession('test-sleep-close')).toBeUndefined();
    expect(statusesSent(win, 'test-sleep-close').at(-1)).toBe('stopped');
  });

  it('a close during the sleep waits for the agent to be killed', async () => {
    mockAdapter.pid = 6300;
    await startSession('test-sleep-close-race');
    let releaseKill!: () => void;
    processTree.killTree.mockImplementationOnce(() => new Promise((r) => { releaseKill = () => r(); }));

    const sleeping = sessionManager.sleepSession('test-sleep-close-race');
    const closing = sessionManager.closeSession('test-sleep-close-race');
    let closed = false;
    void closing.then(() => { closed = true; });
    await vi.waitFor(() => expect(releaseKill).toBeDefined());
    await new Promise((r) => setTimeout(r, 20));
    expect(closed).toBe(false);

    releaseKill();
    await sleeping;
    await closing;
    expect(closed).toBe(true);
    expect(mockAdapter.startCallCount).toBe(1);
  });
});

describe('AgentSessionManager.searchEventHistory()', () => {
  const log = (...texts: string[]) => texts.map((text) => JSON.stringify({ type: 'user_message', text })).join('\n') + '\n';

  afterEach(() => {
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
  });

  it('indexes a live session and picks up events emitted since the last search', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-search-live',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'fixed the parser', uuid: 'u1' });
    await new Promise((r) => setTimeout(r, 50));
    expect(sessionManager.searchEventHistory('test-search-live', 'parser', 10).map((h) => h.snippet))
      .toEqual(['fixed the parser']);

    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'parser tests pass', uuid: 'u2' });
    await new Promise((r) => setTimeout(r, 50));
    expect(sessionManager.searchEventHistory('test-search-live', 'parser', 10).map((h) => h.snippet))
      .toEqual(['parser tests pass', 'fixed the parser']);

    await sessionManager.destroySession('test-search-live');
    expect(sessionManager.searchEventHistory('test-search-live', 'parser', 10)).toEqual([]);
  });

  it('parses a stopped session log once and re-reads it only when it changes', () => {
    let content = log('investigate the parser bug', 'unrelated');
    vi.mocked(fs.statSync).mockImplementation(() => ({ mtimeMs: 1, size: content.length }) as fs.Stats);
    vi.mocked(fs.readFileSync).mockImplementation(() => content);

    sessionManager.beginSearch();
    expect(sessionManager.searchEventHistory('test-search-disk', 'parser', 10).map((h) => h.eventIndex)).toEqual([0]);
    sessionManager.beginSearch();
    expect(sessionManager.searchEventHistory('test-search-disk', 'bug', 10).map((h) => h.eventIndex)).toEqual([0]);
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);

    content = log('investigate the parser bug', 'unrelated', 'parser fixed');
    sessionManager.beginSearch();
    expect(sessionManager.searchEventHistory('test-search-disk', 'parser', 10).map((h) => h.eventIndex)).toEqual([2, 0]);
    expect(fs.readFileSync).toHaveBeenCalledTimes(2);
  });

  it('retries a log that failed to read instead of caching it as empty', () => {
    const content = log('parser');
    vi.mocked(fs.statSync).mockImplementation(() => ({ mtimeMs: 1, size: content.length }) as fs.Stats);
    vi.mocked(fs.readFileSync)
      .mockImplementationOnce(() => { throw new Error('EBUSY'); })
      .mockImplementationOnce(() => { throw new Error('EBUSY'); })
      .mockImplementation(() => content);

    expect(sessionManager.getEventHistory('test-read-busy')).toEqual([]);
    sessionManager.beginSearch();
    expect(sessionManager.searchEventHistory('test-search-busy', 'parser', 10)).toEqual([]);

    expect(sessionManager.getEventHistory('test-read-busy')).toHaveLength(1);
    sessionManager.beginSearch();
    expect(sessionManager.searchEventHistory('test-search-busy', 'parser', 10)).toHaveLength(1);
  });
});

describe('AgentSessionManager.sendMessage()', () => {
  it('forwards message to adapter queryHandle', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-send',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    const sent = await sessionManager.sendMessage('test-send', 'Hello agent');
    expect(sent).toBe(true);

    // Verify it was recorded in event history
    const history = sessionManager.getEventHistory('test-send');
    const userMsgs = history.filter((e) => e.type === 'user_message');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0]).toMatchObject({ type: 'user_message', text: 'Hello agent' });
    expect(userMsgs[0]).toHaveProperty('uuid');

    await sessionManager.destroySession('test-send');
  });

  it('saves attached images and records references to them, not the image data', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-send-images',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    const images = [{ data: 'iVBOR', mediaType: 'image/png' as const, name: 'shot.png' }];
    expect(await sessionManager.sendMessage('test-send-images', 'What is this?', images)).toBe(true);

    expect(attachments.saveImages).toHaveBeenCalledWith('test-send-images', images);
    const userMsgs = sessionManager.getEventHistory('test-send-images').filter((e) => e.type === 'user_message');
    expect(userMsgs[0]).toMatchObject({ text: 'What is this?', images: [{ file: 'img0.png', name: 'shot.png' }] });
    // The agent still gets the image data itself.
    expect(mockAdapter.lastHandle!.sendMessage).toHaveBeenCalledWith({ text: 'What is this?', images });

    await sessionManager.destroySession('test-send-images');
  });

  it('leaves images out for an agent that can\'t take them, and says so', async () => {
    (mockAdapter.capabilities as Record<string, boolean>).imageAttachments = false;
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-no-images', branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    const images = [{ data: 'iVBOR', mediaType: 'image/png' as const, name: 'shot.png' }];
    expect(await sessionManager.sendMessage('test-no-images', 'Look', images)).toBe(true);

    expect(attachments.saveImages).not.toHaveBeenCalled();
    expect(mockAdapter.lastHandle!.sendMessage).toHaveBeenCalledWith({ text: 'Look', images: undefined });
    const history = sessionManager.getEventHistory('test-no-images');
    expect(history.some((e) => e.type === 'status' && /can't take images/.test(e.message))).toBe(true);

    await sessionManager.destroySession('test-no-images');
  });

  it('records a tool result with references to the images the tool returned', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-tool-images',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    mockAdapter.control!.emitEvent({
      type: 'tool_result', toolUseId: 'tu1', content: '', imageData: [{ data: 'iVBOR', mediaType: 'image/png' }],
    } as any);

    await vi.waitFor(() => {
      const results = sessionManager.getEventHistory('test-tool-images').filter((e) => e.type === 'tool_result');
      expect(results).toEqual([{ type: 'tool_result', toolUseId: 'tu1', content: '', images: [{ file: 'tool0.png' }] }]);
    });
    // Only tool results with images go through the save.
    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'Looks fine', uuid: 'a1' });
    await vi.waitFor(() => expect(sessionManager.getEventHistory('test-tool-images').some((e) => e.type === 'assistant_text')).toBe(true));
    expect(attachments.storeToolImages).toHaveBeenCalledTimes(1);

    await sessionManager.destroySession('test-tool-images');
  });

  it('returns false for non-existent session', async () => {
    expect(await sessionManager.sendMessage('nonexistent', 'hello')).toBe(false);
  });

  it('waits for the first queryHandle instead of dropping a prompt sent during startup', async () => {
    // Hold adapter.start() open so the session exists with no handle yet —
    // the window in which the renderer's always-live input can already send.
    let openGate!: () => void;
    mockAdapter.startGate = new Promise<void>((r) => { openGate = r; });

    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-send-early',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    expect(mockAdapter.control).toBeNull();

    const pending = sessionManager.sendMessage('test-send-early', 'Hello before connect');
    // Not resolved (false) yet — it is waiting, not dropped
    let settled = false;
    pending.then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    openGate();
    expect(await pending).toBe(true);
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    const userMsgs = sessionManager.getEventHistory('test-send-early').filter((e) => e.type === 'user_message');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0]).toMatchObject({ type: 'user_message', text: 'Hello before connect' });

    await sessionManager.destroySession('test-send-early');
  });

  it('holds a prompt sent before setup has registered the session, then delivers it', async () => {
    // Worktree creation / npm install run before createSession(), but the
    // renderer already has the id and a live input. A prompt sent in that
    // window must wait for setup rather than bounce with "not connected".
    let finishSetup!: () => void;
    const setup = new Promise<void>((r) => { finishSetup = r; });
    sessionManager.trackPendingSetup('test-send-presetup', setup);

    const pending = sessionManager.sendMessage('test-send-presetup', 'Hello before setup');
    let settled = false;
    pending.then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-send-presetup',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    finishSetup();

    expect(await pending).toBe(true);
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    const userMsgs = sessionManager.getEventHistory('test-send-presetup').filter((e) => e.type === 'user_message');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0]).toMatchObject({ type: 'user_message', text: 'Hello before setup' });

    await sessionManager.destroySession('test-send-presetup');
  });

  it('keeps the order of prompts held during setup', async () => {
    let finishSetup!: () => void;
    const setup = new Promise<void>((r) => { finishSetup = r; });
    sessionManager.trackPendingSetup('test-send-order', setup);

    const first = sessionManager.sendMessage('test-send-order', 'first');
    const second = sessionManager.sendMessage('test-send-order', 'second');

    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-send-order',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    finishSetup();

    expect(await Promise.all([first, second])).toEqual([true, true]);
    const texts = sessionManager.getEventHistory('test-send-order')
      .filter((e) => e.type === 'user_message')
      .map((e) => (e as { text: string }).text);
    expect(texts).toEqual(['first', 'second']);

    await sessionManager.destroySession('test-send-order');
  });

  it('returns false when the pending setup fails without creating the session', async () => {
    let failSetup!: (err: Error) => void;
    const setup = new Promise<void>((_, reject) => { failSetup = reject; });
    sessionManager.trackPendingSetup('test-send-failed-setup', setup);

    const pending = sessionManager.sendMessage('test-send-failed-setup', 'Hello');
    failSetup(new Error('npm install failed'));
    expect(await pending).toBe(false);

    // The entry is cleared once settled: later sends fail fast, not hang.
    expect(await sessionManager.sendMessage('test-send-failed-setup', 'Hello again')).toBe(false);
  });
});

describe('AgentSessionManager.listSessions()', () => {
  it('returns info for all sessions', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'list-1', branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock',
    });
    await sessionManager.createSession({
      id: 'list-2', branch: 'feat', cwd: '/repo2', repoPath: '/repo2', window: win, adapterType: 'mock',
    });

    const sessions = sessionManager.listSessions();
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain('list-1');
    expect(ids).toContain('list-2');

    await sessionManager.destroySession('list-1');
    await sessionManager.destroySession('list-2');
  });
});

describe('AgentSessionManager.rewindFiles()', () => {
  it('stops a running turn before restoring files', async () => {
    await sessionManager.createSession({
      id: 'test-rewind-midturn', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
    });
    await vi.waitFor(() => expect(sessionManager.getSession('test-rewind-midturn')?.queryHandle).toBeTruthy());
    const session = sessionManager.getSession('test-rewind-midturn')!;
    await sessionManager.sendMessage('test-rewind-midturn', 'Refactor everything');
    const uuid = (session.eventHistory.find((e) => e.type === 'user_message') as { uuid: string }).uuid;
    const handle = session.queryHandle!;
    expect(sessionManager.isMidTurn('test-rewind-midturn')).toBe(true);

    await sessionManager.rewindFiles('test-rewind-midturn', uuid, { filesOnly: true });

    expect(handle.interrupt).toHaveBeenCalled();
    expect(vi.mocked(handle.interrupt!).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(session.checkpoints.restore).mock.invocationCallOrder[0]);
    await sessionManager.destroySession('test-rewind-midturn');
  });

  it('leaves an idle agent alone when restoring files only', async () => {
    await sessionManager.createSession({
      id: 'test-rewind-idle', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
    });
    await vi.waitFor(() => expect(sessionManager.getSession('test-rewind-idle')?.queryHandle).toBeTruthy());
    const session = sessionManager.getSession('test-rewind-idle')!;

    await sessionManager.rewindFiles('test-rewind-idle', 'gone-uuid', { filesOnly: true });

    expect(session.queryHandle!.interrupt).not.toHaveBeenCalled();
    expect(session.checkpoints.restore).toHaveBeenCalled();
    await sessionManager.destroySession('test-rewind-idle');
  });

  it('clears providerSessionId so the next query starts fresh', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rewind',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());

    // Simulate system_init to set providerSessionId
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'mock-session-id', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-rewind');
    expect(session?.providerSessionId).toBe('mock-session-id');

    // Send a user message to create event history with a UUID
    await sessionManager.sendMessage('test-rewind', 'Hello');
    await new Promise((r) => setTimeout(r, 50));

    const userMsg = session!.eventHistory.find((e) => e.type === 'user_message');
    expect(userMsg).toBeDefined();
    const uuid = (userMsg as any).uuid;

    // Rewind to that message
    await sessionManager.rewindFiles('test-rewind', uuid);
    await new Promise((r) => setTimeout(r, 50));

    // providerSessionId should be cleared
    expect(session?.providerSessionId).toBeNull();

    await sessionManager.destroySession('test-rewind');
  });

  it('restarts the query after rewind so SDK context is fresh', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rewind-restart',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    expect(mockAdapter.startCallCount).toBe(1);

    // Simulate system_init
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'mock-session-id', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    // Send a user message
    await sessionManager.sendMessage('test-rewind-restart', 'Hello');
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-rewind-restart');
    const userMsg = session!.eventHistory.find((e) => e.type === 'user_message');
    const uuid = (userMsg as any).uuid;

    // Rewind
    await sessionManager.rewindFiles('test-rewind-restart', uuid);
    await new Promise((r) => setTimeout(r, 100));

    // adapter.start() should be called again (query restarted)
    expect(mockAdapter.startCallCount).toBe(2);

    // Rewinding to the first message keeps no provider content, so the new
    // query starts a fresh conversation: no resume, no truncated fork.
    expect(mockAdapter.lastConfig?.resumeSessionId).toBeFalsy();
    expect(mockAdapter.lastConfig?.resumeAtUuid).toBeFalsy();

    await sessionManager.destroySession('test-rewind-restart');
  });

  it('truncates event history up to (excluding) the rewind target', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rewind-history',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    // Send two user messages
    await sessionManager.sendMessage('test-rewind-history', 'First message');
    await new Promise((r) => setTimeout(r, 50));
    await sessionManager.sendMessage('test-rewind-history', 'Second message');
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-rewind-history');
    const userMsgs = session!.eventHistory.filter((e) => e.type === 'user_message');
    expect(userMsgs).toHaveLength(2);

    // Rewind to the second message — should remove it from history
    const secondUuid = (userMsgs[1] as any).uuid;
    await sessionManager.rewindFiles('test-rewind-history', secondUuid);
    await new Promise((r) => setTimeout(r, 50));

    const remainingUserMsgs = session!.eventHistory.filter((e) => e.type === 'user_message');
    expect(remainingUserMsgs).toHaveLength(1);
    expect((remainingUserMsgs[0] as any).text).toBe('First message');

    // Images only the rewound turns showed are deleted: pruned against what's left.
    const [prunedId, keptEvents] = attachments.pruneImages.mock.calls.at(-1) as unknown as [string, AgentEvent[]];
    expect(prunedId).toBe('test-rewind-history');
    expect(keptEvents.filter((e) => e.type === 'user_message').map((e: any) => e.text)).toEqual(['First message']);

    await sessionManager.destroySession('test-rewind-history');
  });

  it('emits rewind event to renderer', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rewind-emit',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    await sessionManager.sendMessage('test-rewind-emit', 'Hello');
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-rewind-emit');
    const userMsg = session!.eventHistory.find((e) => e.type === 'user_message');
    const uuid = (userMsg as any).uuid;

    await sessionManager.rewindFiles('test-rewind-emit', uuid);
    await new Promise((r) => setTimeout(r, 50));

    // Check that rewind event was emitted
    const agentEventCalls = win._send.mock.calls.filter(
      (c: any[]) => c[0].includes('agent:event'),
    );
    const rewindEvent = agentEventCalls.find(
      (c: any[]) => c[1]?.type === 'rewind',
    );
    expect(rewindEvent).toBeDefined();
    expect(rewindEvent![1]).toMatchObject({ type: 'rewind', toMessageId: uuid });

    await sessionManager.destroySession('test-rewind-emit');
  });

  it('filesOnly restores the working tree and leaves the conversation, history and refs alone', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rewind-files-only',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'keep-me', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    await sessionManager.sendMessage('test-rewind-files-only', 'Hello');
    // The turn has finished: nothing to interrupt before the restore.
    mockAdapter.control!.emitEvent({ type: 'result', subtype: 'success', isError: false });
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-rewind-files-only')!;
    const historyBefore = session.eventHistory.length;
    const providerBefore = session.providerSessionId;
    expect(providerBefore).not.toBeNull();
    const control = mockAdapter.control;

    await sessionManager.rewindFiles('test-rewind-files-only', 'pre-clear-uuid', { filesOnly: true });
    await new Promise((r) => setTimeout(r, 50));

    expect(session.checkpoints.restore).toHaveBeenCalledWith('test-rewind-files-only', expect.any(String), 'pre-clear-uuid');
    expect(session.checkpoints.pruneAfter).not.toHaveBeenCalled();
    expect(session.providerSessionId).toBe(providerBefore);
    // Nothing truncated: only the rewind marker itself was appended
    expect(session.eventHistory.length).toBe(historyBefore + 1);
    expect(session.eventHistory.at(-1)).toMatchObject({ type: 'rewind', filesOnly: true });
    expect(session.eventHistory.some((e) => e.type === 'user_message')).toBe(true);
    // The query was not restarted
    expect(mockAdapter.control).toBe(control);

    const rewindEvent = win._send.mock.calls.find(
      (c: any[]) => c[0].includes('agent:event') && c[1]?.type === 'rewind',
    );
    expect(rewindEvent![1]).toMatchObject({ type: 'rewind', toMessageId: 'pre-clear-uuid', filesOnly: true });

    await sessionManager.destroySession('test-rewind-files-only');
  });

  it('starts the agent on a new conversation when it can\'t rewind', async () => {
    (mockAdapter.capabilities as Record<string, boolean>).rewind = false;
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rewind-fresh', branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'mock-session-id', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));
    await sessionManager.sendMessage('test-rewind-fresh', 'First');
    await new Promise((r) => setTimeout(r, 50));
    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'reply one', uuid: 'sdk-uuid-1' });
    await new Promise((r) => setTimeout(r, 50));
    await sessionManager.sendMessage('test-rewind-fresh', 'Second');
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-rewind-fresh');
    const secondUuid = (session!.eventHistory.filter((e) => e.type === 'user_message')[1] as any).uuid;
    await sessionManager.rewindFiles('test-rewind-fresh', secondUuid);
    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(2));
    await new Promise((r) => setTimeout(r, 50));

    // Resuming would bring back the rewound turns, so the agent starts over.
    expect(mockAdapter.lastConfig?.resumeSessionId).toBeNull();
    expect(mockAdapter.lastConfig?.resumeAtUuid).toBeNull();
    expect(session!.eventHistory.some((e) => e.type === 'status' && /can't forget part of a conversation/.test(e.message))).toBe(true);

    await sessionManager.destroySession('test-rewind-fresh');
  });

  it('forks the provider conversation at the last kept assistant message', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rewind-fork',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'mock-session-id', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    // Turn 1: user message + assistant reply carrying a provider uuid
    await sessionManager.sendMessage('test-rewind-fork', 'First');
    await new Promise((r) => setTimeout(r, 50));
    mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'reply one', uuid: 'sdk-uuid-1' });
    await new Promise((r) => setTimeout(r, 50));

    // Turn 2: the message we rewind away
    await sessionManager.sendMessage('test-rewind-fork', 'Second');
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-rewind-fork');
    const userMsgs = session!.eventHistory.filter((e) => e.type === 'user_message');
    const secondUuid = (userMsgs[1] as any).uuid;

    await sessionManager.rewindFiles('test-rewind-fork', secondUuid);
    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(2));
    await new Promise((r) => setTimeout(r, 50));

    // Provider session is kept so the restarted query resumes it, truncated
    // at the last kept assistant message and forked.
    expect(session?.providerSessionId).toBe('mock-session-id');
    expect(mockAdapter.lastConfig?.resumeSessionId).toBe('mock-session-id');
    expect(mockAdapter.lastConfig?.resumeAtUuid).toBe('sdk-uuid-1');
    // Consumed by the successful start
    expect(session?.pendingResumeAt).toBeNull();

    // The persisted id is blanked so a crash before the forked session's
    // system_init degrades to a fresh conversation, never the old one.
    const { worktreeManager } = await import('./worktree-manager.js');
    expect(vi.mocked(worktreeManager.saveProviderSessionId)).toHaveBeenCalledWith('test-rewind-fork', '');

    await sessionManager.destroySession('test-rewind-fork');
  });

  it('cancels any pending memory auto-save on rewind', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rewind-autosave',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    await sessionManager.sendMessage('test-rewind-autosave', 'Hello');
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-rewind-autosave');
    const userMsg = session!.eventHistory.find((e) => e.type === 'user_message');

    await sessionManager.rewindFiles('test-rewind-autosave', (userMsg as any).uuid);

    const autosave = await import('./memory-autosave.js');
    expect(vi.mocked(autosave.cancelAutoSave)).toHaveBeenCalledWith('test-rewind-autosave');

    await sessionManager.destroySession('test-rewind-autosave');
  });

  it('degrades to a files-only restore for a checkpoint whose message is no longer in the conversation', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-rewind-stale',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'mock-session-id', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));

    await sessionManager.sendMessage('test-rewind-stale', 'Hello');
    const session = sessionManager.getSession('test-rewind-stale')!;
    const userMessagesBefore = session.eventHistory.filter((e) => e.type === 'user_message');
    const startsBefore = mockAdapter.startCallCount;
    win._send.mockClear();

    // A uuid that only exists as a git ref (e.g. the target of an earlier
    // rewind) must not wipe the conversation by starting a fresh one.
    await sessionManager.rewindFiles('test-rewind-stale', 'not-in-history');
    await new Promise((r) => setTimeout(r, 50));

    expect(session.checkpoints.restore).toHaveBeenCalledWith('test-rewind-stale', expect.any(String), 'not-in-history');
    expect(session.checkpoints.pruneAfter).not.toHaveBeenCalled();
    expect(session.eventHistory.filter((e) => e.type === 'user_message')).toEqual(userMessagesBefore);
    expect(session.providerSessionId).toBe('mock-session-id');
    expect(mockAdapter.startCallCount).toBe(startsBefore);
    const rewindEvents = win._send.mock.calls
      .filter((c: any[]) => String(c[0]).startsWith('agent:event'))
      .map((c: any[]) => c[1])
      .filter((e: any) => e?.type === 'rewind');
    expect(rewindEvents).toEqual([{ type: 'rewind', toMessageId: 'not-in-history', filesOnly: true }]);

    await expect(
      sessionManager.rewindFiles('test-rewind-stale', 'not-in-history', { conversationOnly: true }),
    ).rejects.toThrow(/no longer part of the conversation/);

    await sessionManager.destroySession('test-rewind-stale');
  });
});

describe('AgentSessionManager checkpoint capture', () => {
  it('captures the baseline before the query starts and does not resume for a fresh session', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-cp-baseline',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    const session = sessionManager.getSession('test-cp-baseline')!;

    // Baseline is queued before adapter.start resolves, so no user prompt can
    // be captured ahead of it.
    expect(session.checkpoints.captureBaseline).toHaveBeenCalledWith('test-cp-baseline', expect.any(String));

    // system_init sets providerSessionId from the handle; that must not be
    // mistaken for a resumed session (which would skip the baseline).
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'mock-session-id', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(session.providerSessionId).toBe('mock-session-id');
    expect(session.checkpoints.resume).not.toHaveBeenCalled();
    expect(session.checkpoints.captureBaseline).toHaveBeenCalledTimes(1);

    await sessionManager.destroySession('test-cp-baseline');
  });

  it('resumes checkpoint state instead of capturing a baseline for a resumed provider session', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-cp-resume',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
      resumeSessionId: 'persisted-provider-id',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    const session = sessionManager.getSession('test-cp-resume')!;
    expect(session.checkpoints.captureBaseline).not.toHaveBeenCalled();

    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'persisted-provider-id', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(session.checkpoints.resume).toHaveBeenCalledWith('test-cp-resume', expect.any(String));
    expect(session.checkpoints.captureBaseline).not.toHaveBeenCalled();

    await sessionManager.destroySession('test-cp-resume');
  });

  it('waits for the checkpoint before handing the prompt to the agent', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-cp-order',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));
    const session = sessionManager.getSession('test-cp-order')!;

    let finishCapture!: (ok: boolean) => void;
    vi.mocked(session.checkpoints.capture).mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { finishCapture = resolve; }),
    );

    const pending = sessionManager.sendMessage('test-cp-order', 'Edit the files');
    await new Promise((r) => setTimeout(r, 20));
    // The prompt is in history (the thread shows it) but the agent has not
    // been given it while `git add -A` is still snapshotting the tree.
    expect(session.eventHistory.some((e) => e.type === 'user_message' && e.text === 'Edit the files')).toBe(true);
    expect(session.queryHandle!.sendMessage).not.toHaveBeenCalled();

    finishCapture(true);
    expect(await pending).toBe(true);
    expect(session.queryHandle!.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'Edit the files' }));
    expect(session.checkpoints.capture).toHaveBeenCalledWith('test-cp-order', expect.any(String), expect.any(String), 'Edit the files');

    await sessionManager.destroySession('test-cp-order');
  });

  it('still sends the prompt but tells the thread when the checkpoint could not be captured', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-cp-fail',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));
    const session = sessionManager.getSession('test-cp-fail')!;
    vi.mocked(session.checkpoints.capture).mockResolvedValueOnce(false);
    win._send.mockClear();

    expect(await sessionManager.sendMessage('test-cp-fail', 'Hello')).toBe(true);
    expect(session.queryHandle!.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello' }));

    const errors = session.eventHistory.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as any).message).toMatch(/Checkpoint could not be captured/);

    await sessionManager.destroySession('test-cp-fail');
  });

  it('says so once while captures keep failing, and again after one succeeds', async () => {
    await sessionManager.createSession({
      id: 'test-cp-repeat', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 's', model: 'm', tools: [] });
    await new Promise((r) => setTimeout(r, 50));
    const session = sessionManager.getSession('test-cp-repeat')!;
    const errorCount = () => session.eventHistory.filter((e) => e.type === 'error').length;

    vi.mocked(session.checkpoints.capture).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await sessionManager.sendMessage('test-cp-repeat', 'one');
    await sessionManager.sendMessage('test-cp-repeat', 'two');
    expect(errorCount()).toBe(1);

    vi.mocked(session.checkpoints.capture).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await sessionManager.sendMessage('test-cp-repeat', 'three');
    await sessionManager.sendMessage('test-cp-repeat', 'four');
    expect(errorCount()).toBe(2);

    await sessionManager.destroySession('test-cp-repeat');
  });
});

describe('AgentSessionManager model handling', () => {
  it('starts a new session with the adapter default model', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-model-default',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    // No defaultModel configured → falls back to getModels()[0].id
    expect(mockAdapter.lastConfig?.model).toBe('mock-model');

    await sessionManager.destroySession('test-model-default');
  });

  const BASE_SETTINGS = { defaultSystemPromptAppend: null, toolAllowRules: [], toolDenyRules: [], cavemanMode: 'off' };

  it('records which agent the conversation runs', async () => {
    await sessionManager.createSession({ id: 'test-agent-recorded', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock' });
    const { worktreeManager } = await import('./worktree-manager.js');
    expect(worktreeManager.saveAdapterType).toHaveBeenCalledWith('test-agent-recorded', 'mock');
    await sessionManager.destroySession('test-agent-recorded');
  });

  it("starts on this agent's saved default model", async () => {
    settingsMock.getSettings.mockReturnValueOnce({ ...BASE_SETTINGS, defaultModels: { mock: 'mock-saved', 'claude-code': 'claude-sonnet-4-6' } });
    await sessionManager.createSession({ id: 'test-model-saved', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock' });
    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.model).toBe('mock-saved');
    await sessionManager.destroySession('test-model-saved');
  });

  it("never hands another agent's default model to this agent", async () => {
    settingsMock.getSettings.mockReturnValueOnce({ ...BASE_SETTINGS, defaultModels: { 'claude-code': 'claude-sonnet-4-6' } });
    await sessionManager.createSession({ id: 'test-model-other', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock' });
    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.model).toBe('mock-model');
    await sessionManager.destroySession('test-model-other');
  });

  it('honours an explicit model passed to createSession (resume path)', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-model-explicit',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
      model: 'restored-model',
    });

    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.model).toBe('restored-model');

    await sessionManager.destroySession('test-model-explicit');
  });

  it('normalises a dated system_init model back to the picker id and persists it', async () => {
    const { worktreeManager } = await import('./worktree-manager.js') as any;
    const win = makeMockWindow();
    // Start from a different model so the normalised system_init value is a change
    await sessionManager.createSession({
      id: 'test-model-normalize',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
      model: 'restored-model',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    // SDK reports a dated alias of the known short id
    mockAdapter.control!.emitEvent({
      type: 'system_init',
      sessionId: 'mock-session-id',
      model: 'mock-model-20260101',
      tools: [],
    });
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-model-normalize');
    expect(session?.model).toBe('mock-model'); // normalised, not the dated string
    expect(worktreeManager.saveModel).toHaveBeenCalledWith('test-model-normalize', 'mock-model');

    await sessionManager.destroySession('test-model-normalize');
  });

  it('does not clobber session.model when system_init reports an unknown model', async () => {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-model-unknown',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
      model: 'restored-model',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({
      type: 'system_init',
      sessionId: 'mock-session-id',
      model: 'something-unrecognised',
      tools: [],
    });
    await new Promise((r) => setTimeout(r, 50));

    const session = sessionManager.getSession('test-model-unknown');
    expect(session?.model).toBe('restored-model'); // unchanged

    await sessionManager.destroySession('test-model-unknown');
  });

  it('persists the model on a live setModel switch', async () => {
    const { worktreeManager } = await import('./worktree-manager.js') as any;
    const win = makeMockWindow();
    await sessionManager.createSession({
      id: 'test-model-switch',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    await sessionManager.setModel('test-model-switch', 'mock-model');

    const session = sessionManager.getSession('test-model-switch');
    expect(session?.model).toBe('mock-model');
    expect(worktreeManager.saveModel).toHaveBeenCalledWith('test-model-switch', 'mock-model');

    await sessionManager.destroySession('test-model-switch');
  });
});

describe('AgentSessionManager stop/restart race', () => {
  it('relaunches the query when a stop arrives during startup (no hang, no dead handle)', async () => {
    let release!: () => void;
    mockAdapter.startGate = new Promise<void>((r) => { release = r; });
    const win = makeMockWindow();

    await sessionManager.createSession({
      id: 'test-race',
      branch: 'main',
      cwd: '/repo',
      repoPath: '/repo',
      window: win,
      adapterType: 'mock',
    });

    // The first start() has been entered and is blocked on the gate
    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(1));
    expect(sessionManager.getSession('test-race')?.queryHandle).toBeNull();

    // Stop while startup is still in flight — must not be dropped by the guard
    await sessionManager.stopQuery('test-race');

    // Release the blocked first start(); the in-flight run should relaunch
    release();

    // A fresh start() happens and installs a usable handle
    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(2));
    await vi.waitFor(() =>
      expect(sessionManager.getSession('test-race')?.queryHandle).not.toBeNull(),
    );

    // queryReady was resolved by the relaunch (not left hanging), so sendMessage works
    const ok = await sessionManager.sendMessage('test-race', 'hello');
    expect(ok).toBe(true);

    await sessionManager.destroySession('test-race');
  });
});

describe('AgentSessionManager wake-from-sleep', () => {
  async function makeRunningSession(id: string) {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id, branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock',
    });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'mock-session-id', model: 'mock-model', tools: [] });
    await vi.waitFor(() => expect(sessionManager.getSession(id)?.status).toBe('running'));
    return win;
  }

  it('marks a session whose query died during sleep as stopped and returns it to resume', async () => {
    const win = await makeRunningSession('test-sleep-dead');
    sessionManager.captureSuspendState();
    // Simulate the SDK query not surviving suspend.
    sessionManager.getSession('test-sleep-dead')!.queryHandle = null;

    const toResume = sessionManager.healthCheckAll();

    expect(toResume).toContain('test-sleep-dead');
    expect(sessionManager.getSession('test-sleep-dead')?.status).toBe('stopped');
    expect(win._send).toHaveBeenCalledWith(expect.any(String), 'test-sleep-dead', 'stopped');

    await sessionManager.destroySession('test-sleep-dead');
  });

  it('does not resume a session whose query survived sleep', async () => {
    await makeRunningSession('test-sleep-alive');
    sessionManager.captureSuspendState();
    // queryHandle intact → still running after the health check.

    const toResume = sessionManager.healthCheckAll();

    expect(toResume).not.toContain('test-sleep-alive');
    expect(sessionManager.getSession('test-sleep-alive')?.status).toBe('running');

    await sessionManager.destroySession('test-sleep-alive');
  });

  it('only resumes sessions captured at suspend, not ones started afterwards', async () => {
    await makeRunningSession('test-sleep-A');
    sessionManager.captureSuspendState(); // snapshot contains only A
    await makeRunningSession('test-sleep-B'); // started after the snapshot

    sessionManager.getSession('test-sleep-A')!.queryHandle = null;
    sessionManager.getSession('test-sleep-B')!.queryHandle = null;

    const toResume = sessionManager.healthCheckAll();

    expect(toResume).toContain('test-sleep-A');
    expect(toResume).not.toContain('test-sleep-B');
    // B is still marked stopped (health check marks every dead query)…
    expect(sessionManager.getSession('test-sleep-B')?.status).toBe('stopped');

    await sessionManager.destroySession('test-sleep-A');
    await sessionManager.destroySession('test-sleep-B');
  });
});

describe('AgentSessionManager resume of a missing conversation', () => {
  const missing = (providerSessionId?: string) =>
    new ResumeNotFoundError(`No conversation found with session ID: ${providerSessionId}`);

  /** Start a session resuming `providerSessionId`; returns once its query is up. */
  async function startResume(id: string, providerSessionId?: string) {
    const win = makeMockWindow();
    await sessionManager.createSession({
      id, branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock',
      resumeSessionId: providerSessionId,
    });
    await vi.waitFor(() => expect(sessionManager.getSession(id)?.queryHandle).not.toBeNull());
    await new Promise((r) => setTimeout(r, 10));
    return win;
  }

  /** Resume `providerSessionId` and fail the run the way Claude Code does
   *  when that conversation's transcript is gone. */
  async function resumeMissing(id: string, providerSessionId?: string) {
    const win = await startResume(id, providerSessionId);
    mockAdapter.control!.error(missing(providerSessionId));
    return win;
  }

  const eventsOf = (win: ReturnType<typeof makeMockWindow>) =>
    win._send.mock.calls.map(([, event]: [string, AgentEvent | string]) => event).filter((e: unknown) => typeof e === 'object') as AgentEvent[];
  const sentTexts = (handle: AgentQueryHandle) => vi.mocked(handle.sendMessage).mock.calls.map(([m]) => m.text);

  it('forgets the missing conversation and starts a new one', async () => {
    const win = await resumeMissing('test-gone', 'gone-id');

    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(2));
    expect(mockAdapter.lastConfig?.resumeSessionId).toBeNull();
    expect(mockAdapter.lastConfig?.resumeAtUuid).toBeNull();
    const { worktreeManager } = await import('./worktree-manager.js');
    expect(worktreeManager.saveProviderSessionId).toHaveBeenCalledWith('test-gone', '');

    const events = eventsOf(win);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'status', level: 'warning', newConversation: true, message: expect.stringContaining("couldn't find this conversation"),
    }));
    // Not reported as stopped: the renderer would resume the same id again.
    expect(events.some((e) => e.type === 'process_exit' || e.type === 'error')).toBe(false);
    expect(win._send).not.toHaveBeenCalledWith(expect.any(String), 'test-gone', 'stopped');

    // The new conversation takes messages as usual.
    await vi.waitFor(() => expect(sessionManager.getSession('test-gone')?.queryHandle).toBe(mockAdapter.lastHandle));
    expect(await sessionManager.sendMessage('test-gone', 'hello')).toBe(true);
    expect(mockAdapter.lastHandle!.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' }));

    await sessionManager.destroySession('test-gone');
  });

  it('holds a message sent during the restart for the new conversation', async () => {
    const win = await resumeMissing('test-gone-send', 'gone-id');
    const sending = sessionManager.sendMessage('test-gone-send', 'held');

    expect(await sending).toBe(true);
    expect(mockAdapter.startCallCount).toBe(2);
    expect(mockAdapter.lastHandle!.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'held' }));
    expect(eventsOf(win).some((e) => e.type === 'error')).toBe(false);

    await sessionManager.destroySession('test-gone-send');
  });

  it('sends the new conversation a prompt the missing one never answered, ahead of later ones', async () => {
    await startResume('test-gone-early', 'gone-id');
    const oldHandle = mockAdapter.lastHandle!;
    // Sent while the agent is still starting, before it reports the error.
    expect(await sessionManager.sendMessage('test-gone-early', 'early')).toBe(true);
    expect(sentTexts(oldHandle)).toEqual(['early']);

    mockAdapter.control!.error(missing('gone-id'));
    const later = sessionManager.sendMessage('test-gone-early', 'later');

    await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(2));
    const newHandle = mockAdapter.lastHandle!;
    expect(await later).toBe(true);
    await vi.waitFor(() => expect(sentTexts(newHandle)).toEqual(['early', 'later']));
    // A turn is running, so the conversation can't be put to sleep under it.
    expect(sessionManager.getSession('test-gone-early')?.turnHandle).toBe(newHandle);

    await sessionManager.destroySession('test-gone-early');
  });

  it('does not resend prompts the agent already had once it reported in', async () => {
    await startResume('test-gone-init', 'kept-id');
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'kept-id', model: 'mock-model', tools: [] });
    await vi.waitFor(() => expect(sessionManager.getSession('test-gone-init')?.status).toBe('running'));
    await sessionManager.sendMessage('test-gone-init', 'answered');

    expect(sessionManager.getSession('test-gone-init')?.promptsBeforeInit).toBeNull();

    await sessionManager.destroySession('test-gone-init');
  });

  it('holds no prompts for a fresh conversation, which has nothing to lose', async () => {
    await startResume('test-gone-none');
    await sessionManager.sendMessage('test-gone-none', 'hi');

    expect(sessionManager.getSession('test-gone-none')?.promptsBeforeInit).toBeNull();

    await sessionManager.destroySession('test-gone-none');
  });

  it('tells the renderer when the new conversation fails to start', async () => {
    const win = await startResume('test-gone-fail', 'gone-id');
    mockAdapter.start = vi.fn(async () => { throw new Error('spawn failed'); });
    mockAdapter.control!.error(missing('gone-id'));

    await vi.waitFor(() => expect(win._send).toHaveBeenCalledWith(expect.any(String), 'test-gone-fail', 'error'));
    expect(sessionManager.getSession('test-gone-fail')?.status).toBe('error');

    await sessionManager.destroySession('test-gone-fail');
  });

  it('reports the error when the run was not a resume', async () => {
    const win = await resumeMissing('test-gone-fresh');

    await vi.waitFor(() => expect(sessionManager.getSession('test-gone-fresh')?.status).toBe('stopped'));
    expect(mockAdapter.startCallCount).toBe(1);
    expect(eventsOf(win)).toContainEqual(expect.objectContaining({ type: 'error' }));

    await sessionManager.destroySession('test-gone-fresh');
  });

  describe('rewind afterwards', () => {
    /** Turns one and two ran in a conversation whose transcript then went
     *  missing on a restart; three and four ran in the new one. */
    async function conversationAfterSwitch(id: string) {
      const win = makeMockWindow();
      await sessionManager.createSession({ id, branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock' });
      await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
      const turn = async (text: string, replyUuid?: string) => {
        await sessionManager.sendMessage(id, text);
        if (replyUuid) mockAdapter.control!.emitEvent({ type: 'assistant_text', text: 'reply', uuid: replyUuid });
        mockAdapter.control!.emitEvent({ type: 'result', subtype: 'success', isError: false });
        await new Promise((r) => setTimeout(r, 20));
      };
      mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'mock-session-id', model: 'mock-model', tools: [] });
      await turn('one', 'old-1');
      await turn('two', 'old-2');

      // Restarted on the same transcript, which is gone by now.
      await sessionManager.stopQuery(id);
      await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(2));
      expect(mockAdapter.lastConfig?.resumeSessionId).toBe('mock-session-id');
      await vi.waitFor(() => expect(sessionManager.getSession(id)?.queryHandle).toBe(mockAdapter.lastHandle));
      await new Promise((r) => setTimeout(r, 10));
      mockAdapter.control!.error(missing('mock-session-id'));
      await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(3));
      await vi.waitFor(() => expect(sessionManager.getSession(id)?.queryHandle).toBe(mockAdapter.lastHandle));

      mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: 'mock-session-id', model: 'mock-model', tools: [] });
      await turn('three', 'new-1');
      await turn('four');

      const session = sessionManager.getSession(id)!;
      const uuidOf = (text: string) =>
        (session.eventHistory.find((e) => e.type === 'user_message' && e.text === text) as { uuid: string }).uuid;
      const rewind = async (text: string) => {
        await sessionManager.rewindFiles(id, uuidOf(text));
        await vi.waitFor(() => expect(mockAdapter.startCallCount).toBe(4));
      };
      return { session, rewind };
    }

    const markers = (events: AgentEvent[]) => events.filter((e) => e.type === 'status' && e.newConversation);

    it('forks inside the new conversation', async () => {
      const { rewind } = await conversationAfterSwitch('test-gone-rw-fork');
      await rewind('four');

      expect(mockAdapter.lastConfig?.resumeAtUuid).toBe('new-1');

      await sessionManager.destroySession('test-gone-rw-fork');
    });

    it('starts over, not forking into the lost conversation, from the new one\'s first message', async () => {
      const { session, rewind } = await conversationAfterSwitch('test-gone-rw-first');
      await rewind('three');

      expect(mockAdapter.lastConfig?.resumeAtUuid).toBeNull();
      expect(mockAdapter.lastConfig?.resumeSessionId).toBeNull();
      // The marker from the switch still bounds the kept turns.
      expect(markers(session.eventHistory)).toHaveLength(1);

      await sessionManager.destroySession('test-gone-rw-first');
    });

    it('starts over from a message in the lost conversation and marks where', async () => {
      const { session, rewind } = await conversationAfterSwitch('test-gone-rw-old');
      await rewind('two');

      expect(mockAdapter.lastConfig?.resumeAtUuid).toBeNull();
      expect(mockAdapter.lastConfig?.resumeSessionId).toBeNull();
      // The switch's marker went with the rewound turns; old-1 is still kept,
      // so a new marker stops a later rewind from forking at it.
      expect(markers(session.eventHistory)).toEqual([expect.objectContaining({ message: expect.stringContaining('starts a new conversation from here') })]);
      const markerAt = session.eventHistory.findIndex((e) => e.type === 'status' && e.newConversation);
      expect(markerAt).toBeGreaterThan(session.eventHistory.findIndex((e) => e.type === 'assistant_text' && e.uuid === 'old-1'));

      await sessionManager.destroySession('test-gone-rw-old');
    });
  });
});

describe('AgentSessionManager session controls', () => {
  const SETTINGS = {
    defaultSystemPromptAppend: null,
    toolAllowRules: [],
    toolDenyRules: [],
    cavemanMode: 'off',
  };

  async function createWithHandle(id: string) {
    await sessionManager.createSession({ id, branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock' });
    await vi.waitFor(() => expect(mockAdapter.control).not.toBeNull());
    mockAdapter.control!.emitEvent({ type: 'system_init', sessionId: id, model: 'mock-model', tools: [] });
    await new Promise((r) => setTimeout(r, 50));
    return sessionManager.getSession(id)!;
  }

  it('starts from descriptor defaults, overlaid with the adapter\'s saved defaults, and passes them to the adapter', async () => {
    settingsMock.getSettings.mockReturnValueOnce({ ...SETTINGS, adapterDefaults: { mock: { thinking: 'low' } } });

    await sessionManager.createSession({ id: 'ctl-defaults', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock' });

    const controls = await sessionManager.getControls('ctl-defaults');
    expect(controls.descriptors.map((d) => d.id)).toEqual(['permissionMode', 'thinking', 'speed']);
    expect(controls.values).toEqual({ thinking: 'low', speed: 'standard' });
    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.controls).toEqual({ thinking: 'low', speed: 'standard' });

    await sessionManager.destroySession('ctl-defaults');
  });

  it('lays values chosen for this conversation over the saved defaults, ignoring ones not offered', async () => {
    settingsMock.getSettings.mockReturnValueOnce({ ...SETTINGS, adapterDefaults: { mock: { thinking: 'low' } } });

    await sessionManager.createSession({
      id: 'ctl-chosen', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
      controls: { thinking: 'high', speed: 'warp' },
    });

    expect((await sessionManager.getControls('ctl-chosen')).values).toEqual({ thinking: 'high', speed: 'standard' });

    await sessionManager.destroySession('ctl-chosen');
  });

  it('keeps the saved default when the chosen value is not offered', async () => {
    settingsMock.getSettings.mockReturnValueOnce({ ...SETTINGS, adapterDefaults: { mock: { thinking: 'low' } } });

    await sessionManager.createSession({
      id: 'ctl-chosen-bad', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
      controls: { thinking: 'max' },
    });

    expect((await sessionManager.getControls('ctl-chosen-bad')).values.thinking).toBe('low');

    await sessionManager.destroySession('ctl-chosen-bad');
  });

  it('ignores saved defaults the adapter does not offer, and other adapters\' defaults', async () => {
    settingsMock.getSettings.mockReturnValueOnce({ ...SETTINGS, adapterDefaults: { mock: { thinking: 'adaptive', bogus: 'x' }, other: { thinking: 'low' } } });

    await sessionManager.createSession({ id: 'ctl-unknown-default', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock' });

    expect((await sessionManager.getControls('ctl-unknown-default')).values.thinking).toBe('high');

    await sessionManager.destroySession('ctl-unknown-default');
  });

  it('starts in the agent\'s saved default mode, passes it to the adapter, and tells the renderer', async () => {
    settingsMock.getSettings.mockReturnValueOnce({ ...SETTINGS, adapterDefaults: { mock: { permissionMode: 'acceptEdits' }, other: { permissionMode: 'plan' } } });
    const win = makeMockWindow();

    await sessionManager.createSession({ id: 'ctl-mode-default', branch: 'main', cwd: '/repo', repoPath: '/repo', window: win, adapterType: 'mock' });

    expect(sessionManager.getSession('ctl-mode-default')?.permissionMode).toBe('acceptEdits');
    // Kept out of the other control values: the mode has its own field.
    expect((await sessionManager.getControls('ctl-mode-default')).values).not.toHaveProperty('permissionMode');
    const sync = { type: 'mode_sync', mode: 'acceptEdits', source: 'session' };
    expect(sessionManager.getEventHistory('ctl-mode-default')).toContainEqual(sync);
    expect(win.webContents.send).toHaveBeenCalledWith(`${IPC.AGENT_EVENT}:ctl-mode-default`, sync);
    await vi.waitFor(() => expect(mockAdapter.lastConfig).not.toBeNull());
    expect(mockAdapter.lastConfig?.permissionMode).toBe('acceptEdits');

    await sessionManager.destroySession('ctl-mode-default');
  });

  it('starts in the default mode when none is saved, and tells the renderer', async () => {
    settingsMock.getSettings.mockReturnValueOnce({ ...SETTINGS, adapterDefaults: {} });

    await sessionManager.createSession({ id: 'ctl-mode-unset', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock' });

    expect(sessionManager.getSession('ctl-mode-unset')?.permissionMode).toBe('default');
    expect(sessionManager.getEventHistory('ctl-mode-unset')).toContainEqual({ type: 'mode_sync', mode: 'default', source: 'session' });

    await sessionManager.destroySession('ctl-mode-unset');
  });

  it('falls a saved mode the model does not offer back to the adapter default', async () => {
    // mock-lite has no native auto mode (like Claude's Haiku).
    settingsMock.getSettings.mockReturnValueOnce({ ...SETTINGS, adapterDefaults: { mock: { permissionMode: 'auto' } } });

    await sessionManager.createSession({ id: 'ctl-mode-fallback', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock', model: 'mock-lite' });

    expect(sessionManager.getSession('ctl-mode-fallback')?.permissionMode).toBe('default');
    expect(sessionManager.getEventHistory('ctl-mode-fallback')).toContainEqual({ type: 'mode_sync', mode: 'default', source: 'session' });

    await sessionManager.destroySession('ctl-mode-fallback');
  });

  it('ignores a saved mode no adapter offers, such as the removed Bypass Permissions', async () => {
    settingsMock.getSettings.mockReturnValueOnce({ ...SETTINGS, adapterDefaults: { mock: { permissionMode: 'bypassPermissions' } } });

    await sessionManager.createSession({ id: 'ctl-mode-bypass', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock' });

    expect(sessionManager.getSession('ctl-mode-bypass')?.permissionMode).toBe('default');

    await sessionManager.destroySession('ctl-mode-bypass');
  });

  it('emits controls_sync once the query reports system_init', async () => {
    await createWithHandle('ctl-init');

    const history = sessionManager.getEventHistory('ctl-init');
    const sync = history.find((e) => e.type === 'controls_sync') as Extract<AgentEvent, { type: 'controls_sync' }> | undefined;
    expect(sync?.descriptors.map((d) => d.id)).toEqual(['permissionMode', 'thinking', 'speed']);
    expect(sync?.values).toEqual({ thinking: 'high', speed: 'standard' });

    await sessionManager.destroySession('ctl-init');
  });

  it('setControl records the value, forwards it to the live handle, and emits controls_sync', async () => {
    const session = await createWithHandle('ctl-set');

    await sessionManager.setControl('ctl-set', 'thinking', 'low');

    expect(session.controls.thinking).toBe('low');
    expect(session.queryHandle?.setControl).toHaveBeenCalledWith('thinking', 'low');
    const syncs = sessionManager.getEventHistory('ctl-set').filter((e) => e.type === 'controls_sync') as Extract<AgentEvent, { type: 'controls_sync' }>[];
    expect(syncs.at(-1)?.values.thinking).toBe('low');

    await sessionManager.destroySession('ctl-set');
  });

  it('setControl records the value without a live handle so the next query start picks it up', async () => {
    await sessionManager.createSession({ id: 'ctl-idle', branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock' });
    const session = sessionManager.getSession('ctl-idle')!;
    session.queryHandle = null;

    await sessionManager.setControl('ctl-idle', 'speed', 'fast');

    expect(session.controls.speed).toBe('fast');

    await sessionManager.destroySession('ctl-idle');
  });

  it('setControl rejects unknown controls, values the model does not offer, and permissionMode', async () => {
    await createWithHandle('ctl-reject');

    await expect(sessionManager.setControl('ctl-reject', 'nope', 'x')).rejects.toThrow(/Unknown control/);
    await expect(sessionManager.setControl('ctl-reject', 'thinking', 'adaptive')).rejects.toThrow(/not a valid Thinking option/);
    await expect(sessionManager.setControl('ctl-reject', 'permissionMode', 'plan')).rejects.toThrow(/setMode/);

    await sessionManager.destroySession('ctl-reject');
  });

  it('setModel drops values the new model no longer offers and re-emits controls_sync', async () => {
    const session = await createWithHandle('ctl-model');
    await sessionManager.setControl('ctl-model', 'speed', 'fast');
    expect(session.controls.speed).toBe('fast');

    await sessionManager.setModel('ctl-model', 'mock-lite');

    const controls = await sessionManager.getControls('ctl-model');
    expect(controls.descriptors.map((d) => d.id)).toEqual(['permissionMode', 'thinking']);
    expect(controls.values).toEqual({ thinking: 'high' });
    expect(session.controls).toEqual({ thinking: 'high' });
    const syncs = sessionManager.getEventHistory('ctl-model').filter((e) => e.type === 'controls_sync') as Extract<AgentEvent, { type: 'controls_sync' }>[];
    expect(syncs.at(-1)?.values).toEqual({ thinking: 'high' });

    await sessionManager.destroySession('ctl-model');
  });

  it('setModel falls the permission mode back to the default when the new model does not offer it', async () => {
    const session = await createWithHandle('ctl-mode-model');
    sessionManager.setMode('ctl-mode-model', 'auto');
    expect(session.permissionMode).toBe('auto');
    expect(session.queryHandle!.setPermissionMode).toHaveBeenLastCalledWith('auto');

    await sessionManager.setModel('ctl-mode-model', 'mock-lite');

    expect(session.permissionMode).toBe('default');
    expect(session.queryHandle!.setPermissionMode).toHaveBeenLastCalledWith('default');
    const syncs = sessionManager.getEventHistory('ctl-mode-model').filter((e) => e.type === 'mode_sync') as Extract<AgentEvent, { type: 'mode_sync' }>[];
    expect(syncs.at(-1)).toEqual({ type: 'mode_sync', mode: 'default', source: 'session' });

    // A mode the new model still offers is left alone.
    sessionManager.setMode('ctl-mode-model', 'readSafe');
    await sessionManager.setModel('ctl-mode-model', 'mock-model');
    expect(session.permissionMode).toBe('readSafe');

    await sessionManager.destroySession('ctl-mode-model');
  });

  it('setModel pushes control values reset for the new model to the live query', async () => {
    const session = await createWithHandle('ctl-push');
    await sessionManager.setControl('ctl-push', 'speed', 'fast');
    await sessionManager.setControl('ctl-push', 'thinking', 'low');
    const setControl = session.queryHandle!.setControl as ReturnType<typeof vi.fn>;
    setControl.mockClear();

    // Back to the full model: 'speed' reappears at its default, 'thinking' is unchanged.
    await sessionManager.setModel('ctl-push', 'mock-lite');
    await sessionManager.setModel('ctl-push', 'mock-model');

    expect(session.controls).toEqual({ thinking: 'low', speed: 'standard' });
    expect(setControl).toHaveBeenCalledWith('speed', 'standard');
    expect(setControl).not.toHaveBeenCalledWith('thinking', expect.anything());

    await sessionManager.destroySession('ctl-push');
  });

  it('getUsage returns the live handle usage, and null without a handle or when it throws', async () => {
    const session = await createWithHandle('ctl-usage');

    await expect(sessionManager.getUsage('ctl-usage')).resolves.toMatchObject({ available: true, plan: 'max' });

    (session.queryHandle!.getUsage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('sdk changed'));
    await expect(sessionManager.getUsage('ctl-usage')).resolves.toBeNull();

    session.queryHandle = null;
    await expect(sessionManager.getUsage('ctl-usage')).resolves.toBeNull();
    await expect(sessionManager.getUsage('never-created')).resolves.toBeNull();

    await sessionManager.destroySession('ctl-usage');
  });

  it('getControls for an unknown session falls back to the default adapter descriptors', async () => {
    const controls = await sessionManager.getControls('never-created');
    expect(controls.descriptors.map((d) => d.id)).toEqual(['permissionMode', 'thinking', 'speed']);
    expect(controls.values).toEqual({});
  });

  it('getControls for a conversation that is not running uses its recorded agent and model', async () => {
    const { worktreeManager } = await import('./worktree-manager.js');
    const other = { ...new MockAdapter(), id: 'other' } as unknown as AgentAdapter;
    other.getControls = vi.fn(() => [{ id: 'acp:mode', label: 'Agent mode', default: 'build', options: [{ value: 'build', label: 'build' }] }]);
    extraAdapters.other = other;
    vi.mocked(worktreeManager.getAgentAndModel).mockResolvedValueOnce({ adapterType: 'other', model: 'other-model' });

    const controls = await sessionManager.getControls('asleep');
    expect(controls.descriptors.map((d) => d.id)).toEqual(['acp:mode']);
    expect(other.getControls).toHaveBeenCalledWith('other-model');
    expect(controls.values).toEqual({});
  });
});

describe('AgentSessionManager skill suggestions', () => {
  const conversation = (id: string, agentType: string, lastActiveAt: number) =>
    ({ id, agentType, lastActiveAt, createdAt: 0, path: `/wt/${id}`, branch: id, repoPath: '/repo' });

  async function mocks() {
    const { worktreeManager } = await import('./worktree-manager.js');
    const suggestions = await import('./skill-suggestions.js');
    return { list: vi.mocked(worktreeManager.list), analyzeRepo: vi.mocked(suggestions.analyzeRepo) };
  }

  it("runs on the newest agent with skills, reads only that agent's conversations, and uses its background model", async () => {
    const withSkills = mockAdapter as unknown as { capabilities: Record<string, boolean>; backgroundModel?: string; generateText?: unknown };
    withSkills.capabilities = { ...mockAdapter.capabilities, skills: true };
    withSkills.backgroundModel = 'cheap-model';
    const generateText = vi.fn(async () => '[]');
    withSkills.generateText = generateText;
    extraAdapters.other = { ...new MockAdapter(), id: 'other', capabilities: { ...mockAdapter.capabilities, skills: false } } as unknown as AgentAdapter;

    const { list, analyzeRepo } = await mocks();
    list.mockResolvedValue([
      conversation('a', 'mock', 1),
      conversation('b', 'other', 9),
      conversation('c', 'mock', 3),
    ] as never);

    const result = await sessionManager.analyzeSkillSuggestionsForRepo('/repo');

    expect(result).toEqual([{ id: 'analyzed' }]);
    const opts = analyzeRepo.mock.calls[0][0];
    expect(opts.sessionIds).toEqual(['a', 'c']);
    await opts.generateText!('system', 'user', { cwd: '/repo' });
    expect(generateText).toHaveBeenCalledWith('system', 'user', { cwd: '/repo', model: 'cheap-model' });
  });

  it('keeps the cached suggestions when no agent in the project has skills', async () => {
    const { list, analyzeRepo } = await mocks();
    list.mockResolvedValue([conversation('a', 'mock', 1)] as never);

    const result = await sessionManager.analyzeSkillSuggestionsForRepo('/repo');

    expect(result).toEqual([{ id: 'cached' }]);
    expect(analyzeRepo).not.toHaveBeenCalled();
  });
});

describe('MCP elicitation', () => {
  async function startSession(id: string) {
    await sessionManager.createSession({ id, branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock' });
    await vi.waitFor(() => expect(mockAdapter.lastConfig?.onElicitation).toBeDefined());
    return mockAdapter.lastConfig!.onElicitation!;
  }
  const request = { serverName: 'deploy', message: 'Which env?', mode: 'form' as const, requestedSchema: { type: 'object' } };

  it('asks the renderer and answers with the cleaned response', async () => {
    const onElicitation = await startSession('elicit-answer');
    const answer = onElicitation(request, new AbortController().signal);

    const asked = sessionManager.getEventHistory('elicit-answer').find((e) => e.type === 'elicitation_request');
    expect(asked).toMatchObject({ type: 'elicitation_request', request });
    const requestId = (asked as Extract<AgentEvent, { type: 'elicitation_request' }>).requestId;

    expect(sessionManager.respondToElicitation('elicit-answer', requestId, {
      action: 'accept',
      content: { env: 'prod', bad: { nested: true } as never },
    })).toBe(true);
    await expect(answer).resolves.toEqual({ action: 'accept', content: { env: 'prod' } });
    expect(sessionManager.getEventHistory('elicit-answer')).toContainEqual({ type: 'elicitation_resolved', requestId, action: 'accept' });
    // Already answered
    expect(sessionManager.respondToElicitation('elicit-answer', requestId, { action: 'decline' })).toBe(false);

    await sessionManager.destroySession('elicit-answer');
  });

  it('cancels when the agent stops waiting', async () => {
    const onElicitation = await startSession('elicit-abort');
    const abort = new AbortController();
    const answer = onElicitation(request, abort.signal);
    abort.abort();
    await expect(answer).resolves.toEqual({ action: 'cancel' });
    expect(sessionManager.getSession('elicit-abort')!.pendingElicitations.size).toBe(0);
    await sessionManager.destroySession('elicit-abort');
  });

  it('cancels pending requests when the conversation closes', async () => {
    const onElicitation = await startSession('elicit-destroy');
    const answer = onElicitation(request, new AbortController().signal);
    await sessionManager.destroySession('elicit-destroy');
    await expect(answer).resolves.toEqual({ action: 'cancel' });
  });

  it('rejects unknown actions', () => {
    expect(sanitizeElicitationResponse({ action: 'maybe' })).toBeNull();
    expect(sanitizeElicitationResponse(null)).toBeNull();
    expect(sanitizeElicitationResponse({ action: 'decline', content: { a: 'x' } })).toEqual({ action: 'decline' });
    expect(sanitizeElicitationResponse({ action: 'accept', content: { n: Infinity, l: ['a', 1], ok: ['a'] } })).toEqual({ action: 'accept', content: { ok: ['a'] } });
  });
});

describe('AgentSessionManager step timings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function create(id: string) {
    await sessionManager.createSession({
      id, branch: 'main', cwd: '/repo', repoPath: '/repo', window: makeMockWindow(), adapterType: 'mock',
    });
  }

  it('marks session, agent setup and agent start in order, ending when the agent is up', async () => {
    const step = vi.spyOn(perfSteps, 'step');
    const finish = vi.spyOn(perfSteps, 'finish');
    await create('t-steps');
    await vi.waitFor(() => expect(sessionManager.getSession('t-steps')?.queryHandle).toBeTruthy());

    expect(step.mock.calls.filter(([id]) => id === 't-steps').map(([, name]) => name)).toEqual(['session', 'agent setup']);
    // Not at the agent's first message, which only comes with a prompt.
    expect(finish).toHaveBeenCalledWith('t-steps', 'agent start');
    expect(finish.mock.invocationCallOrder[0]).toBeGreaterThan(step.mock.invocationCallOrder.at(-1)!);
    await sessionManager.destroySession('t-steps');
  });

  it('writes up a run when the conversation is closed or deleted', async () => {
    const fail = vi.spyOn(perfSteps, 'fail');
    await create('t-close');
    await sessionManager.closeSession('t-close');
    await create('t-delete');
    await sessionManager.destroySession('t-delete');

    expect(fail).toHaveBeenCalledWith('t-close', 'closed');
    expect(fail).toHaveBeenCalledWith('t-delete', 'deleted');
  });
});
