import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';

import { messageStore } from './messages.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';
import { checkpointStore } from './checkpoints.svelte.js';
import { backgroundTaskStore } from './backgroundTask.svelte.js';
import { rateLimitStore } from './rateLimit.svelte.js';
import { settingsStore } from './settings.svelte.js';
import type { AgentEvent } from '../../shared/types.js';

const SID = 'test-session';

beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.sessions = [];
  // Clear messages for our test session
  messageStore.messagesBySession = {};
  messageStore.streamingText = {};
  messageStore.streamingThinking = {};
  messageStore.isRunning = {};
  messageStore.isReady = {};
  messageStore.activityBySession = {};
  messageStore.toolProgressBySession = {};
  messageStore.modeBySession = {};
  messageStore.modelBySession = {};
  messageStore.usageBySession = {};
  messageStore.pendingClear = {};
  rateLimitStore.bySession = {};
  messageStore.promptSuggestionsBySession = {};
  backgroundTaskStore.tasksBySession = {};
  messageStore.contextWindowBySession = {};
  messageStore.turnsBySession = {};
  messageStore.controlsBySession = {};
  messageStore.rewindDialogOpen = {};
  messageStore.paginationBySession = {};
  messageStore.queuedBySession = {};
  messageStore.queuePausedBySession = {};
  messageStore.viewModeBySession = {};
  settingsStore.current = { ...settingsStore.current, defaultActivityView: 'summary' };
});

describe('view mode', () => {
  it('falls back to the global default when the session has not chosen one', () => {
    expect(messageStore.getViewMode(SID)).toBe('summary');
    settingsStore.current = { ...settingsStore.current, defaultActivityView: 'focus' };
    expect(messageStore.getViewMode(SID)).toBe('focus');
  });

  it('keeps a per-session choice over the global default', () => {
    settingsStore.current = { ...settingsStore.current, defaultActivityView: 'focus' };
    messageStore.setViewMode(SID, 'detailed');
    expect(messageStore.getViewMode(SID)).toBe('detailed');
    // A different session still follows the default.
    expect(messageStore.getViewMode('other')).toBe('focus');
  });

  it('tracks a later change to the default for sessions that never overrode it', () => {
    messageStore.setViewMode(SID, 'detailed');
    settingsStore.current = { ...settingsStore.current, defaultActivityView: 'focus' };
    expect(messageStore.getViewMode(SID)).toBe('detailed');
    expect(messageStore.getViewMode('fresh')).toBe('focus');
  });
});

describe('ingestEvent — system_init', () => {
  it('does not push control values back to main — main owns them and re-applies at query start', () => {
    messageStore.controlsBySession[SID] = {
      descriptors: [{ id: 'thinking', label: 'Thinking', default: 'high', options: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] }],
      values: { thinking: 'low' },
    };

    messageStore.ingestEvent(SID, {
      type: 'system_init',
      sessionId: SID,
      model: 'test-model-v1',
      tools: [],
    } as AgentEvent);

    expect(messageStore.getControlValue(SID, 'thinking')).toBe('low');
    expect(mockGroveBench.setControl).not.toHaveBeenCalled();
  });

  it('marks session as ready and not running', () => {
    messageStore.ingestEvent(SID, {
      type: 'system_init',
      sessionId: SID,
      model: 'test-model-v1',
      tools: ['Read', 'Edit'],
    } as AgentEvent);

    expect(messageStore.getIsReady(SID)).toBe(true);
    expect(messageStore.getIsRunning(SID)).toBe(false);
    expect(messageStore.getModel(SID)).toBe('test-model-v1');
  });

  it('keeps isRunning when a user message is already in flight (stop → resend → respawn)', () => {
    // User pressed Stop (process killed), then submitted a follow-up before the
    // respawned query connected. addUserMessage sets the optimistic working
    // state; the respawn's system_init must NOT clear it, or the indicator
    // flickers off until the first token streams.
    messageStore.addUserMessage(SID, 'follow-up after stop');
    expect(messageStore.getIsRunning(SID)).toBe(true);

    messageStore.ingestEvent(SID, {
      type: 'system_init',
      sessionId: SID,
      model: 'opus',
      tools: [],
    } as AgentEvent);

    expect(messageStore.getIsReady(SID)).toBe(true);
    expect(messageStore.getIsRunning(SID)).toBe(true);

    // Once the turn completes, the working state clears as normal.
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success' } as AgentEvent);
    expect(messageStore.getIsRunning(SID)).toBe(false);
  });

  it('pushes a system message with model name', () => {
    messageStore.ingestEvent(SID, {
      type: 'system_init',
      sessionId: SID,
      model: 'opus',
      tools: [],
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('system');
    expect((msgs[0] as any).text).toContain('opus');
  });

  it('clears messages on re-init after /clear', () => {
    messageStore.addUserMessage(SID, 'hello');
    messageStore.pendingClear[SID] = true;

    messageStore.ingestEvent(SID, {
      type: 'system_init',
      sessionId: SID,
      model: 'opus',
      tools: [],
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    // Only the re-init system message should remain
    expect(msgs).toHaveLength(1);
    expect((msgs[0] as any).text).toContain('cleared');
  });

  it('resets pagination state after /clear', () => {
    // Simulate having loaded a partial page (300 older events remain)
    messageStore.paginationBySession[SID] = { totalCount: 500, loadedFromIndex: 300, loading: false };
    messageStore.pendingClear[SID] = true;

    messageStore.ingestEvent(SID, {
      type: 'system_init',
      sessionId: SID,
      model: 'opus',
      tools: [],
    } as AgentEvent);

    // Pagination should be fully reset — no older events to load
    expect(messageStore.hasOlderEvents(SID)).toBe(false);
    expect(messageStore.olderEventCount(SID)).toBe(0);
  });

  it('drops the checkpoint selection after /clear but keeps the list (refs survive a clear)', () => {
    // Simulate checkpoints existing for this session
    checkpointStore.checkpointsBySession[SID] = [
      { uuid: 'uuid-1', turn: 1, ref: 'refs/grove/checkpoints/s/turn/1' },
    ];
    checkpointStore.selectedBySession[SID] = 'uuid-1';
    const refresh = vi.spyOn(checkpointStore, 'scheduleRefresh');

    messageStore.pendingClear[SID] = true;
    messageStore.ingestEvent(SID, {
      type: 'system_init',
      sessionId: SID,
      model: 'opus',
      tools: [],
    } as AgentEvent);

    expect(checkpointStore.getCheckpoints(SID)).toHaveLength(1);
    expect(checkpointStore.getSelected(SID)).toBeNull();
    // The list is re-read once main has recorded the clear marker
    return vi.waitFor(() => expect(refresh).toHaveBeenCalledWith(SID)).finally(() => refresh.mockRestore());
  });

  it('stores system info (tools, agents, skills)', () => {
    messageStore.ingestEvent(SID, {
      type: 'system_init',
      sessionId: SID,
      model: 'opus',
      tools: ['Read', 'Edit'],
      agents: ['agent1'],
      skills: ['commit'],
      slashCommands: ['/help'],
      mcpServers: [{ name: 'github', status: 'connected' }],
    } as AgentEvent);

    const info = messageStore.getSystemInfo(SID);
    expect(info.tools).toEqual(['Read', 'Edit']);
    expect(info.agents).toEqual(['agent1']);
    expect(info.skills).toEqual(['commit']);
  });
});

describe('ingestEvent — text streaming', () => {
  it('accumulates partial_text into streaming buffer', () => {
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'Hello ' } as AgentEvent);
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'world' } as AgentEvent);

    // Deltas are coalesced: nothing reactive changes until the flush tick.
    expect(messageStore.getStreamingText(SID)).toBe('');
    messageStore.flushStreamBuffers();
    expect(messageStore.getStreamingText(SID)).toBe('Hello world');
    expect(messageStore.getIsRunning(SID)).toBe(true);
  });

  it('applies buffered deltas before a non-streaming event is processed', () => {
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'buffered' } as AgentEvent);
    messageStore.ingestEvent(SID, { type: 'activity', activity: 'generating' } as AgentEvent);
    expect(messageStore.getStreamingText(SID)).toBe('buffered');
  });

  it('drops buffered text deltas superseded by the finalized assistant_text', () => {
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'preview' } as AgentEvent);
    messageStore.ingestEvent(SID, { type: 'assistant_text', text: 'Final', uuid: 'u1' } as AgentEvent);
    expect(messageStore.getStreamingText(SID)).toBe('');
    messageStore.flushStreamBuffers();
    expect(messageStore.getStreamingText(SID)).toBe('');
    expect(messageStore.getMessages(SID)).toHaveLength(1);
  });

  it('clears streaming thinking when partial_text arrives', () => {
    messageStore.streamingThinking[SID] = 'thinking...';
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'hi' } as AgentEvent);
    expect(messageStore.getStreamingThinking(SID)).toBe('');
  });

  it('assistant_text clears streaming and pushes finalized message', () => {
    messageStore.streamingText[SID] = 'preview text';
    messageStore.ingestEvent(SID, {
      type: 'assistant_text',
      text: 'Final answer',
      uuid: 'uuid-1',
    } as AgentEvent);

    expect(messageStore.getStreamingText(SID)).toBe('');
    const msgs = messageStore.getMessages(SID);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('text');
    expect((msgs[0] as any).text).toBe('Final answer');
  });
});

describe('ingestEvent — thinking', () => {
  it('accumulates partial_thinking', () => {
    messageStore.ingestEvent(SID, { type: 'partial_thinking', text: 'Let me ' } as AgentEvent);
    messageStore.ingestEvent(SID, { type: 'partial_thinking', text: 'think...' } as AgentEvent);

    messageStore.flushStreamBuffers();
    expect(messageStore.getStreamingThinking(SID)).toBe('Let me think...');
    expect(messageStore.getActivity(SID).activity).toBe('thinking');
  });

  it('finalized thinking clears streaming and pushes message', () => {
    messageStore.streamingThinking[SID] = 'preview';
    messageStore.ingestEvent(SID, {
      type: 'thinking',
      thinking: 'Full thought',
      uuid: 'uuid-t',
    } as AgentEvent);

    expect(messageStore.getStreamingThinking(SID)).toBe('');
    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('thinking');
  });
});

describe('ingestEvent — tool_use and tool_result', () => {
  it('pushes a pending tool_call message', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'Read',
      toolInput: { file_path: '/src/foo.ts' },
      toolUseId: 'tu-1',
      uuid: 'uuid-2',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('tool_call');
    const tc = msgs[0] as any;
    expect(tc.toolName).toBe('Read');
    expect(tc.pending).toBe(true);
  });

  it('flushes streaming text before tool_use', () => {
    messageStore.streamingText[SID] = 'partial answer';
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'Read',
      toolInput: {},
      toolUseId: 'tu-2',
      uuid: 'uuid-3',
    } as AgentEvent);

    // Streaming text flushed as a text message, then tool call added
    const msgs = messageStore.getMessages(SID);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].kind).toBe('text');
    expect(msgs[1].kind).toBe('tool_call');
  });

  it('tool_result resolves the matching pending tool_call', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'tu-3',
      uuid: 'uuid-4',
    } as AgentEvent);

    messageStore.ingestEvent(SID, {
      type: 'tool_result',
      toolUseId: 'tu-3',
      content: 'file1.ts\nfile2.ts',
      isError: false,
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    const tc = msgs[0] as any;
    expect(tc.pending).toBe(false);
    expect(tc.result).toBe('file1.ts\nfile2.ts');
    expect(tc.isError).toBe(false);
  });

  it('mode-changing tool_use does NOT sync mode (mode_sync events handle it)', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'some_plan_tool',
      toolInput: {},
      toolUseId: 'tu-plan',
      uuid: 'u-plan',
    } as AgentEvent);

    // Mode stays 'default' — only mode_sync events change it
    expect(messageStore.getMode(SID)).toBe('default');
  });

  it('any tool_use does NOT sync mode (mode_sync events handle it)', () => {
    messageStore.modeBySession[SID] = 'plan';
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'some_exit_tool',
      toolInput: {},
      toolUseId: 'tu-exit',
      uuid: 'u-exit',
    } as AgentEvent);

    // Mode stays 'plan' — only mode_sync events change it
    expect(messageStore.getMode(SID)).toBe('plan');
  });
});

describe('ingestEvent — permission_request', () => {
  it('pushes permission message for normal tools', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /' },
      toolUseId: 'tu-perm',
      requestId: 'req-1',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('permission');
    const pm = msgs[0] as any;
    expect(pm.toolName).toBe('Bash');
    expect(pm.resolved).toBe(false);
  });

  it('pushes question message for question-category tools', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [{ question: 'Which framework?', header: 'Choice', options: [], multiSelect: false }],
      },
      toolUseId: 'tu-q',
      requestId: 'req-q',
      toolCategory: 'question',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('question');
    const q = msgs[0] as any;
    expect(q.questions).toHaveLength(1);
    expect(q.resolved).toBe(false);
  });
});

describe('OS notification triggers', () => {
  // notifyOs only fires for sessions that are still open — register SID as one.
  beforeEach(() => {
    sessionStore.sessions = [{ id: SID, branch: 'feat/x', repoPath: 'C:/repo', status: 'running' }];
  });

  it('notifies turn completion from the result event', () => {
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', isError: false } as AgentEvent);
    expect(mockGroveBench.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn_complete', sessionId: SID, body: 'Agent finished a turn' }),
    );
  });

  it('uses error wording when the turn ended with an error', () => {
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'error_during_execution', isError: true } as AgentEvent);
    expect(mockGroveBench.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn_complete', body: 'Agent turn ended with an error' }),
    );
  });

  it('notifies permission requests with the tool name', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request', toolName: 'Bash', toolInput: {}, toolUseId: 't1', requestId: 'r1',
    } as AgentEvent);
    expect(mockGroveBench.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'permission_request', body: 'Bash is waiting for permission' }),
    );
  });

  it('uses plain language for plan approvals and questions', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request', toolName: 'ExitPlanMode', toolInput: {}, toolUseId: 't2', requestId: 'r2', isPlanExecution: true,
    } as AgentEvent);
    expect(mockGroveBench.notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'A plan is ready for review' }),
    );

    messageStore.ingestEvent(SID, {
      type: 'permission_request', toolName: 'AskUserQuestion', toolInput: { questions: [] }, toolUseId: 't3', requestId: 'r3', toolCategory: 'question',
    } as AgentEvent);
    expect(mockGroveBench.notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Agent is waiting for an answer' }),
    );
  });

  it('never notifies from replayed history', () => {
    messageStore.replayEvents(SID, [
      { type: 'permission_request', toolName: 'Bash', toolInput: {}, toolUseId: 't4', requestId: 'r4' } as AgentEvent,
      { type: 'result', subtype: 'success', isError: false } as AgentEvent,
    ]);
    expect(mockGroveBench.notify).not.toHaveBeenCalled();
  });

  it('never notifies for a stopped session', () => {
    sessionStore.sessions = [{ id: SID, branch: 'feat/x', repoPath: 'C:/repo', status: 'stopped' }];
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', isError: false } as AgentEvent);
    expect(mockGroveBench.notify).not.toHaveBeenCalled();
  });

  it('never notifies for a session no longer in the store', () => {
    sessionStore.sessions = [];
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', isError: false } as AgentEvent);
    expect(mockGroveBench.notify).not.toHaveBeenCalled();
  });
});

describe('ingestEvent — result', () => {
  it('marks session as not running and idle', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.ingestEvent(SID, {
      type: 'result',
      subtype: 'success',
      isError: false,
      totalCostUsd: 0.05,
      durationMs: 3000,
    } as AgentEvent);

    expect(messageStore.getIsRunning(SID)).toBe(false);
    expect(messageStore.getActivity(SID).activity).toBe('idle');
  });

  it('flushes streaming text before result', () => {
    messageStore.streamingText[SID] = 'leftover';
    messageStore.ingestEvent(SID, {
      type: 'result',
      subtype: 'success',
      isError: false,
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('text');
    expect(msgs[1].kind).toBe('result');
  });

  it('stores context window and turns', () => {
    messageStore.ingestEvent(SID, {
      type: 'result',
      subtype: 'success',
      isError: false,
      contextWindow: 100000,
      numTurns: 5,
    } as AgentEvent);

    expect(messageStore.getContextWindow(SID)).toBe(100000);
    expect(messageStore.getTurns(SID)).toBe(5);
  });
});

describe('ingestEvent — usage', () => {
  it('tracks input tokens as latest (not cumulative)', () => {
    messageStore.ingestEvent(SID, {
      type: 'usage',
      inputTokens: 1000,
      outputTokens: 200,
    } as AgentEvent);
    messageStore.ingestEvent(SID, {
      type: 'usage',
      inputTokens: 1500,
      outputTokens: 300,
    } as AgentEvent);

    const usage = messageStore.getUsage(SID);
    expect(usage.inputTokens).toBe(1500); // latest, not summed
    expect(usage.outputTokens).toBe(500); // cumulative
  });
});

describe('ingestEvent — error and status', () => {
  it('pushes error message', () => {
    messageStore.ingestEvent(SID, { type: 'error', message: 'Something broke' } as AgentEvent);
    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('error');
    expect((msgs[0] as any).text).toBe('Something broke');
  });

  it('pushes status as system message', () => {
    messageStore.ingestEvent(SID, { type: 'status', message: 'Loading...' } as AgentEvent);
    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('system');
    expect((msgs[0] as any).text).toBe('Loading...');
  });
});

describe('ingestEvent — rate_limit (delegates to rateLimitStore)', () => {
  it('stores rate limit state', () => {
    messageStore.ingestEvent(SID, {
      type: 'rate_limit',
      status: 'allowed_warning',
      utilization: 0.85,
    } as AgentEvent);

    const rl = rateLimitStore.get(SID);
    expect(rl!.status).toBe('allowed_warning');
    expect(rl!.utilization).toBe(0.85);
  });

  it('pushes system message on rejection', () => {
    messageStore.ingestEvent(SID, {
      type: 'rate_limit',
      status: 'rejected',
      rateLimitType: 'token',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('system');
    expect((msgs[0] as any).text).toContain('Rate limited');
    expect((msgs[0] as any).text).toContain('token');
  });
});

describe('ingestEvent — compact_boundary', () => {
  it('pushes compaction system message', () => {
    messageStore.ingestEvent(SID, {
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 150000,
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('system');
    expect((msgs[0] as any).text).toContain('150k');
  });
});

describe('ingestEvent — tool_progress', () => {
  it('updates activity with tool progress', () => {
    messageStore.ingestEvent(SID, {
      type: 'tool_progress',
      toolName: 'Bash',
      toolUseId: 'tu-p',
      elapsedSeconds: 5,
    } as AgentEvent);

    const activity = messageStore.getActivity(SID);
    expect(activity.activity).toBe('tool_starting');
    expect(activity.toolName).toBe('Bash');
    expect(activity.elapsedSeconds).toBe(5);
  });
});

describe('ingestEvent — activity', () => {
  it('sets running when not idle', () => {
    messageStore.ingestEvent(SID, { type: 'activity', activity: 'generating' } as AgentEvent);
    expect(messageStore.getIsRunning(SID)).toBe(true);
    expect(messageStore.getActivity(SID).activity).toBe('generating');
  });

  it('does not set running for idle', () => {
    messageStore.setIsRunning(SID, false);
    messageStore.ingestEvent(SID, { type: 'activity', activity: 'idle' } as AgentEvent);
    expect(messageStore.getIsRunning(SID)).toBe(false);
  });
});

describe('ingestEvent — process_exit', () => {
  it('marks session as stopped', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.streamingText[SID] = 'leftover';
    messageStore.ingestEvent(SID, { type: 'process_exit' } as AgentEvent);

    expect(messageStore.getIsRunning(SID)).toBe(false);
    expect(messageStore.getActivity(SID).activity).toBe('idle');
  });
});

describe('ingestEvent — background tasks', () => {
  it('tracks task lifecycle (started → progress → notification)', () => {
    messageStore.ingestEvent(SID, {
      type: 'task_started',
      taskId: 'bg-1',
      description: 'Research API',
      taskType: 'explore',
    } as AgentEvent);

    let tasks = backgroundTaskStore.get(SID);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('running');

    messageStore.ingestEvent(SID, {
      type: 'task_progress',
      taskId: 'bg-1',
      description: 'Research API',
      summary: 'Reading docs',
      totalTokens: 5000,
      toolUses: 3,
      durationMs: 10000,
    } as AgentEvent);

    tasks = backgroundTaskStore.get(SID);
    expect(tasks[0].summary).toBe('Reading docs');
    expect(tasks[0].totalTokens).toBe(5000);

    messageStore.ingestEvent(SID, {
      type: 'task_notification',
      taskId: 'bg-1',
      taskStatus: 'completed',
      summary: 'Found 3 endpoints',
      totalTokens: 8000,
      toolUses: 7,
      durationMs: 25000,
    } as AgentEvent);

    tasks = backgroundTaskStore.get(SID);
    expect(tasks[0].status).toBe('completed');
    expect(tasks[0].summary).toBe('Found 3 endpoints');
  });

  it('keeps running tasks across a turn result (they outlive the turn and survive an interrupt)', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.ingestEvent(SID, { type: 'task_started', taskId: 'bg-1', description: 'Long job' } as AgentEvent);
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', result: '', totalCostUsd: 0, durationMs: 1 } as AgentEvent);

    expect(messageStore.getIsRunning(SID)).toBe(false);
    const tasks = backgroundTaskStore.get(SID);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('running');
  });

  it('drops running tasks once the agent process exits', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.ingestEvent(SID, { type: 'task_started', taskId: 'bg-1', description: 'Long job' } as AgentEvent);
    messageStore.ingestEvent(SID, { type: 'process_exit' } as AgentEvent);

    expect(backgroundTaskStore.get(SID)).toHaveLength(0);
  });

  it('applies background_tasks_changed as the authoritative task list', () => {
    messageStore.ingestEvent(SID, { type: 'task_started', taskId: 'bg-1', description: 'One' } as AgentEvent);
    messageStore.ingestEvent(SID, { type: 'task_started', taskId: 'bg-2', description: 'Two' } as AgentEvent);
    messageStore.ingestEvent(SID, {
      type: 'background_tasks_changed',
      tasks: [{ taskId: 'bg-2', description: 'Two' }],
    } as AgentEvent);

    expect(backgroundTaskStore.get(SID).map((t) => t.taskId)).toEqual(['bg-2']);
  });
});

describe('ingestEvent — prompt_suggestion', () => {
  it('accumulates suggestions', () => {
    messageStore.ingestEvent(SID, { type: 'prompt_suggestion', suggestion: 'Try this' } as AgentEvent);
    messageStore.ingestEvent(SID, { type: 'prompt_suggestion', suggestion: 'Or this' } as AgentEvent);

    expect(messageStore.getPromptSuggestions(SID)).toEqual(['Try this', 'Or this']);
  });
});

describe('ingestEvent — mode_sync', () => {
  it('syncs mode from SDK when user has not explicitly set mode', () => {
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'plan', source: 'sdk' } as AgentEvent);
    expect(messageStore.getMode(SID)).toBe('plan');
  });

  it('session-sourced mode_sync always applies', () => {
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'plan', source: 'session' } as AgentEvent);
    expect(messageStore.getMode(SID)).toBe('plan');
  });

  it('clears stoppingSession so new query permission requests are not dropped', () => {
    // Simulate: user clicks Stop → markSessionStopped sets stoppingSession
    messageStore.markSessionStopped(SID);

    // Before the fix, permission_request events arriving between stopQuery's
    // mode_sync and system_init would be silently dropped.
    // mode_sync (emitted by stopQuery after resolving old permissions) should
    // clear stoppingSession so the new query's permissions get through.
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'default', source: 'session' } as AgentEvent);

    // Now a permission_request from the new query should NOT be suppressed
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      toolUseId: 'tu-post-stop',
      requestId: 'perm-post-stop',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    const perm = msgs.find((m) => m.kind === 'permission');
    expect(perm).toBeDefined();
    expect((perm as any).requestId).toBe('perm-post-stop');
  });
});

describe('ingestEvent — mode_sync respects user-explicit mode', () => {
  it('does not let SDK mode_sync overwrite user-set mode', () => {
    // Simulate user explicitly setting acceptEdits (e.g. via Always Allow)
    messageStore.modeBySession[SID] = 'acceptEdits';
    // setMode sets userExplicitMode — simulate by calling setMode directly
    // (IPC will fail in test env but the flag is set before the await)
    messageStore.setMode(SID, 'acceptEdits');
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'default', source: 'sdk' } as AgentEvent);
    // User-set mode should be preserved
    expect(messageStore.getMode(SID)).toBe('acceptEdits');
  });

  it('does not let SDK mode_sync overwrite user-set plan', () => {
    messageStore.setMode(SID, 'plan');
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'default', source: 'sdk' } as AgentEvent);
    expect(messageStore.getMode(SID)).toBe('plan');
  });

  it('session-sourced mode_sync overrides user-explicit mode', () => {
    messageStore.setMode(SID, 'acceptEdits');
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'default', source: 'session' } as AgentEvent);
    expect(messageStore.getMode(SID)).toBe('default');
  });

  it('allows SDK mode_sync when user has not explicitly changed mode', () => {
    messageStore.modeBySession[SID] = 'default';
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'plan', source: 'sdk' } as AgentEvent);
    expect(messageStore.getMode(SID)).toBe('plan');
  });
});

describe('ingestEvent — stoppingSession suppresses late permission_request', () => {
  it('drops permission_request events after markSessionStopped', () => {
    messageStore.markSessionStopped(SID);

    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      toolUseId: 'tu-late',
      requestId: 'perm-late',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    const perms = msgs.filter((m) => m.kind === 'permission');
    expect(perms).toHaveLength(0);
  });

  it('clears stoppingSession so new query permission requests are not dropped', () => {
    // Simulate: user clicks Stop → markSessionStopped sets stoppingSession
    messageStore.markSessionStopped(SID);

    // mode_sync (emitted by stopQuery after resolving old permissions) should
    // clear stoppingSession so the new query's permissions get through.
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'default', source: 'session' } as AgentEvent);

    // Now a permission_request from the new query should NOT be suppressed
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      toolUseId: 'tu-post-stop',
      requestId: 'perm-post-stop',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    const perm = msgs.find((m) => m.kind === 'permission');
    expect(perm).toBeDefined();
    expect((perm as any).requestId).toBe('perm-post-stop');
  });
});

describe('ingestEvent — permission_resolved', () => {
  it('marks matching permission as resolved', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'tu-pr',
      requestId: 'req-pr',
    } as AgentEvent);

    messageStore.ingestEvent(SID, {
      type: 'permission_resolved',
      requestId: 'req-pr',
      toolUseId: 'tu-pr',
      decision: 'allow',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    const perm = msgs.find((m) => m.kind === 'permission') as any;
    expect(perm.resolved).toBe(true);
    expect(perm.decision).toBe('allow');
  });

  it('stores the answer from a replayed question resolution', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'AskUserQuestion',
      toolInput: { questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] },
      toolUseId: 'tu-q',
      requestId: 'req-q',
      toolCategory: 'question',
    } as AgentEvent);

    messageStore.ingestEvent(SID, {
      type: 'permission_resolved',
      requestId: 'req-q',
      toolUseId: 'tu-q',
      decision: 'deny',
      message: 'B',
    } as AgentEvent);

    const q = messageStore.getMessages(SID).find((m) => m.kind === 'question') as any;
    expect(q.resolved).toBe(true);
    expect(q.response).toBe('B');
  });

  it('clears awaitingPermission on matching tool_call', () => {
    // Add a tool_call that's awaiting permission
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'tu-await',
      uuid: 'u-await',
    } as AgentEvent);

    // Set awaitingPermission via permission_request
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'tu-await',
      requestId: 'req-await',
    } as AgentEvent);

    // Resolve it
    messageStore.ingestEvent(SID, {
      type: 'permission_resolved',
      requestId: 'req-await',
      toolUseId: 'tu-await',
      decision: 'allow',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    const tc = msgs.find((m) => m.kind === 'tool_call') as any;
    expect(tc.awaitingPermission).toBe(false);
  });
});

describe('ingestEvent — tool_use does NOT sync mode (mode_sync events do)', () => {
  it('plan-related tool does not change mode — mode_sync handles it', () => {
    messageStore.modeBySession[SID] = 'default';
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'some_plan_tool',
      toolInput: {},
      toolUseId: 'tu-enter',
      uuid: 'u-enter',
    } as AgentEvent);

    // Mode should stay 'default' — only mode_sync events change mode
    expect(messageStore.getMode(SID)).toBe('default');
  });

  it('any tool does not change mode — mode_sync handles it', () => {
    messageStore.modeBySession[SID] = 'plan';
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'some_exit_tool',
      toolInput: {},
      toolUseId: 'tu-exit2',
      uuid: 'u-exit2',
    } as AgentEvent);

    // Mode should stay 'plan' — only mode_sync events change mode
    expect(messageStore.getMode(SID)).toBe('plan');
  });
});

describe('ingestEvent — isPlanExecution on permission_request', () => {
  it('permission_request with isPlanExecution is stored on the message', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'plan_execution_tool',
      toolInput: {},
      toolUseId: 'tu-plan-exec',
      requestId: 'req-plan-exec',
      isPlanExecution: true,
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    const perm = msgs.find((m) => m.kind === 'permission') as any;
    expect(perm).toBeDefined();
    expect(perm.isPlanExecution).toBe(true);
  });

  it('permission_request without isPlanExecution defaults to false', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'tu-no-plan',
      requestId: 'req-no-plan',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    const perm = msgs.find((m) => m.kind === 'permission') as any;
    expect(perm).toBeDefined();
    expect(perm.isPlanExecution).toBeFalsy();
  });
});

describe('ingestEvent — error/process_exit unlocks input when never initialized', () => {
  it('error unlocks input if session never had system_init', () => {
    expect(messageStore.getIsReady(SID)).toBe(false);
    messageStore.ingestEvent(SID, { type: 'error', message: 'Auth failed' } as AgentEvent);
    expect(messageStore.getIsReady(SID)).toBe(true);
    expect(messageStore.getIsRunning(SID)).toBe(false);
  });

  it('process_exit unlocks input if session never had system_init', () => {
    expect(messageStore.getIsReady(SID)).toBe(false);
    messageStore.ingestEvent(SID, { type: 'process_exit' } as AgentEvent);
    expect(messageStore.getIsReady(SID)).toBe(true);
  });
});

describe('summarizeToolInput (via activity)', () => {
  it('summarizes Bash command', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'Bash',
      toolInput: { command: 'npm run build' },
      toolUseId: 'tu-s1',
      uuid: 'u-s1',
    } as AgentEvent);

    const activity = messageStore.getActivity(SID);
    expect(activity.toolSummary).toBe('npm run build');
  });

  it('summarizes file_path input', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'Read',
      toolInput: { file_path: '/src/index.ts' },
      toolUseId: 'tu-s2',
      uuid: 'u-s2',
    } as AgentEvent);

    const activity = messageStore.getActivity(SID);
    expect(activity.toolSummary).toBe('/src/index.ts');
  });

  it('summarizes pattern input', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'Grep',
      toolInput: { pattern: 'TODO' },
      toolUseId: 'tu-s3',
      uuid: 'u-s3',
    } as AgentEvent);

    const activity = messageStore.getActivity(SID);
    expect(activity.toolSummary).toBe('TODO');
  });

  it('returns empty for null input', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'Unknown',
      toolInput: null,
      toolUseId: 'tu-s4',
      uuid: 'u-s4',
    } as AgentEvent);

    const activity = messageStore.getActivity(SID);
    expect(activity.toolSummary).toBe('');
  });
});

describe('addUserMessage', () => {
  it('pushes user message and sets running', () => {
    messageStore.addUserMessage(SID, 'Fix the bug');

    const msgs = messageStore.getMessages(SID);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('user');
    expect((msgs[0] as any).text).toBe('Fix the bug');
    expect(messageStore.getIsRunning(SID)).toBe(true);
  });

  it('clears prompt suggestions on new message', () => {
    messageStore.promptSuggestionsBySession[SID] = ['old suggestion'];
    messageStore.addUserMessage(SID, 'New prompt');
    expect(messageStore.getPromptSuggestions(SID)).toEqual([]);
  });
});

describe('markSessionStopped', () => {
  it('resets running state and flushes streaming', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.streamingText[SID] = 'partial';
    messageStore.markSessionStopped(SID);

    expect(messageStore.getIsRunning(SID)).toBe(false);
    expect(messageStore.getActivity(SID).activity).toBe('idle');
    // Partial text should be flushed as a message
    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('text');
  });

  it('resolves pending tool calls so spinners stop', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'Bash',
      toolInput: {},
      toolUseId: 'tu-stop',
      uuid: 'u-stop',
    } as AgentEvent);

    messageStore.markSessionStopped(SID);

    const tc = messageStore.getMessages(SID)[0] as any;
    expect(tc.pending).toBe(false);
  });
});

describe('cycleMode', () => {
  it('cycles default → plan → acceptEdits → auto → readSafe → default', () => {
    messageStore.modeBySession[SID] = 'default';
    messageStore.cycleMode(SID);
    expect(messageStore.getMode(SID)).toBe('plan');

    messageStore.cycleMode(SID);
    expect(messageStore.getMode(SID)).toBe('acceptEdits');

    messageStore.cycleMode(SID);
    expect(messageStore.getMode(SID)).toBe('auto');

    messageStore.cycleMode(SID);
    expect(messageStore.getMode(SID)).toBe('readSafe');

    messageStore.cycleMode(SID);
    expect(messageStore.getMode(SID)).toBe('default');
  });

});

describe('sendCommand', () => {
  it('sends /clear and sets pendingClear', () => {
    messageStore.sendCommand(SID, '/clear');
    expect(messageStore.pendingClear[SID]).toBe(true);
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, '/clear');
  });

  it('syncs mode on /plan command', () => {
    messageStore.sendCommand(SID, '/plan');
    expect(messageStore.getMode(SID)).toBe('plan');
  });

  it('syncs mode on /code command', () => {
    messageStore.modeBySession[SID] = 'plan';
    messageStore.sendCommand(SID, '/code');
    expect(messageStore.getMode(SID)).toBe('default');
  });
});

describe('getLastTurnFileChanges', () => {
  it('returns empty when no messages', () => {
    expect(messageStore.getLastTurnFileChanges(SID)).toEqual([]);
  });

  it('returns empty when no result message', () => {
    messageStore.addUserMessage(SID, 'edit the file');
    expect(messageStore.getLastTurnFileChanges(SID)).toEqual([]);
  });

  it('returns Edit/Write calls from last turn grouped by file', () => {
    // Simulate a turn: user → tool_call(Edit) → tool_result → tool_call(Edit) → tool_result → result
    messageStore.messagesBySession[SID] = [
      { kind: 'user', id: '1', text: 'fix bug' },
      { kind: 'tool_call', id: '2', toolName: 'Edit', toolInput: { file_path: '/src/a.ts', old_string: 'x', new_string: 'y' }, toolUseId: 'e1', uuid: 'u1', pending: false },
      { kind: 'tool_call', id: '3', toolName: 'Edit', toolInput: { file_path: '/src/a.ts', old_string: 'p', new_string: 'q' }, toolUseId: 'e2', uuid: 'u2', pending: false },
      { kind: 'tool_call', id: '4', toolName: 'Write', toolInput: { file_path: '/src/b.ts', content: 'new file' }, toolUseId: 'e3', uuid: 'u3', pending: false },
      { kind: 'tool_call', id: '5', toolName: 'Read', toolInput: { file_path: '/src/c.ts' }, toolUseId: 'r1', uuid: 'u4', pending: false },
      { kind: 'result', id: '6', subtype: 'success', isError: false },
    ] as any;

    const changes = messageStore.getLastTurnFileChanges(SID);
    expect(changes).toHaveLength(2); // /src/a.ts and /src/b.ts (Read excluded)
    expect(changes.find(c => c.filePath === '/src/a.ts')!.edits).toHaveLength(2);
    expect(changes.find(c => c.filePath === '/src/b.ts')!.edits).toHaveLength(1);
  });

  it('excludes errored tool calls', () => {
    messageStore.messagesBySession[SID] = [
      { kind: 'user', id: '1', text: 'edit' },
      { kind: 'tool_call', id: '2', toolName: 'Edit', toolInput: { file_path: '/src/a.ts' }, toolUseId: 'e1', uuid: 'u1', pending: false, isError: true },
      { kind: 'result', id: '3', subtype: 'success', isError: false },
    ] as any;

    expect(messageStore.getLastTurnFileChanges(SID)).toEqual([]);
  });
});

describe('resolveStaleToolCalls', () => {
  it('marks pending tool calls as resolved when session not running', () => {
    messageStore.messagesBySession[SID] = [
      { kind: 'tool_call', id: '1', toolName: 'Bash', toolInput: {}, toolUseId: 'tu-stale', uuid: 'u', pending: true },
    ] as any;
    messageStore.setIsRunning(SID, false);

    messageStore.resolveStaleToolCalls(SID);

    const tc = messageStore.getMessages(SID)[0] as any;
    expect(tc.pending).toBe(false);
  });

  it('does not touch pending calls when session is running', () => {
    messageStore.messagesBySession[SID] = [
      { kind: 'tool_call', id: '1', toolName: 'Bash', toolInput: {}, toolUseId: 'tu-active', uuid: 'u', pending: true },
    ] as any;
    messageStore.setIsRunning(SID, true);

    messageStore.resolveStaleToolCalls(SID);

    const tc = messageStore.getMessages(SID)[0] as any;
    expect(tc.pending).toBe(true);
  });
});

describe('background task cleanup (delegates to backgroundTaskStore)', () => {
  // resolveStale's own logic is covered in backgroundTask.svelte.test.ts; this
  // guards that only a process exit (not a turn result) cleans up orphaned
  // running tasks, since background tasks outlive the turn and an interrupt.
  it('result event leaves running bg tasks alone', () => {
    backgroundTaskStore.tasksBySession[SID] = {
      't1': { taskId: 't1', description: 'still alive', status: 'running', totalTokens: 0, toolUses: 0, durationMs: 0 },
    };
    messageStore.setIsRunning(SID, true);

    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', result: '', totalCostUsd: 0, durationMs: 100 } as any);

    expect(backgroundTaskStore.get(SID)).toHaveLength(1);
  });

  it('process_exit cleans up orphaned running bg tasks', () => {
    backgroundTaskStore.tasksBySession[SID] = {
      't1': { taskId: 't1', description: 'orphan', status: 'running', totalTokens: 0, toolUses: 0, durationMs: 0 },
    };
    messageStore.setIsRunning(SID, true);

    messageStore.ingestEvent(SID, { type: 'process_exit' } as any);

    expect(backgroundTaskStore.get(SID)).toHaveLength(0);
  });
});

describe('getters with defaults', () => {
  it('getMessages returns empty array for unknown session', () => {
    expect(messageStore.getMessages('unknown')).toEqual([]);
  });

  it('getMode returns default for unknown session', () => {
    expect(messageStore.getMode('unknown')).toBe('default');
  });

  it('getContextWindow returns 200k default', () => {
    expect(messageStore.getContextWindow('unknown')).toBe(200000);
  });

  it('getControlDescriptors returns an empty list for an unknown session', () => {
    expect(messageStore.getControlDescriptors('unknown')).toEqual([]);
  });

  it('getUsage returns zeros for unknown session', () => {
    const u = messageStore.getUsage('unknown');
    expect(u.inputTokens).toBe(0);
    expect(u.outputTokens).toBe(0);
  });
});

describe('session controls', () => {
  const descriptors = [
    { id: 'permissionMode', label: 'Mode', default: 'default', options: [{ value: 'default', label: 'Code' }, { value: 'plan', label: 'Plan' }] },
    { id: 'thinking', label: 'Thinking', default: 'high', options: [{ value: 'off', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] },
  ];

  it('controls_sync installs the descriptors and values for the session', () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: { thinking: 'low' } } as AgentEvent);

    expect(messageStore.getControlDescriptors(SID).map((d) => d.id)).toEqual(['permissionMode', 'thinking']);
    expect(messageStore.getControlValue(SID, 'thinking')).toBe('low');
  });

  it('getControlValue falls back to the descriptor default, and reads permissionMode from the mode store', () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: {} } as AgentEvent);
    messageStore.modeBySession[SID] = 'plan';

    expect(messageStore.getControlValue(SID, 'thinking')).toBe('high');
    expect(messageStore.getControlValue(SID, 'permissionMode')).toBe('plan');
    expect(messageStore.getControlValue('unknown', 'thinking')).toBe('');
  });

  it('setControl reflects the value immediately and forwards it over IPC', async () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: { thinking: 'high' } } as AgentEvent);

    const pending = messageStore.setControl(SID, 'thinking', 'low');
    expect(messageStore.getControlValue(SID, 'thinking')).toBe('low');
    await pending;

    expect(mockGroveBench.setControl).toHaveBeenCalledWith(SID, 'thinking', 'low');
  });

  it('setControl rolls back when main rejects the value', async () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: { thinking: 'high' } } as AgentEvent);
    mockGroveBench.setControl.mockRejectedValueOnce(new Error('not offered on this model'));

    await messageStore.setControl(SID, 'thinking', 'low');

    expect(messageStore.getControlValue(SID, 'thinking')).toBe('high');
  });

  it('setControl on permissionMode routes through setMode', async () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: {} } as AgentEvent);

    await messageStore.setControl(SID, 'permissionMode', 'plan');

    expect(messageStore.getMode(SID)).toBe('plan');
    expect(mockGroveBench.setMode).toHaveBeenCalledWith(SID, 'plan');
    expect(mockGroveBench.setControl).not.toHaveBeenCalled();
  });

  it('cycleControl walks the declared options in order and wraps', () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: { thinking: 'off' } } as AgentEvent);

    for (const expected of ['low', 'high', 'off']) {
      messageStore.cycleControl(SID, 'thinking');
      expect(messageStore.getControlValue(SID, 'thinking')).toBe(expected);
    }
  });

  it('cycleMode uses the declared mode options instead of the built-in list', () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: {} } as AgentEvent);
    messageStore.modeBySession[SID] = 'plan';

    messageStore.cycleMode(SID);

    // Declared list is [default, plan] — so plan wraps to default, not acceptEdits
    expect(messageStore.getMode(SID)).toBe('default');
  });

  it('cycleControl on permissionMode still works before any descriptors arrive', () => {
    messageStore.modeBySession[SID] = 'default';

    messageStore.cycleControl(SID, 'permissionMode');

    expect(messageStore.getMode(SID)).toBe('plan');
  });

  it('loadControls fetches once and keeps a controls_sync that landed mid-fetch', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    mockGroveBench.getControls.mockImplementationOnce(() => new Promise((r) => { resolveFetch = r; }));

    const loading = messageStore.loadControls(SID);
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: { thinking: 'low' } } as AgentEvent);
    resolveFetch({ descriptors, values: { thinking: 'high' } });
    await loading;

    expect(messageStore.getControlValue(SID, 'thinking')).toBe('low');

    await messageStore.loadControls(SID);
    expect(mockGroveBench.getControls).toHaveBeenCalledTimes(1);
  });
});

describe('updateMcpServers', () => {
  it('replaces the MCP snapshot while preserving other system info', () => {
    messageStore.ingestEvent(SID, {
      type: 'system_init',
      sessionId: SID,
      model: 'test-model-v1',
      tools: ['Read'],
      mcpServers: [{ name: 'docs', status: 'connected' }],
    } as AgentEvent);

    messageStore.updateMcpServers(SID, [
      { name: 'docs', status: 'failed', error: 'boom' },
      { name: 'search', status: 'connected', toolCount: 3 },
    ]);

    const info = messageStore.getSystemInfo(SID);
    expect(info.tools).toEqual(['Read']);
    expect(info.mcpServers).toEqual([
      { name: 'docs', status: 'failed' },
      { name: 'search', status: 'connected' },
    ]);
  });

  it('is a no-op before system_init', () => {
    messageStore.updateMcpServers('uninitialized', [{ name: 'docs', status: 'connected' }]);
    expect(messageStore.getSystemInfo('uninitialized').mcpServers).toEqual([]);
  });
});

describe('ingestEvent — user_message UUID stamping', () => {
  it('stamps UUID onto the most recent UUID-less user message', () => {
    messageStore.addUserMessage(SID, 'first prompt');
    messageStore.addUserMessage(SID, 'second prompt');

    // SDK replays second user message with a UUID
    messageStore.ingestEvent(SID, {
      type: 'user_message',
      text: 'second prompt',
      uuid: 'uuid-replay-1',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    // Should stamp UUID on the last UUID-less user message (second)
    expect((msgs[1] as any).uuid).toBe('uuid-replay-1');
    // First should still have no UUID
    expect((msgs[0] as any).uuid).toBeUndefined();
  });

  it('stamps UUIDs in reverse order (findLastIndex) when replaying multiple', () => {
    messageStore.addUserMessage(SID, 'first');
    messageStore.addUserMessage(SID, 'second');

    // SDK replays — findLastIndex stamps the last UUID-less msg first (second)
    messageStore.ingestEvent(SID, {
      type: 'user_message',
      text: 'second',
      uuid: 'uuid-b',
    } as AgentEvent);

    // Now second has a UUID, first still doesn't — next replay stamps first
    messageStore.ingestEvent(SID, {
      type: 'user_message',
      text: 'first',
      uuid: 'uuid-a',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    expect((msgs[0] as any).uuid).toBe('uuid-a');
    expect((msgs[1] as any).uuid).toBe('uuid-b');
  });

  it('pushes new user message when no UUID-less match exists', () => {
    // No existing messages — should push a new one
    messageStore.ingestEvent(SID, {
      type: 'user_message',
      text: 'replayed prompt',
      uuid: 'uuid-new',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('user');
    expect((msgs[0] as any).uuid).toBe('uuid-new');
  });
});

describe('ingestEvent — rewind', () => {
  it('truncates messages after the rewind target', () => {
    // Build up a conversation with UUIDs
    messageStore.messagesBySession[SID] = [
      { kind: 'user', id: '1', text: 'first prompt', uuid: 'cp-1' },
      { kind: 'text', id: '2', text: 'response 1', uuid: 'r-1' },
      { kind: 'user', id: '3', text: 'second prompt', uuid: 'cp-2' },
      { kind: 'text', id: '4', text: 'response 2', uuid: 'r-2' },
      { kind: 'user', id: '5', text: 'third prompt', uuid: 'cp-3' },
      { kind: 'text', id: '6', text: 'response 3', uuid: 'r-3' },
    ] as any;

    messageStore.isRunning[SID] = true;
    messageStore.streamingText[SID] = 'partial';

    messageStore.ingestEvent(SID, {
      type: 'rewind',
      toMessageId: 'cp-2',
    } as AgentEvent);

    const msgs = messageStore.getMessages(SID);
    // Should keep messages before the rewind target (exclude it)
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe('1');
    expect(msgs[1].id).toBe('2');
    // Rewind target text should be placed into draft
    expect(messageStore.getDraft(SID)).toBe('second prompt');
    // Should switch to activity tab
    expect(messageStore.getActiveTab(SID)).toBe('activity');
  });

  it('resets running state and streaming buffers', () => {
    messageStore.messagesBySession[SID] = [
      { kind: 'user', id: '1', text: 'prompt', uuid: 'cp-1' },
      { kind: 'text', id: '2', text: 'response', uuid: 'r-1' },
    ] as any;
    messageStore.isRunning[SID] = true;
    messageStore.streamingText[SID] = 'leftover';
    messageStore.streamingThinking[SID] = 'thinking...';

    messageStore.ingestEvent(SID, {
      type: 'rewind',
      toMessageId: 'cp-1',
    } as AgentEvent);

    expect(messageStore.getIsRunning(SID)).toBe(false);
    expect(messageStore.getStreamingText(SID)).toBe('');
    expect(messageStore.getStreamingThinking(SID)).toBe('');
  });

  it('filesOnly leaves messages, draft and running state untouched', () => {
    messageStore.messagesBySession[SID] = [
      { kind: 'user', id: '1', text: 'prompt', uuid: 'cp-1' },
      { kind: 'text', id: '2', text: 'response', uuid: 'r-1' },
    ] as any;
    messageStore.isRunning[SID] = true;
    messageStore.setDraft(SID, 'typing');

    messageStore.ingestEvent(SID, {
      type: 'rewind',
      toMessageId: 'cp-1',
      filesOnly: true,
    } as AgentEvent);

    expect(messageStore.getMessages(SID)).toHaveLength(2);
    expect(messageStore.getDraft(SID)).toBe('typing');
    expect(messageStore.getIsRunning(SID)).toBe(true);
  });

  it('does nothing when target UUID is not found', () => {
    messageStore.messagesBySession[SID] = [
      { kind: 'user', id: '1', text: 'prompt', uuid: 'cp-1' },
      { kind: 'text', id: '2', text: 'response', uuid: 'r-1' },
    ] as any;

    messageStore.ingestEvent(SID, {
      type: 'rewind',
      toMessageId: 'nonexistent-uuid',
    } as AgentEvent);

    // Messages should be unchanged (no truncation)
    expect(messageStore.getMessages(SID)).toHaveLength(2);
  });

  it('truncates correctly during replayEvents (uses replay buffer)', () => {
    // Simulate a rewind + continue scenario replayed on refresh:
    // user sends A, agent responds, user sends B, agent responds, rewind to A, user sends C
    const events: AgentEvent[] = [
      { type: 'user_message', text: 'first', uuid: 'cp-1' },
      { type: 'assistant_text', text: 'response 1', uuid: 'r-1' },
      { type: 'result', subtype: 'success', totalCostUsd: 0, durationMs: 0, isError: false, numTurns: 1 },
      { type: 'user_message', text: 'second', uuid: 'cp-2' },
      { type: 'assistant_text', text: 'response 2', uuid: 'r-2' },
      { type: 'result', subtype: 'success', totalCostUsd: 0, durationMs: 0, isError: false, numTurns: 1 },
      { type: 'rewind', toMessageId: 'cp-1' },
      { type: 'user_message', text: 'third', uuid: 'cp-3' },
      { type: 'assistant_text', text: 'response 3', uuid: 'r-3' },
      { type: 'result', subtype: 'success', totalCostUsd: 0, durationMs: 0, isError: false, numTurns: 1 },
    ] as AgentEvent[];

    messageStore.replayEvents(SID, events);
    const msgs = messageStore.getMessages(SID);

    // After rewind to cp-1, the first prompt is removed (placed into draft),
    // then "third" is added as the new prompt
    const userMsgs = msgs.filter((m) => m.kind === 'user');
    expect(userMsgs).toHaveLength(1);
    expect((userMsgs[0] as any).text).toBe('third');

    // "first", "second" and their responses should have been truncated by the rewind
    expect(msgs.find((m) => m.kind === 'user' && (m as any).text === 'first')).toBeUndefined();
    expect(msgs.find((m) => m.kind === 'user' && (m as any).text === 'second')).toBeUndefined();
  });
});

describe('getRewindPoints', () => {
  it('returns user messages that have UUIDs (most recent first)', () => {
    messageStore.messagesBySession[SID] = [
      { kind: 'user', id: '1', text: 'first prompt', uuid: 'cp-1' },
      { kind: 'text', id: '2', text: 'response 1', uuid: 'r-1' },
      { kind: 'user', id: '3', text: 'second prompt', uuid: 'cp-2' },
      { kind: 'text', id: '4', text: 'response 2', uuid: 'r-2' },
    ] as any;

    const points = messageStore.getRewindPoints(SID);
    expect(points).toHaveLength(2);
    // Most recent first (reversed)
    expect(points[0]).toEqual({ uuid: 'cp-2', text: 'second prompt', index: 2 });
    expect(points[1]).toEqual({ uuid: 'cp-1', text: 'first prompt', index: 0 });
  });

  it('excludes user messages without UUIDs', () => {
    messageStore.messagesBySession[SID] = [
      { kind: 'user', id: '1', text: 'no uuid' },
      { kind: 'user', id: '2', text: 'has uuid', uuid: 'cp-1' },
    ] as any;

    const points = messageStore.getRewindPoints(SID);
    expect(points).toHaveLength(1);
    expect(points[0].uuid).toBe('cp-1');
  });

  it('returns empty for unknown session', () => {
    expect(messageStore.getRewindPoints('unknown')).toEqual([]);
  });
});

describe('rewind dialog', () => {
  it('openRewindDialog sets dialog open state', () => {
    messageStore.openRewindDialog(SID);
    expect(messageStore.rewindDialogOpen[SID]).toBe(true);
  });

  it('closeRewindDialog clears dialog open state', () => {
    messageStore.rewindDialogOpen[SID] = true;
    messageStore.closeRewindDialog(SID);
    expect(messageStore.rewindDialogOpen[SID]).toBe(false);
  });

  it('openRewindDialog remembers the message it was opened on, until closed', () => {
    messageStore.openRewindDialog(SID, 'uuid-target');
    expect(messageStore.rewindDialogOpen[SID]).toBe(true);
    expect(messageStore.getRewindDialogTarget(SID)).toBe('uuid-target');

    messageStore.closeRewindDialog(SID);
    expect(messageStore.getRewindDialogTarget(SID)).toBeNull();

    // /rewind (no message) opens with no preselection
    messageStore.openRewindDialog(SID);
    expect(messageStore.getRewindDialogTarget(SID)).toBeNull();
  });
});

describe('sendCommand — /rewind', () => {
  it('opens rewind dialog instead of sending to SDK', () => {
    messageStore.sendCommand(SID, '/rewind');

    expect(messageStore.rewindDialogOpen[SID]).toBe(true);
    // Should NOT send /rewind to the SDK
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
  });
});

describe('executeRewind', () => {
  it('calls rewindSession on the API bridge', async () => {
    await messageStore.executeRewind(SID, 'cp-1');
    expect(mockGroveBench.rewindSession).toHaveBeenCalledWith(SID, 'cp-1', undefined);
  });
});

describe('pagination — hasOlderEvents / olderEventCount', () => {
  it('returns false / 0 before setPagination is called', () => {
    expect(messageStore.hasOlderEvents(SID)).toBe(false);
    expect(messageStore.olderEventCount(SID)).toBe(0);
  });

  it('returns false when all events are loaded (loadedFromIndex === 0)', () => {
    messageStore.setPagination(SID, 50, 0);
    expect(messageStore.hasOlderEvents(SID)).toBe(false);
    expect(messageStore.olderEventCount(SID)).toBe(0);
  });

  it('returns true with correct count when older events exist', () => {
    messageStore.setPagination(SID, 500, 300);
    expect(messageStore.hasOlderEvents(SID)).toBe(true);
    expect(messageStore.olderEventCount(SID)).toBe(300);
  });
});

describe('source-event-index mapping (findMessageIdForEventIndex)', () => {
  it('maps an event index to the message it produced, handling merges', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: 'first', uuid: 'u1' },                                            // index 10
      { type: 'assistant_text', text: 'answer one', uuid: 'a1' },                                      // index 11
      { type: 'assistant_tool_use', toolName: 'Edit', toolInput: { file_path: '/a.ts' }, toolUseId: 't1', uuid: 'tu1' }, // 12
      { type: 'tool_result', toolUseId: 't1', content: 'done' },                                       // 13 (merges into tool_call)
    ] as AgentEvent[];
    messageStore.replayEvents(SID, events, undefined, 10);

    const msgs = messageStore.getMessages(SID);
    const userId = msgs.find((m) => m.kind === 'user')!.id;
    const textId = msgs.find((m) => m.kind === 'text')!.id;
    const toolId = msgs.find((m) => m.kind === 'tool_call')!.id;

    expect(messageStore.findMessageIdForEventIndex(SID, 10)).toBe(userId);
    expect(messageStore.findMessageIdForEventIndex(SID, 11)).toBe(textId);
    expect(messageStore.findMessageIdForEventIndex(SID, 12)).toBe(toolId);
    // tool_result (13) created no message — maps back to the tool_call (largest <= 13)
    expect(messageStore.findMessageIdForEventIndex(SID, 13)).toBe(toolId);
    // Nothing at/below 9
    expect(messageStore.findMessageIdForEventIndex(SID, 9)).toBeNull();
  });

  it('returns null for sessions with no stamped messages', () => {
    expect(messageStore.findMessageIdForEventIndex('unknown', 5)).toBeNull();
  });

  it('getEventIndexForMessageId returns the stamped index (inverse lookup)', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: 'first', uuid: 'u1' }, // 10
      { type: 'assistant_text', text: 'answer', uuid: 'a1' }, // 11
    ] as AgentEvent[];
    messageStore.replayEvents(SID, events, undefined, 10);

    const msgs = messageStore.getMessages(SID);
    const userId = msgs.find((m) => m.kind === 'user')!.id;
    const textId = msgs.find((m) => m.kind === 'text')!.id;

    expect(messageStore.getEventIndexForMessageId(SID, userId)).toBe(10);
    expect(messageStore.getEventIndexForMessageId(SID, textId)).toBe(11);
    // Unknown message id → null (e.g. live/unstamped message)
    expect(messageStore.getEventIndexForMessageId(SID, 'nope')).toBeNull();
    // Unknown session → null
    expect(messageStore.getEventIndexForMessageId('unknown', userId)).toBeNull();
  });
});

describe('pendingJumpBySession', () => {
  it('records and clears a bookmark jump request', () => {
    messageStore.requestJump(SID, { eventIndex: 5, uuid: 'u1', bookmarkId: 'b1' });
    expect(messageStore.pendingJumpBySession[SID]).toEqual({ eventIndex: 5, uuid: 'u1', bookmarkId: 'b1' });

    messageStore.clearJump(SID);
    expect(messageStore.pendingJumpBySession[SID]).toBeUndefined();
  });

  it('clearJump is a no-op when there is no pending request', () => {
    expect(() => messageStore.clearJump('no-such-session')).not.toThrow();
  });
});

describe('requestPromptInsert', () => {
  it('records the text and increments the nonce each call', () => {
    messageStore.requestPromptInsert(SID, 'first');
    const a = messageStore.promptInsertBySession[SID];
    expect(a.text).toBe('first');

    messageStore.requestPromptInsert(SID, 'second');
    const b = messageStore.promptInsertBySession[SID];
    expect(b.text).toBe('second');
    expect(b.nonce).toBe(a.nonce + 1);
  });
});

describe('pagination — loadOlderUntil', () => {
  it('loads older pages until the target index is covered', async () => {
    messageStore.setPagination(SID, 500, 300);
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({ events: [], totalCount: 500, startIndex: 100 });

    await messageStore.loadOlderUntil(SID, 150);

    // 300 > 150 → one load → loadedFromIndex 100 (<= 150) → stop
    expect(messageStore.olderEventCount(SID)).toBe(100);
    expect(mockGroveBench.getEventHistoryPage).toHaveBeenCalledTimes(1);
  });

  it('loads multiple pages when needed', async () => {
    messageStore.setPagination(SID, 500, 400);
    mockGroveBench.getEventHistoryPage
      .mockResolvedValueOnce({ events: [], totalCount: 500, startIndex: 200 })
      .mockResolvedValueOnce({ events: [], totalCount: 500, startIndex: 0 });

    await messageStore.loadOlderUntil(SID, 50);

    expect(messageStore.olderEventCount(SID)).toBe(0);
    expect(mockGroveBench.getEventHistoryPage).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the target is already loaded', async () => {
    messageStore.setPagination(SID, 500, 100);
    await messageStore.loadOlderUntil(SID, 100);
    expect(mockGroveBench.getEventHistoryPage).not.toHaveBeenCalled();
  });
});

describe('pagination — loadOlderEvents', () => {
  it('updates loadedFromIndex after loading older events', async () => {
    // Set pagination indicating 300 older events remain
    messageStore.setPagination(SID, 500, 300);
    expect(messageStore.hasOlderEvents(SID)).toBe(true);
    expect(messageStore.olderEventCount(SID)).toBe(300);

    // Mock the IPC to return a page that starts at index 100
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({
      events: [],
      totalCount: 500,
      startIndex: 100,
    });

    await messageStore.loadOlderEvents(SID, 200);

    // loadedFromIndex updated from 300 → 100
    expect(messageStore.hasOlderEvents(SID)).toBe(true);
    expect(messageStore.olderEventCount(SID)).toBe(100);
    expect(messageStore.isLoadingOlder(SID)).toBe(false);
  });

  it('sets hasOlderEvents to false when all events are loaded', async () => {
    messageStore.setPagination(SID, 100, 50);

    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({
      events: [],
      totalCount: 100,
      startIndex: 0,
    });

    await messageStore.loadOlderEvents(SID, 200);

    expect(messageStore.hasOlderEvents(SID)).toBe(false);
    expect(messageStore.olderEventCount(SID)).toBe(0);
  });

  it('is a no-op when loadedFromIndex is already 0', async () => {
    messageStore.setPagination(SID, 50, 0);
    await messageStore.loadOlderEvents(SID);
    expect(mockGroveBench.getEventHistoryPage).not.toHaveBeenCalled();
  });

  it('is a no-op when already loading', async () => {
    messageStore.setPagination(SID, 500, 300);
    // Manually set loading state
    messageStore.paginationBySession[SID] = { totalCount: 500, loadedFromIndex: 300, loading: true };
    await messageStore.loadOlderEvents(SID);
    expect(mockGroveBench.getEventHistoryPage).not.toHaveBeenCalled();
  });

  it('clears loading flag on error', async () => {
    messageStore.setPagination(SID, 500, 300);
    mockGroveBench.getEventHistoryPage.mockRejectedValueOnce(new Error('fail'));

    await messageStore.loadOlderEvents(SID).catch(() => {});

    expect(messageStore.isLoadingOlder(SID)).toBe(false);
  });
});


describe('destroySession', () => {
  it('unsubscribes, cancels timers, and deletes all per-session state', async () => {
    // Seed a subscription and some per-session state
    messageStore.subscribe(SID);
    messageStore.messagesBySession[SID] = [{ kind: 'system', id: 'm1', text: 'hi' }] as any;
    messageStore.modelBySession[SID] = 'claude-opus-4-8';
    messageStore.usageBySession[SID] = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 };
    messageStore.setPagination(SID, 10, 5);

    messageStore.destroySession(SID);

    expect(mockGroveBench.offAgentEvent).toHaveBeenCalledWith(SID);
    expect(messageStore.getMessages(SID)).toEqual([]);
    expect(messageStore.getModel(SID)).toBe('');
    expect(messageStore.usageBySession[SID]).toBeUndefined();
    expect(messageStore.paginationBySession[SID]).toBeUndefined();
    // hasOlderEvents should be false again after teardown
    expect(messageStore.hasOlderEvents(SID)).toBe(false);
  });

  it('allows a fresh subscribe after destroy (cleanup cleared the guard)', () => {
    messageStore.subscribe(SID);
    messageStore.destroySession(SID);
    messageStore.subscribe(SID);
    // onAgentEvent called twice: once per subscribe, proving the guard was cleared
    expect(mockGroveBench.onAgentEvent).toHaveBeenCalledTimes(2);
  });
});

describe('outgoing message queue', () => {
  const result: AgentEvent = { type: 'result', subtype: 'success', isError: false } as AgentEvent;
  const init: AgentEvent = { type: 'system_init', sessionId: 'p', model: 'm', tools: [] } as AgentEvent;

  it('sends immediately when the session is idle', () => {
    const outcome = messageStore.submitMessage(SID, { displayText: 'hi', outgoing: 'hi' });

    expect(outcome).toBe('sent');
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'hi', undefined);
    expect(messageStore.getQueue(SID)).toEqual([]);
    expect(messageStore.getIsRunning(SID)).toBe(true);
    expect(messageStore.getMessages(SID).map((m) => m.kind)).toEqual(['user']);
  });

  it('queues (and does not send) while a turn is running', () => {
    messageStore.submitMessage(SID, { displayText: 'first', outgoing: 'first' });
    mockGroveBench.sendMessage.mockClear();

    const outcome = messageStore.submitMessage(SID, { displayText: 'second', outgoing: 'second <full>' });

    expect(outcome).toBe('queued');
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
    expect(messageStore.getQueue(SID)).toHaveLength(1);
    expect(messageStore.getQueue(SID)[0]).toMatchObject({ displayText: 'second', outgoing: 'second <full>' });
    // Not shown in the thread until it is actually sent
    expect(messageStore.getMessages(SID).map((m) => (m as any).text)).toEqual(['first']);
    expect(messageStore.canSendNow(SID)).toBe(false);
  });

  it('sends queued prompts one per turn, in order, when results arrive', () => {
    messageStore.submitMessage(SID, { displayText: 'first', outgoing: 'first' });
    messageStore.submitMessage(SID, { displayText: 'second', outgoing: 'second' });
    messageStore.submitMessage(SID, { displayText: 'third', outgoing: 'third', images: [{ data: 'x', mediaType: 'image/png', name: 'a.png' }] });
    mockGroveBench.sendMessage.mockClear();

    messageStore.ingestEvent(SID, result);

    expect(mockGroveBench.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockGroveBench.sendMessage).toHaveBeenLastCalledWith(SID, 'second', undefined);
    expect(messageStore.getQueue(SID).map((m) => m.displayText)).toEqual(['third']);
    // The new turn is running again, so the third waits
    expect(messageStore.getIsRunning(SID)).toBe(true);

    messageStore.ingestEvent(SID, result);

    expect(mockGroveBench.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockGroveBench.sendMessage).toHaveBeenLastCalledWith(SID, 'third', [{ data: 'x', mediaType: 'image/png', name: 'a.png' }]);
    expect(messageStore.getQueue(SID)).toEqual([]);

    const userTexts = messageStore.getMessages(SID).filter((m) => m.kind === 'user').map((m) => (m as any).text);
    expect(userTexts).toEqual(['first', 'second', 'third']);
  });

  it('sends the next queued prompt when a restarted query connects idle', () => {
    // Session is "running" (e.g. connecting after a stop/restart) with a queued item
    messageStore.setIsRunning(SID, true);
    messageStore.submitMessage(SID, { displayText: 'later', outgoing: 'later' });
    messageStore.setIsRunning(SID, false);
    mockGroveBench.sendMessage.mockClear();

    messageStore.ingestEvent(SID, init);

    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'later', undefined);
    expect(messageStore.getQueue(SID)).toEqual([]);
  });

  it('does not flush on system_init while a submitted prompt is still awaiting its response', () => {
    // First prompt goes straight to main (fresh session, not yet connected)
    messageStore.submitMessage(SID, { displayText: 'first', outgoing: 'first' });
    messageStore.submitMessage(SID, { displayText: 'second', outgoing: 'second' });
    mockGroveBench.sendMessage.mockClear();

    messageStore.ingestEvent(SID, init);

    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
    expect(messageStore.getQueue(SID)).toHaveLength(1);
    expect(messageStore.getIsRunning(SID)).toBe(true);
  });

  it('never flushes from replayed history', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.submitMessage(SID, { displayText: 'q', outgoing: 'q' });
    mockGroveBench.sendMessage.mockClear();

    messageStore.replayEvents(SID, [init, result]);

    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
    expect(messageStore.getQueue(SID)).toHaveLength(1);
  });

  it('removes a single queued item', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.submitMessage(SID, { displayText: 'a', outgoing: 'a' });
    messageStore.submitMessage(SID, { displayText: 'b', outgoing: 'b' });
    const [a] = messageStore.getQueue(SID);

    messageStore.removeQueuedMessage(SID, a.id);

    expect(messageStore.getQueue(SID).map((m) => m.displayText)).toEqual(['b']);
    mockGroveBench.sendMessage.mockClear();
    messageStore.ingestEvent(SID, result);
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'b', undefined);
  });

  it('clearQueue drops everything so nothing is sent after the turn', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.submitMessage(SID, { displayText: 'a', outgoing: 'a' });
    messageStore.submitMessage(SID, { displayText: 'b', outgoing: 'b' });

    messageStore.clearQueue(SID);
    mockGroveBench.sendMessage.mockClear();
    messageStore.ingestEvent(SID, result);

    expect(messageStore.getQueue(SID)).toEqual([]);
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
  });

  it('editQueuedMessage moves the text back to the prompt input', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.submitMessage(SID, { displayText: 'fix it', outgoing: 'fix it' });
    const [item] = messageStore.getQueue(SID);

    expect(messageStore.editQueuedMessage(SID, item.id)).toBe(true);

    expect(messageStore.getQueue(SID)).toEqual([]);
    expect(messageStore.promptInsertBySession[SID]?.text).toBe('fix it');
    expect(messageStore.editQueuedMessage(SID, 'nope')).toBe(false);
  });

  it('Stop pauses the queue; the restarted query does not fire the next item until Resume', () => {
    messageStore.submitMessage(SID, { displayText: 'first', outgoing: 'first' });
    messageStore.submitMessage(SID, { displayText: 'second', outgoing: 'second' });
    mockGroveBench.sendMessage.mockClear();

    messageStore.markSessionStopped(SID);
    expect(messageStore.isQueuePaused(SID)).toBe(true);
    expect(messageStore.getIsRunning(SID)).toBe(false);

    // Restart connects idle — still held
    messageStore.ingestEvent(SID, init);
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
    expect(messageStore.getQueue(SID)).toHaveLength(1);

    messageStore.resumeQueue(SID);
    expect(messageStore.isQueuePaused(SID)).toBe(false);
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'second', undefined);
    expect(messageStore.getQueue(SID)).toEqual([]);
  });

  it('Stop with an empty queue does not leave a pause behind', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.markSessionStopped(SID);
    expect(messageStore.isQueuePaused(SID)).toBe(false);
  });

  it('a new prompt typed while paused and idle is sent ahead of the held items', () => {
    messageStore.submitMessage(SID, { displayText: 'first', outgoing: 'first' });
    messageStore.submitMessage(SID, { displayText: 'held', outgoing: 'held' });
    messageStore.markSessionStopped(SID);
    mockGroveBench.sendMessage.mockClear();

    expect(messageStore.canSendNow(SID)).toBe(true);
    const outcome = messageStore.submitMessage(SID, { displayText: 'correction', outgoing: 'correction' });

    expect(outcome).toBe('sent');
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'correction', undefined);
    // Still paused: the held item waits for an explicit Resume
    expect(messageStore.isQueuePaused(SID)).toBe(true);
    expect(messageStore.getQueue(SID).map((m) => m.displayText)).toEqual(['held']);
    messageStore.ingestEvent(SID, result);
    expect(mockGroveBench.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('removing the last paused item clears the pause', () => {
    messageStore.submitMessage(SID, { displayText: 'first', outgoing: 'first' });
    messageStore.submitMessage(SID, { displayText: 'held', outgoing: 'held' });
    messageStore.markSessionStopped(SID);
    const [held] = messageStore.getQueue(SID);

    messageStore.removeQueuedMessage(SID, held.id);

    expect(messageStore.isQueuePaused(SID)).toBe(false);
  });

  it('rewind pauses the queue', () => {
    messageStore.submitMessage(SID, { displayText: 'first', outgoing: 'first' });
    messageStore.submitMessage(SID, { displayText: 'held', outgoing: 'held' });

    messageStore.ingestEvent(SID, { type: 'rewind', toMessageId: 'none', conversationOnly: true } as AgentEvent);

    expect(messageStore.isQueuePaused(SID)).toBe(true);
    expect(messageStore.getQueue(SID)).toHaveLength(1);
  });

  it('slash commands queue while running and dispatch through sendCommand', () => {
    messageStore.submitMessage(SID, { displayText: 'first', outgoing: 'first' });
    mockGroveBench.sendMessage.mockClear();

    expect(messageStore.submitCommand(SID, '/compact')).toBe('queued');
    expect(messageStore.getQueue(SID)[0]).toMatchObject({ outgoing: '/compact', isCommand: true });
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();

    messageStore.ingestEvent(SID, result);

    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, '/compact');
    const last = messageStore.getMessages(SID).at(-1) as any;
    expect(last.kind).toBe('user');
    expect(last.text).toBe('/compact');
  });

  it('/clear queued behind a turn still arms pendingClear when it goes out', () => {
    messageStore.submitMessage(SID, { displayText: 'first', outgoing: 'first' });
    messageStore.submitCommand(SID, '/clear');
    expect(messageStore.pendingClear[SID]).toBeUndefined();

    messageStore.ingestEvent(SID, result);

    expect(messageStore.pendingClear[SID]).toBe(true);
  });

  it('/rewind is client-side and never queued, even while running', () => {
    messageStore.setIsRunning(SID, true);

    expect(messageStore.submitCommand(SID, '/rewind')).toBe('sent');

    expect(messageStore.getQueue(SID)).toEqual([]);
    expect(messageStore.rewindDialogOpen[SID]).toBe(true);
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
  });

  it('a slash command sent while idle goes straight out', () => {
    expect(messageStore.submitCommand(SID, '/compact')).toBe('sent');
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, '/compact');
  });

  it('process_exit and error do not fire queued prompts (no query to receive them)', () => {
    messageStore.submitMessage(SID, { displayText: 'first', outgoing: 'first' });
    messageStore.submitMessage(SID, { displayText: 'second', outgoing: 'second' });
    mockGroveBench.sendMessage.mockClear();

    messageStore.ingestEvent(SID, { type: 'error', message: 'boom' } as AgentEvent);
    messageStore.ingestEvent(SID, { type: 'process_exit' } as AgentEvent);

    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
    expect(messageStore.getQueue(SID)).toHaveLength(1);
    // ...but the item is sent once the resumed query connects idle
    messageStore.ingestEvent(SID, init);
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'second', undefined);
  });

  it('destroySession drops the queue and pause state', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.submitMessage(SID, { displayText: 'a', outgoing: 'a' });
    messageStore.markSessionStopped(SID);

    messageStore.destroySession(SID);

    expect(messageStore.queuedBySession[SID]).toBeUndefined();
    expect(messageStore.queuePausedBySession[SID]).toBeUndefined();
  });
});

describe('appendToPrompt', () => {
  it('updates the draft and raises an insert request', () => {
    messageStore.setDraft(SID, '');
    messageStore.appendToPrompt(SID, 'first');
    expect(messageStore.getDraft(SID)).toBe('first');
    expect(messageStore.promptInsertBySession[SID]).toEqual({ text: 'first', nonce: 1 });

    messageStore.appendToPrompt(SID, 'second');
    expect(messageStore.getDraft(SID)).toBe('first\nsecond');
    expect(messageStore.promptInsertBySession[SID].nonce).toBe(2);
  });
});
