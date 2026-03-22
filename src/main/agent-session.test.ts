import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentAdapter, AgentQueryHandle, AdapterConfig, PermissionResponse } from './adapters/types.js';
import type { AgentEvent } from '../shared/types.js';

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
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  readFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock dependencies
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), close: vi.fn() },
}));
vi.mock('./worktree-manager.js', () => ({
  worktreeManager: { saveProviderSessionId: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('./port-killer.js', () => ({
  killProcessOnPort: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./dev-server.js', () => ({
  DevServer: vi.fn(),
}));
vi.mock('./dev-command-detector.js', () => ({
  detectDevCommand: vi.fn().mockResolvedValue(null),
}));
vi.mock('./settings.js', () => ({
  getSettings: vi.fn(() => ({
    defaultPermissionMode: 'default',
    defaultSystemPromptAppend: null,
    toolAllowRules: [],
    toolDenyRules: [],
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

// Mock the adapter registry with a controllable mock adapter
let mockAdapter: MockAdapter;

vi.mock('./adapters/index.js', () => ({
  adapterRegistry: {
    get: (id: string) => id === 'mock' ? mockAdapter : undefined,
    getDefault: () => mockAdapter,
    list: () => [mockAdapter],
    register: vi.fn(),
  },
}));

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
  readonly capabilities = {
    permissions: true,
    permissionModes: true,
    resume: true,
    modelSwitching: true,
    thinking: true,
    plugins: false,
    imageAttachments: false,
    structuredOutput: false,
    sandbox: false,
  };

  control: MockQueryControl | null = null;
  startCallCount = 0;
  lastConfig: AdapterConfig | null = null;

  getModels() { return [{ id: 'mock-model', label: 'Mock' }]; }
  async checkPrerequisites() { return { available: true }; }

  async start(config: AdapterConfig): Promise<AgentQueryHandle> {
    this.startCallCount++;
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

    return {
      events: eventGenerator(),
      sendMessage: vi.fn(),
      abort: vi.fn(() => {
        abortController.abort();
        done = true;
        resolveIter?.();
      }),
      close: vi.fn(() => {
        done = true;
        resolveIter?.();
      }),
      getSessionId: () => sessionId,
      closeInput: vi.fn(),
      setModel: vi.fn(),
      setPermissionMode: vi.fn(),
      setMaxThinkingTokens: vi.fn(),
    };
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

beforeEach(() => {
  mockAdapter = new MockAdapter();
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
    expect(mockAdapter.startCallCount).toBe(1);

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

    expect(mockAdapter.lastConfig?.permissionMode).toBe('plan');
    expect(mockAdapter.lastConfig?.appendSystemPrompt).toBeTruthy();

    await sessionManager.destroySession('test-config');
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

describe('AgentSessionManager.setMode()', () => {
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

  it('does not pass acceptEdits to SDK (only default/plan)', async () => {
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
    // queryHandle.setPermissionMode should NOT have been called for acceptEdits
    // (it's only called for 'default' and 'plan')
    const handle = session?.queryHandle;
    if (handle?.setPermissionMode) {
      expect(handle.setPermissionMode).not.toHaveBeenCalledWith('acceptEdits');
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

    await sessionManager.stopQuery('test-stop');
    await new Promise((r) => setTimeout(r, 50));

    expect(permResolved).toMatchObject({ behavior: 'deny' });

    // Should have emitted mode_sync after stop
    const history = sessionManager.getEventHistory('test-stop');
    const modeSyncEvents = history.filter((e) => e.type === 'mode_sync');
    expect(modeSyncEvents.length).toBeGreaterThanOrEqual(1);

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

    const sent = sessionManager.sendMessage('test-send', 'Hello agent');
    expect(sent).toBe(true);

    // Verify it was recorded in event history
    const history = sessionManager.getEventHistory('test-send');
    const userMsgs = history.filter((e) => e.type === 'user_message');
    expect(userMsgs).toContainEqual({ type: 'user_message', text: 'Hello agent' });

    await sessionManager.destroySession('test-send');
  });

  it('returns false for non-existent session', () => {
    expect(sessionManager.sendMessage('nonexistent', 'hello')).toBe(false);
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
