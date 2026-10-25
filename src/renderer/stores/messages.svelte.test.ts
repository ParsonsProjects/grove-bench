import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { IDLE_TURN, mockGroveBench } from '../__mocks__/setup.js';

import { messageStore, settlePrompts, type ChatUserMessage } from './messages.svelte.js';
import { userMessageLabel } from '../lib/message-label.js';
import { store as sessionStore } from './sessions.svelte.js';
import { checkpointStore } from './checkpoints.svelte.js';
import { gitStatusStore } from './gitStatus.svelte.js';
import { backgroundTaskStore } from './backgroundTask.svelte.js';
import { rateLimitStore } from './rateLimit.svelte.js';
import { usageStore } from './usage.svelte.js';
import { settingsStore } from './settings.svelte.js';
import type { AgentEvent } from '../../shared/types.js';
import { CONTROL_IDS } from '../../shared/types.js';

const SID = 'test-session';

beforeEach(() => {
  vi.clearAllMocks();
  // Each test starts from a clean store: state left by an earlier test
  // (a stop in progress, a buffered stream, a mode the user set) changes
  // what the next one sees.
  messageStore.destroyAllSessions();
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
  messageStore.promptSuggestionBySession = {};
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
    });

    expect(messageStore.getControlValue(SID, 'thinking')).toBe('low');
    expect(mockGroveBench.setControl).not.toHaveBeenCalled();
  });

  it('marks session as ready and not running', () => {
    messageStore.ingestEvent(SID, {
      type: 'system_init',
      sessionId: SID,
      model: 'test-model-v1',
      tools: ['Read', 'Edit'],
    });

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
    });

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
    });

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
    });

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
    });

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
    });

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
    });

    const info = messageStore.getSystemInfo(SID);
    expect(info.tools).toEqual(['Read', 'Edit']);
    expect(info.agents).toEqual(['agent1']);
    expect(info.skills).toEqual(['commit']);
  });
});

describe('ingestEvent — text streaming', () => {
  it('accumulates partial_text into streaming buffer', () => {
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'Hello ' });
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'world' });

    // Deltas are coalesced: nothing reactive changes until the flush tick.
    expect(messageStore.getStreamingText(SID)).toBe('');
    messageStore.flushStreamBuffers();
    expect(messageStore.getStreamingText(SID)).toBe('Hello world');
    expect(messageStore.getIsRunning(SID)).toBe(true);
  });

  it('keeps a stopped reply in one piece, buffered tail included', () => {
    const id = 'stop-fragment';
    vi.useFakeTimers();
    try {
      messageStore.ingestEvent(id, { type: 'partial_text', text: 'Hello ' });
      messageStore.flushStreamBuffers();
      messageStore.ingestEvent(id, { type: 'partial_text', text: 'world' });

      messageStore.markSessionStopped(id);
      vi.advanceTimersByTime(200);

      const texts = messageStore.getMessages(id).filter((m) => m.kind === 'text').map((m) => (m as { text: string }).text);
      expect(texts).toEqual(['Hello world']);
      expect(messageStore.getStreamingText(id)).toBe('');
    } finally {
      vi.useRealTimers();
      messageStore.destroySession(id);
    }
  });

  it('applies buffered deltas before a non-streaming event is processed', () => {
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'buffered' });
    messageStore.ingestEvent(SID, { type: 'activity', activity: 'generating' });
    expect(messageStore.getStreamingText(SID)).toBe('buffered');
  });

  it('drops buffered text deltas superseded by the finalized assistant_text', () => {
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'preview' });
    messageStore.ingestEvent(SID, { type: 'assistant_text', text: 'Final', uuid: 'u1' });
    expect(messageStore.getStreamingText(SID)).toBe('');
    messageStore.flushStreamBuffers();
    expect(messageStore.getStreamingText(SID)).toBe('');
    expect(messageStore.getMessages(SID)).toHaveLength(1);
  });

  it('clears streaming thinking when partial_text arrives', () => {
    messageStore.streamingThinking[SID] = 'thinking...';
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'hi' });
    expect(messageStore.getStreamingThinking(SID)).toBe('');
  });

  it('assistant_text clears streaming and pushes finalized message', () => {
    messageStore.streamingText[SID] = 'preview text';
    messageStore.ingestEvent(SID, {
      type: 'assistant_text',
      text: 'Final answer',
      uuid: 'uuid-1',
    });

    expect(messageStore.getStreamingText(SID)).toBe('');
    const msgs = messageStore.getMessages(SID);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('text');
    expect((msgs[0] as any).text).toBe('Final answer');
  });
});

describe('ingestEvent — thinking', () => {
  it('accumulates partial_thinking', () => {
    messageStore.ingestEvent(SID, { type: 'partial_thinking', text: 'Let me ' });
    messageStore.ingestEvent(SID, { type: 'partial_thinking', text: 'think...' });

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
    });

    expect(messageStore.getStreamingThinking(SID)).toBe('');
    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('thinking');
  });

  it('skips thinking that arrived without text', () => {
    messageStore.streamingThinking[SID] = 'preview';
    messageStore.ingestEvent(SID, { type: 'thinking', thinking: '', uuid: 'uuid-t' });

    expect(messageStore.getStreamingThinking(SID)).toBe('');
    expect(messageStore.getMessages(SID)).toHaveLength(0);
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
    });

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
    });

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
    });

    messageStore.ingestEvent(SID, {
      type: 'tool_result',
      toolUseId: 'tu-3',
      content: 'file1.ts\nfile2.ts',
      isError: false,
    });

    const msgs = messageStore.getMessages(SID);
    const tc = msgs[0] as any;
    expect(tc.pending).toBe(false);
    expect(tc.result).toBe('file1.ts\nfile2.ts');
    expect(tc.isError).toBe(false);
  });

  it('tool_result keeps the images the tool returned', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'mcp__grove-preview__screenshot',
      toolInput: {},
      toolUseId: 'tu-shot',
      uuid: 'uuid-shot',
    });
    const images = [{ file: 'b'.repeat(32) + '.png' }];
    messageStore.ingestEvent(SID, { type: 'tool_result', toolUseId: 'tu-shot', content: '', images });

    const tc = messageStore.getMessages(SID)[0] as any;
    expect(tc.pending).toBe(false);
    expect(tc.images).toEqual(images);
  });

  it('mode-changing tool_use does NOT sync mode (mode_sync events handle it)', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'EnterPlanMode',
      toolInput: {},
      toolUseId: 'tu-plan',
      uuid: 'u-plan',
    });

    // Mode stays 'default' — only mode_sync events change it
    expect(messageStore.getMode(SID)).toBe('default');
  });

  it('any tool_use does NOT sync mode (mode_sync events handle it)', () => {
    messageStore.modeBySession[SID] = 'plan';
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use',
      toolName: 'ExitPlanMode',
      toolInput: {},
      toolUseId: 'tu-exit',
      uuid: 'u-exit',
    });

    // Mode stays 'plan' — only mode_sync events change it
    expect(messageStore.getMode(SID)).toBe('plan');
  });
});

describe('ingestEvent — subagent events', () => {
  const agentCall: AgentEvent = {
    type: 'assistant_tool_use', toolName: 'Agent', toolInput: { description: 'Find the burst' }, toolUseId: 'tu-agent', uuid: 'u1',
  };
  const sub = (event: object) => ({ ...event, parentToolUseId: 'tu-agent' }) as AgentEvent;

  it('keeps a subagent\'s text, thinking and tool calls under its Agent call, out of the thread', () => {
    messageStore.ingestEvent(SID, agentCall);
    messageStore.ingestEvent(SID, sub({ type: 'thinking', thinking: 'Where is it scheduled?', uuid: 's1' }));
    messageStore.ingestEvent(SID, sub({ type: 'assistant_tool_use', toolName: 'Grep', toolInput: { pattern: 'cron' }, toolUseId: 'tu-grep', uuid: 's2' }));
    messageStore.ingestEvent(SID, sub({ type: 'assistant_text', text: 'I sent the report to your caller.', uuid: 's3' }));

    const msgs = messageStore.getMessages(SID);
    expect(msgs.map((m) => [m.kind, 'parentToolUseId' in m ? m.parentToolUseId : undefined])).toEqual([
      ['tool_call', undefined],
      ['thinking', 'tu-agent'],
      ['tool_call', 'tu-agent'],
      ['text', 'tu-agent'],
    ]);
  });

  it('leaves the main agent\'s live reply alone', () => {
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'The cause ' });
    messageStore.ingestEvent(SID, sub({ type: 'assistant_text', text: 'subagent note', uuid: 's1' }));
    messageStore.ingestEvent(SID, { type: 'partial_text', text: 'is the cron job' });
    messageStore.ingestEvent(SID, sub({ type: 'assistant_tool_use', toolName: 'Grep', toolInput: {}, toolUseId: 'tu-grep', uuid: 's2' }));
    messageStore.flushStreamBuffers();

    // Neither dropped part of the reply nor cut it short into a message.
    expect(messageStore.getStreamingText(SID)).toBe('The cause is the cron job');
    expect(messageStore.getMessages(SID).filter((m) => !('parentToolUseId' in m && m.parentToolUseId))).toEqual([]);
  });

  it('does not mark an idle conversation running: a background subagent outlives the turn', () => {
    messageStore.ingestEvent(SID, sub({ type: 'assistant_tool_use', toolName: 'Grep', toolInput: {}, toolUseId: 'tu-grep', uuid: 's1' }));
    messageStore.ingestEvent(SID, sub({ type: 'assistant_text', text: 'note', uuid: 's2' }));
    messageStore.ingestEvent(SID, sub({ type: 'thinking', thinking: 'hmm', uuid: 's3' }));

    expect(messageStore.getIsRunning(SID)).toBe(false);
    expect(messageStore.getActivity(SID).activity).not.toBe('tool_starting');
  });

  it('settles a subagent\'s tool call with its result', () => {
    messageStore.ingestEvent(SID, sub({ type: 'assistant_tool_use', toolName: 'Grep', toolInput: {}, toolUseId: 'tu-grep', uuid: 's1' }));
    messageStore.ingestEvent(SID, sub({ type: 'tool_result', toolUseId: 'tu-grep', content: 'serverless.ts:12' }));

    expect(messageStore.getMessages(SID)[0]).toMatchObject({ kind: 'tool_call', pending: false, result: 'serverless.ts:12', parentToolUseId: 'tu-agent' });
  });

  it('names the subagent each pending call runs in or starts, for the status bar', () => {
    messageStore.ingestEvent(SID, { ...agentCall, toolInput: { description: 'Find the burst', subagent_type: 'Explore' } });
    messageStore.ingestEvent(SID, sub({ type: 'assistant_tool_use', toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 'tu-bash', uuid: 's1' }));
    messageStore.ingestEvent(SID, { type: 'assistant_tool_use', toolName: 'Read', toolInput: {}, toolUseId: 'tu-read', uuid: 'u2' });

    expect(messageStore.getPendingTools(SID).map(({ toolUseId, subagentCall, inSubagent }) => ({ toolUseId, subagentCall, inSubagent }))).toEqual([
      { toolUseId: 'tu-agent', subagentCall: 'tu-agent', inSubagent: undefined },
      { toolUseId: 'tu-bash', subagentCall: 'tu-agent', inSubagent: 'Explore' },
      { toolUseId: 'tu-read', subagentCall: undefined, inSubagent: undefined },
    ]);
  });

  it('reports a background subagent as running after its Agent call returned', () => {
    messageStore.ingestEvent(SID, { type: 'task_started', taskId: 'bg-1', toolUseId: 'tu-agent', description: 'Find the burst' });
    expect(backgroundTaskStore.isRunningFor(SID, 'tu-agent')).toBe(true);
    expect(backgroundTaskStore.isRunningFor(SID, 'tu-other')).toBe(false);

    messageStore.ingestEvent(SID, {
      type: 'task_notification', taskId: 'bg-1', toolUseId: 'tu-agent', taskStatus: 'completed', summary: 'done', outputFile: '',
    });
    expect(backgroundTaskStore.isRunningFor(SID, 'tu-agent')).toBe(false);
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
    });

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
    });

    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('question');
    const q = msgs[0] as any;
    expect(q.questions).toHaveLength(1);
    expect(q.resolved).toBe(false);
  });

  it("takes another agent's questions from its view", () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'ask_user',
      toolInput: { anything: 'else' },
      toolUseId: 'tu-q2',
      requestId: 'req-q2',
      toolCategory: 'question',
      toolView: { kind: 'question', questions: [{ question: 'Ship it?', options: [{ label: 'Yes' }, { label: 'No', description: 'Not yet' }] }] },
    });

    const q = messageStore.getMessages(SID).find((m) => m.kind === 'question') as any;
    expect(q.questions).toEqual([{
      question: 'Ship it?', header: '', multiSelect: false,
      options: [{ label: 'Yes', description: '' }, { label: 'No', description: 'Not yet' }],
    }]);
  });
});

describe('OS notification triggers', () => {
  // notifyOs only fires for sessions that are still open — register SID as one.
  beforeEach(() => {
    sessionStore.sessions = [{ id: SID, branch: 'feat/x', repoPath: 'C:/repo', status: 'running' }];
  });

  it('notifies turn completion from the result event', () => {
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', isError: false });
    expect(mockGroveBench.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn_complete', sessionId: SID, body: 'Agent finished a turn' }),
    );
  });

  it('uses error wording when the turn ended with an error', () => {
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'error_during_execution', isError: true });
    expect(mockGroveBench.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn_complete', body: 'Agent turn ended with an error' }),
    );
  });

  it('notifies permission requests with the tool name', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request', toolName: 'Bash', toolInput: {}, toolUseId: 't1', requestId: 'r1',
    });
    expect(mockGroveBench.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'permission_request', body: 'The agent wants to run a command' }),
    );
  });

  it('uses plain language for plan approvals and questions', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request', toolName: 'ExitPlanMode', toolInput: {}, toolUseId: 't2', requestId: 'r2', isPlanExecution: true,
    });
    expect(mockGroveBench.notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'A plan is ready for review' }),
    );

    messageStore.ingestEvent(SID, {
      type: 'permission_request', toolName: 'AskUserQuestion', toolInput: { questions: [] }, toolUseId: 't3', requestId: 'r3', toolCategory: 'question',
    });
    expect(mockGroveBench.notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Agent is waiting for an answer' }),
    );
  });

  it('never notifies from replayed history', () => {
    messageStore.replayEvents(SID, [
      { type: 'permission_request', toolName: 'Bash', toolInput: {}, toolUseId: 't4', requestId: 'r4' },
      { type: 'result', subtype: 'success', isError: false },
    ]);
    expect(mockGroveBench.notify).not.toHaveBeenCalled();
  });

  it('never notifies for a stopped session', () => {
    sessionStore.sessions = [{ id: SID, branch: 'feat/x', repoPath: 'C:/repo', status: 'stopped' }];
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', isError: false });
    expect(mockGroveBench.notify).not.toHaveBeenCalled();
  });

  it('never notifies for a session no longer in the store', () => {
    sessionStore.sessions = [];
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', isError: false });
    expect(mockGroveBench.notify).not.toHaveBeenCalled();
  });
});

describe('ingestEvent: files_made', () => {
  it('lists the files a turn made after its reply, ahead of the result', () => {
    messageStore.streamingText[SID] = 'Saved the screenshots.';
    const files = [
      { path: 'shots/home.png', kind: 'image' as const, size: 70, image: { file: 'c'.repeat(32) + '.png' } },
      { path: 'report.pdf', kind: 'pdf' as const, size: 9 },
    ];
    messageStore.ingestEvent(SID, { type: 'files_made', files, more: 2 });
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', isError: false });

    const msgs = messageStore.getMessages(SID);
    expect(msgs.map((m) => m.kind)).toEqual(['text', 'files_made', 'result']);
    expect(msgs[1]).toMatchObject({ kind: 'files_made', files, more: 2 });
  });
});

describe('ingestEvent: files_kept', () => {
  it('adds the line offering the replaced files back after the rewind', () => {
    messageStore.ingestEvent(SID, { type: 'user_message', text: 'First', uuid: 'u1' });
    messageStore.ingestEvent(SID, { type: 'rewind', toMessageId: 'u1' });
    messageStore.ingestEvent(SID, { type: 'files_kept', reason: 'rewind', copy: 'c1' });

    expect(messageStore.getMessages(SID)).toMatchObject([{ kind: 'files_kept', reason: 'rewind', copy: 'c1' }]);
  });

  // The files on disk changed: the Changes list and the checkpoint diffs follow.
  it('refreshes the changes after files are brought back', () => {
    const refresh = vi.spyOn(gitStatusStore, 'refresh').mockResolvedValue(undefined);
    const schedule = vi.spyOn(checkpointStore, 'scheduleRefresh').mockImplementation(() => {});
    try {
      messageStore.ingestEvent(SID, { type: 'files_kept', reason: 'bring_back', copy: 'c2' });
      expect(refresh).toHaveBeenCalledWith(SID);
      expect(schedule).toHaveBeenCalledWith(SID);
    } finally {
      refresh.mockRestore();
      schedule.mockRestore();
    }
  });

  it('puts text that was streaming above the line', () => {
    messageStore.streamingText[SID] = 'Half a sentence';
    messageStore.ingestEvent(SID, { type: 'files_kept', reason: 'bring_back', copy: 'c2' });
    expect(messageStore.getMessages(SID).map((m) => m.kind)).toEqual(['text', 'files_kept']);
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
    });

    expect(messageStore.getIsRunning(SID)).toBe(false);
    expect(messageStore.getActivity(SID).activity).toBe('idle');
  });

  it('flushes streaming text before result', () => {
    messageStore.streamingText[SID] = 'leftover';
    messageStore.ingestEvent(SID, {
      type: 'result',
      subtype: 'success',
      isError: false,
    });

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
    });

    expect(messageStore.getContextWindow(SID)).toBe(100000);
    expect(messageStore.getTurns(SID)).toBe(5);
  });

  it('counts a finished turn as activity, but not one played back from history', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 5_000 });
    try {
      sessionStore.sessions = [{ id: SID, branch: 'feat/x', repoPath: 'C:/repo', status: 'running', lastActiveAt: 1_000 }];
      messageStore.replayEvents(SID, [{ type: 'result', subtype: 'success', isError: false }]);
      expect(sessionStore.sessions[0].lastActiveAt).toBe(1_000);

      messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', isError: false });
      expect(sessionStore.sessions[0].lastActiveAt).toBe(5_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ingestEvent — usage', () => {
  it('tracks input tokens as latest (not cumulative), and keeps no output total', () => {
    messageStore.ingestEvent(SID, {
      type: 'usage',
      inputTokens: 1000,
      outputTokens: 200,
    });
    messageStore.ingestEvent(SID, {
      type: 'usage',
      inputTokens: 1500,
      outputTokens: 300,
    });

    const usage = messageStore.getUsage(SID);
    expect(usage.inputTokens).toBe(1500); // latest, not summed
    // A reply's output count is a placeholder; main keeps the thread's total.
    expect(usage).not.toHaveProperty('outputTokens');
  });
});

describe('ingestEvent — error and status', () => {
  it('pushes error message', () => {
    messageStore.ingestEvent(SID, { type: 'error', message: 'Something broke' });
    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('error');
    expect((msgs[0] as any).text).toBe('Something broke');
  });

  it('pushes status as system message', () => {
    messageStore.ingestEvent(SID, { type: 'status', message: 'Loading...' });
    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('system');
    expect((msgs[0] as any).text).toBe('Loading...');
  });

  it('keeps a warning level on status messages', () => {
    messageStore.ingestEvent(SID, { type: 'status', message: 'No sandbox', level: 'warning' });
    expect(messageStore.getMessages(SID)[0]).toMatchObject({ kind: 'system', text: 'No sandbox', level: 'warning' });
  });

  it('pushes a git identity notice', () => {
    messageStore.ingestEvent(SID, { type: 'git_identity_missing' });
    expect(messageStore.getMessages(SID).map((m) => m.kind)).toEqual(['git_identity_missing']);
  });
});

describe('ingestEvent — rate_limit (delegates to rateLimitStore)', () => {
  it('stores rate limit state', () => {
    messageStore.ingestEvent(SID, {
      type: 'rate_limit',
      status: 'allowed_warning',
      utilization: 0.85,
    });

    const rl = rateLimitStore.get(SID);
    expect(rl!.status).toBe('allowed_warning');
    expect(rl!.utilization).toBe(0.85);
  });

  it('pushes system message on rejection', () => {
    messageStore.ingestEvent(SID, {
      type: 'rate_limit',
      status: 'rejected',
      rateLimitType: 'token',
    });

    const msgs = messageStore.getMessages(SID);
    expect(msgs[0].kind).toBe('system');
    expect((msgs[0] as any).text).toContain('Rate limited');
    expect((msgs[0] as any).text).toContain('token');
  });

  it('updates plan usage from a live event but not from a replayed one', () => {
    usageStore.byProvider = {};
    sessionStore.sessions = [{ id: SID, branch: 'b', repoPath: '/r', status: 'running', agentType: 'claude-code' }] as any;
    const old = { type: 'rate_limit', status: 'allowed', rateLimitType: 'five_hour', utilization: 0.9 } as AgentEvent;

    messageStore.replayEvents(SID, [old]);
    expect(usageStore.get('claude-code')).toBeNull();
    expect(rateLimitStore.get(SID)?.utilization).toBe(0.9);

    messageStore.ingestEvent(SID, { ...old, utilization: 0.3 } as AgentEvent);
    expect(usageStore.get('claude-code')?.windows[0].utilization).toBe(0.3);
    usageStore.byProvider = {};
  });
});

describe('ingestEvent — agent_changed', () => {
  it('moves the conversation to the new agent and drops the old agent\'s controls', () => {
    sessionStore.sessions = [{ id: SID, branch: 'b', repoPath: '/r', status: 'running', agentType: 'claude-code' }] as any;
    messageStore.controlsBySession[SID] = { descriptors: [], values: {} };
    messageStore.modelBySession[SID] = 'claude-opus-5-5';

    messageStore.ingestEvent(SID, { type: 'agent_changed', from: 'claude-code', to: 'gemini-cli', fromName: 'Claude Agent', toName: 'Gemini CLI', transcript: true });

    expect(sessionStore.sessions[0].agentType).toBe('gemini-cli');
    expect(messageStore.controlsBySession[SID]).toBeUndefined();
    expect(messageStore.getModel(SID)).toBe('');
  });
});

describe('ingestEvent — compact_boundary', () => {
  it('pushes compaction system message', () => {
    messageStore.ingestEvent(SID, {
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 150000,
    });

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
    });

    const activity = messageStore.getActivity(SID);
    expect(activity.activity).toBe('tool_starting');
    expect(activity.toolName).toBe('Bash');
    expect(activity.elapsedSeconds).toBe(5);
  });
});

describe('ingestEvent — activity', () => {
  it('sets running when not idle', () => {
    messageStore.ingestEvent(SID, { type: 'activity', activity: 'generating' });
    expect(messageStore.getIsRunning(SID)).toBe(true);
    expect(messageStore.getActivity(SID).activity).toBe('generating');
  });

  it('does not set running for idle', () => {
    messageStore.setIsRunning(SID, false);
    messageStore.ingestEvent(SID, { type: 'activity', activity: 'idle' });
    expect(messageStore.getIsRunning(SID)).toBe(false);
  });
});

describe('ingestEvent — process_exit', () => {
  it('marks session as stopped', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.streamingText[SID] = 'leftover';
    messageStore.ingestEvent(SID, { type: 'process_exit' });

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
    });

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
    });

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
    messageStore.ingestEvent(SID, { type: 'task_started', taskId: 'bg-1', description: 'Long job' });
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', result: '', totalCostUsd: 0, durationMs: 1 } as AgentEvent);

    expect(messageStore.getIsRunning(SID)).toBe(false);
    const tasks = backgroundTaskStore.get(SID);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('running');
  });

  it('drops running tasks once the agent process exits', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.ingestEvent(SID, { type: 'task_started', taskId: 'bg-1', description: 'Long job' });
    messageStore.ingestEvent(SID, { type: 'process_exit' });

    expect(backgroundTaskStore.get(SID)).toHaveLength(0);
  });

  it('applies background_tasks_changed as the authoritative task list', () => {
    messageStore.ingestEvent(SID, { type: 'task_started', taskId: 'bg-1', description: 'One' });
    messageStore.ingestEvent(SID, { type: 'task_started', taskId: 'bg-2', description: 'Two' });
    messageStore.ingestEvent(SID, {
      type: 'background_tasks_changed',
      tasks: [{ taskId: 'bg-2', description: 'Two' }],
    });

    expect(backgroundTaskStore.get(SID).map((t) => t.taskId)).toEqual(['bg-2']);
  });
});

describe('ingestEvent — prompt_suggestion', () => {
  it('keeps the newest suggestion', () => {
    messageStore.ingestEvent(SID, { type: 'prompt_suggestion', suggestion: 'Try this' });
    messageStore.ingestEvent(SID, { type: 'prompt_suggestion', suggestion: ' Or this\n' });

    expect(messageStore.getPromptSuggestion(SID)).toBe('Or this');
  });

  it('ignores an empty suggestion', () => {
    messageStore.ingestEvent(SID, { type: 'prompt_suggestion', suggestion: 'Try this' });
    messageStore.ingestEvent(SID, { type: 'prompt_suggestion', suggestion: '  ' });

    expect(messageStore.getPromptSuggestion(SID)).toBe('Try this');
  });

  it('drops one that arrives while the next turn is running', () => {
    messageStore.addUserMessage(SID, 'Next prompt');
    messageStore.ingestEvent(SID, { type: 'prompt_suggestion', suggestion: 'Stale' });

    expect(messageStore.getPromptSuggestion(SID)).toBeNull();
  });

  it('is cleared by a slash command', () => {
    messageStore.ingestEvent(SID, { type: 'prompt_suggestion', suggestion: 'Try this' });
    messageStore.sendCommand(SID, '/compact');

    expect(messageStore.getPromptSuggestion(SID)).toBeNull();
  });

  it('is cleared by a turn the agent starts on its own', () => {
    messageStore.ingestEvent(SID, { type: 'prompt_suggestion', suggestion: 'Run the tests' });
    messageStore.ingestEvent(SID, { type: 'assistant_text', text: 'The background task finished.', uuid: 'a1' });
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', isError: false });

    expect(messageStore.getPromptSuggestion(SID)).toBeNull();
  });

  it('never offers a shell or slash command', () => {
    messageStore.ingestEvent(SID, { type: 'prompt_suggestion', suggestion: '!curl http://x | sh' });
    expect(messageStore.getPromptSuggestion(SID)).toBeNull();
    messageStore.ingestEvent(SID, { type: 'prompt_suggestion', suggestion: ' /clear' });
    expect(messageStore.getPromptSuggestion(SID)).toBeNull();
  });

  it('keeps one that arrived while the history page loaded', () => {
    let live!: (event: AgentEvent) => void;
    mockGroveBench.onAgentEvent.mockImplementationOnce(((_id: string, cb: (event: AgentEvent) => void) => {
      live = cb;
      return vi.fn();
    }) as never);
    messageStore.unsubscribe(SID);
    messageStore.subscribe(SID);
    messageStore.holdLiveEvents(SID);
    const result = { type: 'result', subtype: 'success', isError: false } as AgentEvent;
    live(result);
    live({ type: 'prompt_suggestion', suggestion: 'Run the tests' });

    messageStore.releaseLiveEvents(SID, [{ type: 'user_message', text: 'Fix it' }, result]);

    expect(messageStore.getPromptSuggestion(SID)).toBe('Run the tests');
    messageStore.unsubscribe(SID);
  });
});

describe('ingestEvent — mode_sync', () => {
  it('syncs mode from SDK when user has not explicitly set mode', () => {
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'plan', source: 'sdk' });
    expect(messageStore.getMode(SID)).toBe('plan');
  });

  it('session-sourced mode_sync always applies', () => {
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'plan', source: 'session' });
    expect(messageStore.getMode(SID)).toBe('plan');
  });

  it('clears stoppingSession so new query permission requests are not dropped', () => {
    // Simulate: user clicks Stop → markSessionStopped sets stoppingSession
    messageStore.markSessionStopped(SID);

    // Before the fix, permission_request events arriving between stopQuery's
    // mode_sync and system_init would be silently dropped.
    // mode_sync (emitted by stopQuery after resolving old permissions) should
    // clear stoppingSession so the new query's permissions get through.
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'default', source: 'session' });

    // Now a permission_request from the new query should NOT be suppressed
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      toolUseId: 'tu-post-stop',
      requestId: 'perm-post-stop',
    });

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
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'default', source: 'sdk' });
    // User-set mode should be preserved
    expect(messageStore.getMode(SID)).toBe('acceptEdits');
  });

  it('does not let SDK mode_sync overwrite user-set plan', () => {
    messageStore.setMode(SID, 'plan');
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'default', source: 'sdk' });
    expect(messageStore.getMode(SID)).toBe('plan');
  });

  it('session-sourced mode_sync overrides user-explicit mode', () => {
    messageStore.setMode(SID, 'acceptEdits');
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'default', source: 'session' });
    expect(messageStore.getMode(SID)).toBe('default');
  });

  it('allows SDK mode_sync when user has not explicitly changed mode', () => {
    messageStore.modeBySession[SID] = 'default';
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'plan', source: 'sdk' });
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
    });

    const msgs = messageStore.getMessages(SID);
    const perms = msgs.filter((m) => m.kind === 'permission');
    expect(perms).toHaveLength(0);
  });

  it('clears stoppingSession so new query permission requests are not dropped', () => {
    // Simulate: user clicks Stop → markSessionStopped sets stoppingSession
    messageStore.markSessionStopped(SID);

    // mode_sync (emitted by stopQuery after resolving old permissions) should
    // clear stoppingSession so the new query's permissions get through.
    messageStore.ingestEvent(SID, { type: 'mode_sync', mode: 'default', source: 'session' });

    // Now a permission_request from the new query should NOT be suppressed
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      toolUseId: 'tu-post-stop',
      requestId: 'perm-post-stop',
    });

    const msgs = messageStore.getMessages(SID);
    const perm = msgs.find((m) => m.kind === 'permission');
    expect(perm).toBeDefined();
    expect((perm as any).requestId).toBe('perm-post-stop');
  });
});

describe('ingestEvent — limits', () => {
  const request = (requestId: string): AgentEvent => ({
    type: 'limit_request', requestId, limit: 'turnToolCalls', used: 100, reachedAt: 100, nextAllowance: 200,
  });

  it('shows a reached limit as waiting on the user, and notifies', () => {
    sessionStore.sessions = [{ id: SID, branch: 'b', repoPath: '/r', status: 'running' }] as any;
    messageStore.ingestEvent(SID, request('lim-1'));
    const msg = messageStore.getMessages(SID).find((m) => m.kind === 'limit');
    expect(msg).toMatchObject({ kind: 'limit', requestId: 'lim-1', limit: 'turnToolCalls', used: 100, resolved: false });
    expect(messageStore.needsInput(SID)).toBe(true);
    expect(mockGroveBench.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'permission_request', body: 'Paused at your tool call limit' }));
  });

  it('marks it continued, and the thread no longer waits', () => {
    messageStore.ingestEvent(SID, request('lim-2'));
    messageStore.ingestEvent(SID, { type: 'limit_resolved', requestId: 'lim-2', limit: 'turnToolCalls', decision: 'continue', allowance: 200 });
    expect(messageStore.getMessages(SID).find((m) => m.kind === 'limit')).toMatchObject({ resolved: true, decision: 'continue' });
    expect(messageStore.needsInput(SID)).toBe(false);
  });

  it('treats a stop at a limit like Stop: queued prompts wait for Resume', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.queuedBySession = { [SID]: [{ id: 'q1', displayText: 'next', outgoing: 'next' }] };
    messageStore.ingestEvent(SID, request('lim-3'));
    messageStore.ingestEvent(SID, { type: 'limit_resolved', requestId: 'lim-3', limit: 'turnToolCalls', decision: 'stop', reason: 'timeout' });
    expect(messageStore.getMessages(SID).find((m) => m.kind === 'limit')).toMatchObject({ resolved: true, decision: 'stop', timedOut: true });
    expect(messageStore.getIsRunning(SID)).toBe(false);
    expect(messageStore.isQueuePaused(SID)).toBe(true);
  });

  it('closes the question when main says it already ended', async () => {
    messageStore.ingestEvent(SID, request('lim-4'));
    mockGroveBench.respondToLimit.mockResolvedValueOnce(false);
    await messageStore.respondToLimit(SID, 'lim-4', 'continue');
    expect(mockGroveBench.respondToLimit).toHaveBeenCalledWith(SID, 'lim-4', 'continue');
    expect(messageStore.getMessages(SID).find((m) => m.kind === 'limit')).toMatchObject({ resolved: true, decision: 'stop' });
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
    });

    messageStore.ingestEvent(SID, {
      type: 'permission_resolved',
      requestId: 'req-pr',
      toolUseId: 'tu-pr',
      decision: 'allow',
    });

    const msgs = messageStore.getMessages(SID);
    const perm = msgs.find((m) => m.kind === 'permission') as any;
    expect(perm.resolved).toBe(true);
    expect(perm.decision).toBe('allow');
  });

  it('marks a permission denied by the timeout as timed out', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'tu-to',
      requestId: 'req-to',
    });
    messageStore.ingestEvent(SID, {
      type: 'permission_resolved',
      requestId: 'req-to',
      toolUseId: 'tu-to',
      decision: 'deny',
      reason: 'timeout',
    });

    const perm = messageStore.getMessages(SID).find((m) => m.kind === 'permission' && m.requestId === 'req-to') as any;
    expect(perm).toMatchObject({ resolved: true, decision: 'deny', timedOut: true });
  });

  it('marks a question closed by the timeout as timed out, with no answer', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'AskUserQuestion',
      toolInput: { questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A' }], multiSelect: false }] },
      toolUseId: 'tu-qt',
      requestId: 'req-qt',
      toolCategory: 'question',
    });
    messageStore.ingestEvent(SID, {
      type: 'permission_resolved',
      requestId: 'req-qt',
      toolUseId: 'tu-qt',
      decision: 'deny',
      reason: 'timeout',
    });

    const q = messageStore.getMessages(SID).find((m) => m.kind === 'question' && m.requestId === 'req-qt') as any;
    expect(q).toMatchObject({ resolved: true, timedOut: true });
    expect(q.response).toBeUndefined();
  });

  it('stores the answer from a replayed question resolution', () => {
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'AskUserQuestion',
      toolInput: { questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] },
      toolUseId: 'tu-q',
      requestId: 'req-q',
      toolCategory: 'question',
    });

    messageStore.ingestEvent(SID, {
      type: 'permission_resolved',
      requestId: 'req-q',
      toolUseId: 'tu-q',
      decision: 'deny',
      message: 'B',
    });

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
    });

    // Set awaitingPermission via permission_request
    messageStore.ingestEvent(SID, {
      type: 'permission_request',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'tu-await',
      requestId: 'req-await',
    });

    // Resolve it
    messageStore.ingestEvent(SID, {
      type: 'permission_resolved',
      requestId: 'req-await',
      toolUseId: 'tu-await',
      decision: 'allow',
    });

    const msgs = messageStore.getMessages(SID);
    const tc = msgs.find((m) => m.kind === 'tool_call') as any;
    expect(tc.awaitingPermission).toBe(false);
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
    });

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
    });

    const msgs = messageStore.getMessages(SID);
    const perm = msgs.find((m) => m.kind === 'permission') as any;
    expect(perm).toBeDefined();
    expect(perm.isPlanExecution).toBeFalsy();
  });
});

describe('ingestEvent — error/process_exit unlocks input when never initialized', () => {
  it('error unlocks input if session never had system_init', () => {
    expect(messageStore.getIsReady(SID)).toBe(false);
    messageStore.ingestEvent(SID, { type: 'error', message: 'Auth failed' });
    expect(messageStore.getIsReady(SID)).toBe(true);
    expect(messageStore.getIsRunning(SID)).toBe(false);
  });

  it('keeps a sign-in failure marked as one, and re-checks credentials when a key was refused', () => {
    mockGroveBench.checkPrerequisites.mockClear();
    messageStore.ingestEvent(SID, { type: 'error', message: 'Sign in again', auth: true, keyRejected: true });
    const last = messageStore.getMessages(SID).at(-1);
    expect(last).toMatchObject({ kind: 'error', text: 'Sign in again', auth: true });
    expect(mockGroveBench.checkPrerequisites).toHaveBeenCalled();
  });

  it('does not re-check credentials when an old refusal is replayed', () => {
    mockGroveBench.checkPrerequisites.mockClear();
    messageStore.replayEvents(SID, [{ type: 'error', message: 'Sign in again', auth: true, keyRejected: true }]);
    expect(messageStore.getMessages(SID).at(-1)).toMatchObject({ kind: 'error', auth: true });
    expect(mockGroveBench.checkPrerequisites).not.toHaveBeenCalled();
  });

  it('does not re-check credentials for other errors', () => {
    mockGroveBench.checkPrerequisites.mockClear();
    messageStore.ingestEvent(SID, { type: 'error', message: 'boom' });
    expect(messageStore.getMessages(SID).at(-1)).not.toHaveProperty('auth');
    expect(mockGroveBench.checkPrerequisites).not.toHaveBeenCalled();
  });

  it('process_exit unlocks input if session never had system_init', () => {
    expect(messageStore.getIsReady(SID)).toBe(false);
    messageStore.ingestEvent(SID, { type: 'process_exit' });
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
    });

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
    });

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
    });

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
    });

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

  it('clears the prompt suggestion on new message', () => {
    messageStore.promptSuggestionBySession[SID] = 'old suggestion';
    messageStore.addUserMessage(SID, 'New prompt');
    expect(messageStore.getPromptSuggestion(SID)).toBeNull();
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
    });

    messageStore.markSessionStopped(SID);

    const tc = messageStore.getMessages(SID)[0] as any;
    expect(tc.pending).toBe(false);
  });
});

describe('cycleMode', () => {
  it('before the agent declares its modes, cycles only the ones every agent offers', () => {
    messageStore.modeBySession[SID] = 'default';
    messageStore.cycleMode(SID);
    expect(messageStore.getMode(SID)).toBe('acceptEdits');

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

  /** The thread's agent offers these permission modes. */
  function modes(...values: string[]) {
    messageStore.controlsBySession[SID] = {
      descriptors: [{ id: CONTROL_IDS.permissionMode, label: 'Mode', default: 'default', options: values.map((value) => ({ value, label: value })) }],
      values: {},
    };
  }

  it('syncs mode on /plan command', () => {
    modes('default', 'plan', 'acceptEdits');
    messageStore.sendCommand(SID, '/plan');
    expect(messageStore.getMode(SID)).toBe('plan');
  });

  it('syncs mode on /code command', () => {
    modes('default', 'plan', 'acceptEdits');
    messageStore.modeBySession[SID] = 'plan';
    messageStore.sendCommand(SID, '/code');
    expect(messageStore.getMode(SID)).toBe('default');
  });

  it('syncs mode on /plan before the controls have loaded', () => {
    messageStore.sendCommand(SID, '/plan');
    expect(messageStore.getMode(SID)).toBe('plan');
  });

  it("leaves the mode alone for an agent without Plan mode, which takes /plan as text", () => {
    modes('default', 'acceptEdits', 'readSafe');
    messageStore.modeBySession[SID] = 'acceptEdits';
    messageStore.sendCommand(SID, '/plan');
    expect(messageStore.getMode(SID)).toBe('acceptEdits');
    messageStore.sendCommand(SID, '/code');
    expect(messageStore.getMode(SID)).toBe('acceptEdits');
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, '/plan');
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

describe('applyTurnState (main says how a replayed history ends)', () => {
  const midTurn: AgentEvent[] = [
    { type: 'user_message', text: 'Run the tests', uuid: 'u1' },
    { type: 'assistant_tool_use', toolName: 'Bash', toolInput: { command: 'npm test' }, toolUseId: 'tu-1', uuid: 'a1' },
  ];
  const asks: AgentEvent[] = [
    ...midTurn,
    { type: 'permission_request', toolName: 'Bash', toolInput: { command: 'npm test' }, toolUseId: 'tu-1', requestId: 'perm-1' },
    {
      type: 'permission_request', toolName: 'AskUserQuestion', toolInput: {}, toolUseId: 'tu-2', requestId: 'perm-2', toolCategory: 'question',
      toolView: { kind: 'question', questions: [{ question: 'Ship it?', options: [{ label: 'Yes' }] }] },
    },
    { type: 'elicitation_request', requestId: 'elicit-1', request: { serverName: 'deploy', message: 'Which env?', mode: 'form', requestedSchema: { type: 'object' } } },
    { type: 'limit_request', requestId: 'limit-1', limit: 'turnToolCalls', used: 100, reachedAt: 100, nextAllowance: 200 },
  ];
  const byKind = (kind: string) => messageStore.getMessages(SID).find((m) => m.kind === kind) as any;

  it('shows a history cut off mid-turn as not running when main has no turn', () => {
    messageStore.replayEvents(SID, midTurn);
    expect(messageStore.getIsRunning(SID)).toBe(true);

    messageStore.applyTurnState(SID, IDLE_TURN, false);

    expect(messageStore.getIsRunning(SID)).toBe(false);
    expect(messageStore.getActivity(SID).activity).toBe('idle');
    expect(byKind('tool_call').pending).toBe(false);
  });

  it('keeps it running when main says the turn is', () => {
    messageStore.replayEvents(SID, [...midTurn, { type: 'process_exit' }, { type: 'user_message', text: 'Again', uuid: 'u2' }]);
    expect(messageStore.getIsRunning(SID)).toBe(false);

    messageStore.applyTurnState(SID, { midTurn: true, pendingPromptIds: [], agentLive: true }, false);

    expect(messageStore.getIsRunning(SID)).toBe(true);
  });

  it('settles the prompts main no longer waits on, and leaves open the ones it does', () => {
    messageStore.replayEvents(SID, asks);

    messageStore.applyTurnState(SID, { midTurn: true, pendingPromptIds: ['perm-1', 'elicit-1'], agentLive: true }, false);

    expect(byKind('permission')).toMatchObject({ requestId: 'perm-1', resolved: false });
    expect(byKind('tool_call')).toMatchObject({ toolUseId: 'tu-1', awaitingPermission: true });
    expect(byKind('question')).toMatchObject({ requestId: 'perm-2', resolved: true });
    expect(byKind('elicitation')).toMatchObject({ requestId: 'elicit-1', resolved: false });
    expect(byKind('limit')).toMatchObject({ requestId: 'limit-1', resolved: true, decision: 'stop' });
    expect(messageStore.needsInput(SID)).toBe(true);
  });

  it('settles them all for a thread main holds nothing for, even one it says is running', () => {
    messageStore.replayEvents(SID, asks);

    messageStore.applyTurnState(SID, { midTurn: true, pendingPromptIds: [], agentLive: true }, false);

    expect(byKind('permission')).toMatchObject({ resolved: true, decision: 'deny' });
    expect(byKind('tool_call').awaitingPermission).toBe(false);
    expect(byKind('elicitation')).toMatchObject({ resolved: true, action: 'cancel' });
    expect(messageStore.needsInput(SID)).toBe(false);
  });

  it('stays working on a prompt sent before the history loaded, past the old turns it replays', () => {
    messageStore.addUserMessage(SID, 'Add a test');
    messageStore.clearSession(SID);
    expect(messageStore.isAwaitingResponse(SID)).toBe(true);
    messageStore.replayEvents(SID, [...midTurn, { type: 'result', subtype: 'success', isError: false }]);

    messageStore.applyTurnState(SID, IDLE_TURN, true);

    expect(messageStore.getIsRunning(SID)).toBe(true);
    // Still waiting on the reply: the agent connecting doesn't end it.
    messageStore.ingestEvent(SID, { type: 'system_init', sessionId: 'p', model: 'm', tools: [] });
    expect(messageStore.getIsRunning(SID)).toBe(true);
  });

  it('forgets a prompt still waiting once its pane closes', () => {
    messageStore.addUserMessage(SID, 'Add a test');
    messageStore.dropAwaitingResponse(SID);
    expect(messageStore.isAwaitingResponse(SID)).toBe(false);
  });

  const call = (toolUseId: string) => messageStore.getMessages(SID).find((m) => m.kind === 'tool_call' && m.toolUseId === toolUseId) as any;
  const later: AgentEvent[] = [
    { type: 'user_message', text: 'Again', uuid: 'u2' },
    { type: 'assistant_tool_use', toolName: 'Bash', toolInput: { command: 'npm test' }, toolUseId: 'tu-2', uuid: 'a2' },
  ];

  // The agent exited (or the app quit) during tu-1: nothing answered it.
  it('settles a tool call an earlier turn left cut off, though main says a later turn is running', () => {
    messageStore.replayEvents(SID, [...midTurn, { type: 'process_exit' }, ...later]);

    messageStore.applyTurnState(SID, { midTurn: true, pendingPromptIds: [], agentLive: true }, false);

    expect(call('tu-1').pending).toBe(false);
    expect(call('tu-2').pending).toBe(true);
  });

  it('settles one a turn ended without answering, but not a background subagent\'s, which works on', () => {
    messageStore.replayEvents(SID, [
      ...midTurn,
      { type: 'assistant_tool_use', toolName: 'Agent', toolInput: { prompt: 'watch the build' }, toolUseId: 'tu-agent', uuid: 'a3' },
      { type: 'task_started', taskId: 'bg-1', toolUseId: 'tu-agent', description: 'watch the build' },
      { type: 'tool_result', toolUseId: 'tu-agent', content: 'Started in the background' },
      { type: 'assistant_tool_use', toolName: 'Bash', toolInput: { command: 'npm run build' }, toolUseId: 'tu-sub', uuid: 'a4', parentToolUseId: 'tu-agent' },
      { type: 'result', subtype: 'error_during_execution', isError: true },
      ...later,
    ]);

    messageStore.applyTurnState(SID, { midTurn: true, pendingPromptIds: [], agentLive: true }, false);

    expect(call('tu-1').pending).toBe(false);
    expect(call('tu-sub').pending).toBe(true);
    expect(call('tu-2').pending).toBe(true);
  });
});

describe('stillAwaitingResponse (a prompt waiting, against the page a pane loaded)', () => {
  const prompt = (uuid: string, text = 'Run the tests'): AgentEvent => ({ type: 'user_message', text, uuid });
  const reply: AgentEvent = { type: 'assistant_text', text: 'Done', uuid: 'r' };
  const done: AgentEvent = { type: 'result', subtype: 'success', isError: false };

  /** What the chat showed (`shown`), then a prompt sent; the pane reloads. */
  function sendThenReload(shown: AgentEvent[]) {
    messageStore.replayEvents(SID, shown);
    messageStore.addUserMessage(SID, 'And the linter');
    const before = messageStore.pendingPrompt(SID);
    messageStore.clearSession(SID);
    return before;
  }

  it('waits while main has not logged the prompt, past the older turns the page ends', () => {
    const before = sendThenReload([prompt('u1'), done]);
    expect(before).toEqual({ after: 'u1', nth: 1 });
    expect(messageStore.stillAwaitingResponse(SID, before, [prompt('u1'), done])).toBe(true);
  });

  it('waits while the prompt\'s turn runs in the page', () => {
    const before = sendThenReload([prompt('u1'), done]);
    expect(messageStore.stillAwaitingResponse(SID, before, [prompt('u1'), done, prompt('u2', 'And the linter'), reply])).toBe(true);
  });

  it('does not wait once the page holds the end of the prompt\'s turn', () => {
    const before = sendThenReload([prompt('u1'), done]);
    expect(messageStore.stillAwaitingResponse(SID, before, [prompt('u1'), done, prompt('u2', 'And the linter'), reply, done])).toBe(false);
    // An exit ends it too.
    expect(messageStore.stillAwaitingResponse(SID, before, [prompt('u1'), done, prompt('u2', 'And the linter'), { type: 'process_exit' }])).toBe(false);
  });

  it('finds a prompt main echoed by its uuid', () => {
    messageStore.replayEvents(SID, [prompt('u1'), done]);
    messageStore.addUserMessage(SID, 'And the linter');
    // Echoed before the reload: the chat has its uuid.
    messageStore.ingestEvent(SID, prompt('u2', 'And the linter'));
    const before = messageStore.pendingPrompt(SID);
    messageStore.clearSession(SID);

    expect(before).toEqual({ after: 'u2', nth: 0 });
    expect(messageStore.stillAwaitingResponse(SID, before, [prompt('u1'), done, prompt('u2'), reply])).toBe(true);
    expect(messageStore.stillAwaitingResponse(SID, before, [prompt('u1'), done, prompt('u2'), reply, done])).toBe(false);
  });

  it('does not wait on a new thread\'s first prompt that main answered before the page', () => {
    messageStore.addUserMessage(SID, 'Add a test');
    const before = messageStore.pendingPrompt(SID);
    messageStore.clearSession(SID);
    expect(before).toEqual({ after: null, nth: 1 });
    expect(messageStore.stillAwaitingResponse(SID, before, [{ type: 'status', message: 'Creating worktree…' }])).toBe(true);
    expect(messageStore.stillAwaitingResponse(SID, before, [prompt('u1', 'Add a test'), reply, done])).toBe(false);
  });

  it('waits on a prompt sent while the page loaded: main read the page first', () => {
    const before = sendThenReload([prompt('u1'), done]);
    messageStore.addUserMessage(SID, 'And the tests');
    expect(messageStore.stillAwaitingResponse(SID, before, [prompt('u1'), done, prompt('u2', 'And the linter'), reply, done])).toBe(true);
  });

  it('is false with nothing waiting', () => {
    messageStore.replayEvents(SID, [prompt('u1'), done]);
    expect(messageStore.pendingPrompt(SID)).toBeNull();
    expect(messageStore.stillAwaitingResponse(SID, null, [prompt('u1'), done])).toBe(false);
  });
});

describe('settlePrompts (one way to settle unanswered prompts, for every caller)', () => {
  const ev = (e: Record<string, unknown>) => e as unknown as AgentEvent;
  const asks: AgentEvent[] = [
    ev({ type: 'user_message', text: 'Ship it', uuid: 'u1' }),
    ev({ type: 'assistant_tool_use', toolName: 'Bash', toolInput: { command: 'npm test' }, toolUseId: 'tu-1', uuid: 'a1' }),
    ev({ type: 'permission_request', toolName: 'Bash', toolInput: { command: 'npm test' }, toolUseId: 'tu-1', requestId: 'perm-1' }),
    ev({
      type: 'permission_request', toolName: 'AskUserQuestion', toolInput: {}, toolUseId: 'tu-2', requestId: 'perm-2', toolCategory: 'question',
      toolView: { kind: 'question', questions: [{ question: 'Ship it?', options: [{ label: 'Yes' }] }] },
    }),
    ev({ type: 'elicitation_request', requestId: 'elicit-1', request: { serverName: 'deploy', message: 'Which env?', mode: 'form', requestedSchema: { type: 'object' } } }),
    ev({ type: 'limit_request', requestId: 'limit-1', limit: 'turnToolCalls', used: 100, reachedAt: 100, nextAllowance: 200 }),
  ];
  /** How each message ended up, without its generated id. */
  const outcome = (msgs: readonly unknown[]) => msgs.map((m) => {
    const { kind, resolved, decision, action, pending, awaitingPermission } = m as Record<string, unknown>;
    return { kind, resolved, decision, action, pending, awaitingPermission };
  });

  it('settles a stopped thread, a reloaded one and an older page alike', async () => {
    messageStore.replayEvents(SID, asks);
    messageStore.markSessionStopped(SID);
    const stopped = outcome(messageStore.getMessages(SID));
    messageStore.destroySession(SID);

    messageStore.replayEvents(SID, asks);
    messageStore.applyTurnState(SID, IDLE_TURN, false);
    const reloaded = outcome(messageStore.getMessages(SID));
    messageStore.destroySession(SID);

    // An older page, with a newer prompt loaded after it.
    messageStore.replayEvents(SID, [ev({ type: 'user_message', text: 'Next', uuid: 'u9' })], undefined, 200);
    messageStore.setPagination(SID, 201, 200);
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({ events: asks, totalCount: 201, startIndex: 0, turn: IDLE_TURN });
    await messageStore.loadOlderEvents(SID);
    const older = outcome(messageStore.getMessages(SID).slice(0, -1));

    expect(reloaded).toEqual(stopped);
    expect(older).toEqual(stopped);
    expect(stopped).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'permission', resolved: true, decision: 'deny' }),
      expect.objectContaining({ kind: 'question', resolved: true }),
      expect.objectContaining({ kind: 'elicitation', resolved: true, action: 'cancel' }),
      expect.objectContaining({ kind: 'limit', resolved: true, decision: 'stop' }),
      expect.objectContaining({ kind: 'tool_call', pending: false, awaitingPermission: false }),
    ]));
  });

  it('keeps open in an older page the prompts main still waits on', async () => {
    messageStore.replayEvents(SID, [ev({ type: 'user_message', text: 'Next', uuid: 'u9' })], undefined, 200);
    messageStore.setPagination(SID, 201, 200);
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({
      events: asks, totalCount: 201, startIndex: 0, turn: { midTurn: true, pendingPromptIds: ['perm-1', 'limit-1'], agentLive: true },
    });

    await messageStore.loadOlderEvents(SID);

    const msgs = messageStore.getMessages(SID) as any[];
    expect(msgs.find((m) => m.kind === 'permission')).toMatchObject({ requestId: 'perm-1', resolved: false });
    expect(msgs.find((m) => m.kind === 'tool_call')).toMatchObject({ toolUseId: 'tu-1', awaitingPermission: true });
    expect(msgs.find((m) => m.kind === 'limit')).toMatchObject({ resolved: false });
    expect(msgs.find((m) => m.kind === 'question')).toMatchObject({ resolved: true });
    expect(msgs.find((m) => m.kind === 'elicitation')).toMatchObject({ resolved: true, action: 'cancel' });
  });

  it('returns the same list when there is nothing to settle', () => {
    messageStore.replayEvents(SID, [ev({ type: 'user_message', text: 'Hi', uuid: 'u1' })]);
    const msgs = messageStore.getMessages(SID);
    expect(settlePrompts(msgs)).toBe(msgs);
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
    expect(u).toEqual({ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });
});

describe('session controls', () => {
  const descriptors = [
    { id: 'permissionMode', label: 'Mode', default: 'default', options: [{ value: 'default', label: 'Ask' }, { value: 'plan', label: 'Plan' }] },
    { id: 'thinking', label: 'Thinking', default: 'high', options: [{ value: 'off', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] },
  ];

  it('controls_sync installs the descriptors and values for the session', () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: { thinking: 'low' } });

    expect(messageStore.getControlDescriptors(SID).map((d) => d.id)).toEqual(['permissionMode', 'thinking']);
    expect(messageStore.getControlValue(SID, 'thinking')).toBe('low');
  });

  it('getControlValue falls back to the descriptor default, and reads permissionMode from the mode store', () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: {} });
    messageStore.modeBySession[SID] = 'plan';

    expect(messageStore.getControlValue(SID, 'thinking')).toBe('high');
    expect(messageStore.getControlValue(SID, 'permissionMode')).toBe('plan');
    expect(messageStore.getControlValue('unknown', 'thinking')).toBe('');
  });

  it('setControl reflects the value immediately and forwards it over IPC', async () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: { thinking: 'high' } });

    const pending = messageStore.setControl(SID, 'thinking', 'low');
    expect(messageStore.getControlValue(SID, 'thinking')).toBe('low');
    await pending;

    expect(mockGroveBench.setControl).toHaveBeenCalledWith(SID, 'thinking', 'low');
  });

  it('setControl rolls back when main rejects the value', async () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: { thinking: 'high' } });
    mockGroveBench.setControl.mockRejectedValueOnce(new Error('not offered on this model'));

    await messageStore.setControl(SID, 'thinking', 'low');

    expect(messageStore.getControlValue(SID, 'thinking')).toBe('high');
  });

  it('setControl on permissionMode routes through setMode', async () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: {} });

    await messageStore.setControl(SID, 'permissionMode', 'plan');

    expect(messageStore.getMode(SID)).toBe('plan');
    expect(mockGroveBench.setMode).toHaveBeenCalledWith(SID, 'plan');
    expect(mockGroveBench.setControl).not.toHaveBeenCalled();
  });

  it('cycleControl walks the declared options in order and wraps', () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: { thinking: 'off' } });

    for (const expected of ['low', 'high', 'off']) {
      messageStore.cycleControl(SID, 'thinking');
      expect(messageStore.getControlValue(SID, 'thinking')).toBe(expected);
    }
  });

  it('cycleMode uses the declared mode options instead of the built-in list', () => {
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: {} });
    messageStore.modeBySession[SID] = 'plan';

    messageStore.cycleMode(SID);

    // Declared list is [default, plan] — so plan wraps to default, not acceptEdits
    expect(messageStore.getMode(SID)).toBe('default');
  });

  it('cycleControl reaches a control that stands in for a well-known one (Alt+E on an ACP agent)', () => {
    const acp = [{ id: 'acp:effort', label: 'Effort', role: 'effort', default: 'low', options: [
      { value: 'low', label: 'Low' }, { value: 'high', label: 'High' },
    ] }];
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors: acp, values: { 'acp:effort': 'low' } } as AgentEvent);

    messageStore.cycleControl(SID, 'effort');

    expect(mockGroveBench.setControl).toHaveBeenCalledWith(SID, 'acp:effort', 'high');
  });

  it('cycleControl on permissionMode still works before any descriptors arrive', () => {
    messageStore.modeBySession[SID] = 'default';

    messageStore.cycleControl(SID, 'permissionMode');

    expect(messageStore.getMode(SID)).toBe('acceptEdits');
  });

  it('loadControls fetches once and keeps a controls_sync that landed mid-fetch', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    mockGroveBench.getControls.mockImplementationOnce(() => new Promise((r) => { resolveFetch = r; }));

    const loading = messageStore.loadControls(SID);
    messageStore.ingestEvent(SID, { type: 'controls_sync', descriptors, values: { thinking: 'low' } });
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
    });

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

  it('records servers for an agent that never reported them at startup', () => {
    messageStore.updateMcpServers('uninitialized', [{ name: 'docs', status: 'connected' }]);
    expect(messageStore.getSystemInfo('uninitialized')).toMatchObject({
      tools: [],
      mcpServers: [{ name: 'docs', status: 'connected' }],
    });
  });

  it('keeps the full live list until it is cleared, leaving the last known status', () => {
    const live = [{ name: 'search', status: 'connected' as const, toolCount: 1, tools: [{ name: 'find' }] }];
    messageStore.updateMcpServers(SID, live);
    expect(messageStore.getLiveMcpServers(SID)).toEqual(live);

    messageStore.clearLiveMcpServers(SID);
    expect(messageStore.getLiveMcpServers(SID)).toEqual([]);
    expect(messageStore.getSystemInfo(SID).mcpServers).toEqual([{ name: 'search', status: 'connected' }]);
  });
});

describe('ingestEvent — user_message UUID stamping', () => {
  it('shows a sent prompt at once with its time, then the time main logged', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 5_000 });
    try {
      messageStore.addUserMessage(SID, 'hi');
      expect((messageStore.getMessages(SID)[0] as ChatUserMessage).sentAt).toBe(5_000);

      messageStore.ingestEvent(SID, { type: 'user_message', text: 'hi', uuid: 'u1', at: 5_020 });
      expect((messageStore.getMessages(SID)[0] as ChatUserMessage).sentAt).toBe(5_020);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the time from history, and gives older history none', () => {
    messageStore.replayEvents(SID, [
      { type: 'user_message', text: 'old', uuid: 'u1' },
      { type: 'user_message', text: 'new', uuid: 'u2', at: 7_000 },
    ]);
    const [old, recent] = messageStore.getMessages(SID) as ChatUserMessage[];
    expect(old).not.toHaveProperty('sentAt');
    expect(recent.sentAt).toBe(7_000);
  });

  it('swaps just-sent images for the saved copies once main has saved them', () => {
    messageStore.addUserMessage(SID, 'look', [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AA' }]);
    const saved = [{ file: `${'a'.repeat(32)}.png`, name: 'shot.png' }];

    messageStore.ingestEvent(SID, { type: 'user_message', text: 'look', uuid: 'u-img', images: saved });

    const msg = messageStore.getMessages(SID)[0] as ChatUserMessage;
    expect(msg.uuid).toBe('u-img');
    expect(msg.images).toEqual(saved);
  });

  it('keeps the inline images when not all of them were saved', () => {
    const inline = [
      { name: 'a.png', dataUrl: 'data:image/png;base64,AA' },
      { name: 'b.png', dataUrl: 'data:image/png;base64,BB' },
    ];
    messageStore.addUserMessage(SID, 'look', inline);

    messageStore.ingestEvent(SID, {
      type: 'user_message', text: 'look', uuid: 'u-img', images: [{ file: `${'a'.repeat(32)}.png`, name: 'a.png' }],
    });

    expect((messageStore.getMessages(SID)[0] as ChatUserMessage).images).toEqual(inline);
  });

  it('swaps attached files shown by name for the ones main saved', () => {
    messageStore.addUserMessage(SID, 'read these', undefined, [
      { name: 'a.pdf', mediaType: 'application/pdf', size: 3 },
      { name: 'b.zip', mediaType: 'application/zip', size: 3 },
    ]);
    // b.zip could not be saved, so it drops off.
    const saved = [{ file: `${'a'.repeat(32)}.pdf`, name: 'a.pdf', mediaType: 'application/pdf', size: 3 }];

    messageStore.ingestEvent(SID, { type: 'user_message', text: 'read these', uuid: 'u-files', files: saved });

    expect((messageStore.getMessages(SID)[0] as ChatUserMessage).attachments).toEqual(saved);
  });

  it('stamps UUID onto the most recent UUID-less user message', () => {
    messageStore.addUserMessage(SID, 'first prompt');
    messageStore.addUserMessage(SID, 'second prompt');

    // SDK replays second user message with a UUID
    messageStore.ingestEvent(SID, {
      type: 'user_message',
      text: 'second prompt',
      uuid: 'uuid-replay-1',
    });

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
    });

    // Now second has a UUID, first still doesn't — next replay stamps first
    messageStore.ingestEvent(SID, {
      type: 'user_message',
      text: 'first',
      uuid: 'uuid-a',
    });

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
    });

    const msgs = messageStore.getMessages(SID);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('user');
    expect((msgs[0] as any).uuid).toBe('uuid-new');
  });

  it('shows a replayed message as it was displayed, with attached files split out of the text', () => {
    messageStore.replayEvents(SID, [
      { type: 'user_message', text: '<file path="notes.md">\nlong notes\n</file>\n<file path="src/a.ts">\nconst secret = 1;\n</file>\n\nfollow the notes for @src/a.ts', uuid: 'uuid-files' },
    ] as AgentEvent[]);

    const msgs = messageStore.getMessages(SID);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as ChatUserMessage;
    expect(msg.text).toBe('follow the notes for @src/a.ts');
    // The @-referenced file stays a reference in the text, not an attachment.
    expect(msg.files).toEqual([{ path: 'notes.md', content: 'long notes' }]);
    expect(msg.uuid).toBe('uuid-files');
    expect(userMessageLabel(msg)).toBe('[notes.md] follow the notes for @src/a.ts');
  });

  it('shows the images a replayed message was sent with', () => {
    messageStore.replayEvents(SID, [
      { type: 'user_message', text: 'what is wrong here?', uuid: 'uuid-img', images: [{ file: 'a'.repeat(32) + '.png', name: 'shot.png' }] },
    ] as AgentEvent[]);

    const msg = messageStore.getMessages(SID)[0] as ChatUserMessage;
    expect(msg.text).toBe('what is wrong here?');
    expect(msg.images).toEqual([{ file: 'a'.repeat(32) + '.png', name: 'shot.png' }]);
    expect(userMessageLabel(msg)).toBe('[shot.png] what is wrong here?');
  });

  it('shows the other files a replayed message was sent with', () => {
    const files = [{ file: 'a'.repeat(32) + '.pdf', name: 'spec.pdf', mediaType: 'application/pdf', size: 1200 }];
    messageStore.replayEvents(SID, [
      { type: 'user_message', text: 'summarise', uuid: 'uuid-pdf', images: [{ file: 'b'.repeat(32) + '.png', name: 'shot.png' }], files },
    ] as AgentEvent[]);

    const msg = messageStore.getMessages(SID)[0] as ChatUserMessage;
    expect(msg.attachments).toEqual(files);
    expect(userMessageLabel(msg)).toBe('[shot.png, spec.pdf] summarise');
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
    });

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
    });

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
    });

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
    });

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

  it('asks a showing prompt box to take the rewound text live, but not on replay', () => {
    messageStore.promptInsertBySession = {};
    messageStore.replayEvents(SID, [
      { type: 'user_message', text: 'first', uuid: 'cp-1' },
      { type: 'rewind', toMessageId: 'cp-1' },
    ] as AgentEvent[]);
    expect(messageStore.getDraft(SID)).toBe('first');
    expect(messageStore.promptInsertBySession[SID]).toBeUndefined();

    messageStore.ingestEvent(SID, { type: 'user_message', text: 'second', uuid: 'cp-2' });
    messageStore.ingestEvent(SID, { type: 'rewind', toMessageId: 'cp-2' });
    expect(messageStore.getDraft(SID)).toBe('second');
    expect(messageStore.promptInsertBySession[SID]).toMatchObject({ text: 'second', replace: true });
  });
});

describe('needsInput', () => {
  const ask = (type: 'permission' | 'question', requestId: string) => type === 'permission'
    ? { type: 'permission_request', toolName: 'Bash', toolInput: {}, toolUseId: `t-${requestId}`, requestId } as AgentEvent
    : { type: 'permission_request', toolName: 'AskUserQuestion', toolInput: { questions: [] }, toolUseId: `t-${requestId}`, requestId, toolCategory: 'question' } as AgentEvent;

  it('follows the conversation as prompts arrive and are answered', () => {
    expect(messageStore.needsInput(SID)).toBe(false);
    messageStore.ingestEvent(SID, ask('permission', 'r1'));
    expect(messageStore.hasPendingPermission(SID)).toBe(true);
    expect(messageStore.needsInput(SID)).toBe(true);

    messageStore.ingestEvent(SID, { type: 'permission_resolved', requestId: 'r1', toolUseId: 't-r1', decision: 'allow' });
    expect(messageStore.hasPendingPermission(SID)).toBe(false);
    expect(messageStore.needsInput(SID)).toBe(false);

    messageStore.ingestEvent(SID, ask('question', 'q1'));
    expect(messageStore.hasPendingQuestion(SID)).toBe(true);
    expect(messageStore.hasPendingPermission(SID)).toBe(false);
    messageStore.resolveQuestion(SID, 'q1', 'yes');
    expect(messageStore.needsInput(SID)).toBe(false);
  });

  it('updates a derived value that reads it', () => {
    const seen: boolean[] = [];
    const stop = $effect.root(() => {
      $effect(() => { seen.push(messageStore.needsInput(SID)); });
    });
    flushSync();
    messageStore.ingestEvent(SID, ask('permission', 'r2'));
    flushSync();
    messageStore.ingestEvent(SID, { type: 'permission_resolved', requestId: 'r2', toolUseId: 't-r2', decision: 'deny' });
    flushSync();
    stop();
    expect(seen).toEqual([false, true, false]);
  });
});

describe('resolveQuestion', () => {
  it('answers the open question when an older one has the same id', () => {
    const q = { kind: 'question', toolUseId: 't', questions: [], requestId: 'perm_s_1' };
    messageStore.messagesBySession[SID] = [
      { ...q, id: 'old', resolved: true, response: 'blue' },
      { ...q, id: 'new', resolved: false },
    ] as any;

    messageStore.resolveQuestion(SID, 'perm_s_1', 'green');

    const [older, newer] = messageStore.getMessages(SID) as any[];
    expect(older.response).toBe('blue');
    expect(newer).toMatchObject({ resolved: true, response: 'green' });
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

  it('lists attachment names before the text, as the thread used to show them', () => {
    messageStore.messagesBySession[SID] = [
      { kind: 'user', id: '1', text: 'fix it', uuid: 'cp-1', files: [{ path: 'a.ts', content: 'x' }], images: [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AA' }] },
    ] as any;

    expect(messageStore.getRewindPoints(SID)[0].text).toBe('[a.ts, shot.png] fix it');
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
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({ events: [], totalCount: 500, startIndex: 100, turn: IDLE_TURN });

    await messageStore.loadOlderUntil(SID, 150);

    // 300 > 150 → one load → loadedFromIndex 100 (<= 150) → stop
    expect(messageStore.olderEventCount(SID)).toBe(100);
    expect(mockGroveBench.getEventHistoryPage).toHaveBeenCalledTimes(1);
  });

  it('loads multiple pages when needed', async () => {
    messageStore.setPagination(SID, 500, 400);
    mockGroveBench.getEventHistoryPage
      .mockResolvedValueOnce({ events: [], totalCount: 500, startIndex: 200, turn: IDLE_TURN })
      .mockResolvedValueOnce({ events: [], totalCount: 500, startIndex: 0, turn: IDLE_TURN });

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
      turn: IDLE_TURN,
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
      turn: IDLE_TURN,
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
    messageStore.usageBySession[SID] = { inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 };
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
  const result: AgentEvent = { type: 'result', subtype: 'success', isError: false };
  const init: AgentEvent = { type: 'system_init', sessionId: 'p', model: 'm', tools: [] };

  it('sends immediately when the session is idle', () => {
    const outcome = messageStore.submitMessage(SID, { displayText: 'hi', outgoing: 'hi' });

    expect(outcome).toBe('sent');
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'hi', undefined, undefined);
    expect(messageStore.getQueue(SID)).toEqual([]);
    expect(messageStore.getIsRunning(SID)).toBe(true);
    expect(messageStore.getMessages(SID).map((m) => m.kind)).toEqual(['user']);
  });

  it('shows attached files as files and images as images, and sends the images', () => {
    const images = [{ data: 'iVBOR', mediaType: 'image/png' as const, name: 'shot.png' }];
    messageStore.submitMessage(SID, {
      displayText: '[notes.md, shot.png] look at this',
      outgoing: '<file path="notes.md" length="5">\nnotes\n</file>\n\nlook at this',
      images,
    });

    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, '<file path="notes.md" length="5">\nnotes\n</file>\n\nlook at this', images, undefined);
    const msg = messageStore.getMessages(SID)[0] as ChatUserMessage;
    expect(msg.text).toBe('look at this');
    expect(msg.files).toEqual([{ path: 'notes.md', content: 'notes' }]);
    expect(msg.images).toEqual([{ name: 'shot.png', dataUrl: 'data:image/png;base64,iVBOR' }]);
  });

  it('sends attached files and shows them by name until main saves them', () => {
    const files = [{ data: 'JVBERg==', mediaType: 'application/pdf', name: 'spec.pdf' }];
    messageStore.submitMessage(SID, { displayText: '[spec.pdf] summarise', outgoing: 'summarise', files });

    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'summarise', undefined, files);
    const msg = messageStore.getMessages(SID)[0] as ChatUserMessage;
    expect(msg.text).toBe('summarise');
    expect(msg.attachments).toEqual([{ name: 'spec.pdf', mediaType: 'application/pdf', size: 4 }]);
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
    expect(mockGroveBench.sendMessage).toHaveBeenLastCalledWith(SID, 'second', undefined, undefined);
    expect(messageStore.getQueue(SID).map((m) => m.displayText)).toEqual(['third']);
    // The new turn is running again, so the third waits
    expect(messageStore.getIsRunning(SID)).toBe(true);

    messageStore.ingestEvent(SID, result);

    expect(mockGroveBench.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockGroveBench.sendMessage).toHaveBeenLastCalledWith(SID, 'third', [{ data: 'x', mediaType: 'image/png', name: 'a.png' }], undefined);
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

    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'later', undefined, undefined);
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
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'b', undefined, undefined);
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

  it('editQueuedMessage hands back the prompt as typed, with its attachments', () => {
    messageStore.draftBySession = {};
    messageStore.setIsRunning(SID, true);
    const attachments = [{ type: 'image' as const, name: 'a.png', dataUrl: 'data:image/png;base64,AAAA' }];
    messageStore.submitMessage(SID, {
      displayText: '[a.png] look',
      outgoing: 'look',
      images: [{ data: 'AAAA', mediaType: 'image/png', name: 'a.png' }],
      typed: { text: 'look', attachments },
    });

    messageStore.editQueuedMessage(SID, messageStore.getQueue(SID)[0].id);

    expect(messageStore.promptInsertBySession[SID]).toMatchObject({ text: 'look', attachments });
    expect(messageStore.getDraft(SID)).toBe('look');
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
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'second', undefined, undefined);
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
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'correction', undefined, undefined);
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

    messageStore.ingestEvent(SID, { type: 'rewind', toMessageId: 'none', conversationOnly: true });

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

    messageStore.ingestEvent(SID, { type: 'error', message: 'boom' });
    messageStore.ingestEvent(SID, { type: 'process_exit' });

    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
    expect(messageStore.getQueue(SID)).toHaveLength(1);
    // ...but the item is sent once the resumed query connects idle
    messageStore.ingestEvent(SID, init);
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'second', undefined, undefined);
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

describe('findMessageForEvent', () => {
  it('finds a message that arrived live by its event\'s uuid', async () => {
    const id = 'search-live';
    messageStore.addUserMessage(id, 'live prompt');
    messageStore.ingestEvent(id, { type: 'user_message', text: 'live prompt', uuid: 'u-live' });
    messageStore.ingestEvent(id, { type: 'assistant_text', text: 'reply', uuid: 'a-live' });
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({
      events: [{ type: 'user_message', text: 'live prompt', uuid: 'u-live' }], totalCount: 8, startIndex: 7,
    } as never);

    const found = await messageStore.findMessageForEvent(id, 7);

    const target = messageStore.getMessages(id).find((m) => m.kind === 'user');
    expect(found).toBe(target!.id);
    expect(mockGroveBench.getEventHistoryPage).toHaveBeenCalledWith(id, 1, 8);
    // Stamped: the next lookup needs no fetch.
    expect(messageStore.getEventIndexForMessageId(id, target!.id)).toBe(7);
    messageStore.destroySession(id);
  });

  it("finds a turn's files that arrived live by their first file", async () => {
    const id = 'search-live-made';
    const made = (path: string) => ({ type: 'files_made', files: [{ path, kind: 'pdf', size: 1 }] }) as AgentEvent;
    messageStore.ingestEvent(id, made('one.pdf'));
    messageStore.ingestEvent(id, { type: 'assistant_text', text: 'between', uuid: 'a1' });
    messageStore.ingestEvent(id, made('two.pdf'));
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({ events: [made('one.pdf')], totalCount: 9, startIndex: 4 } as never);

    const found = await messageStore.findMessageForEvent(id, 4);

    const target = messageStore.getMessages(id).find((m) => m.kind === 'files_made' && m.files[0].path === 'one.pdf');
    expect(found).toBe(target!.id);
    messageStore.destroySession(id);
  });
});

describe('/clear that never happened', () => {
  it('does not wipe the chat at a later start, and puts a follow-up back in the prompt', () => {
    const id = 'clear-failed';
    messageStore.addUserMessage(id, 'keep me');
    messageStore.clearAndSend(id, 'then do this');

    // Main: not delivered.
    messageStore.ingestEvent(id, { type: 'error', message: 'Message not delivered' });
    messageStore.ingestEvent(id, { type: 'process_exit' });
    expect(messageStore.getDraft(id)).toContain('then do this');

    // Much later: a restart or wake.
    messageStore.ingestEvent(id, { type: 'system_init', model: 'opus', tools: [], sessionId: 'p1' } as unknown as AgentEvent);

    expect(messageStore.getMessages(id).some((m) => m.kind === 'user' && (m as { text: string }).text === 'keep me')).toBe(true);
    expect(mockGroveBench.clearEventHistory).not.toHaveBeenCalled();
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalledWith(id, 'then do this');
    messageStore.destroySession(id);
  });
});

describe('loadOlderEvents replays only messages', () => {
  const ID = 'older-page';
  const ev = (e: Record<string, unknown>) => e as unknown as AgentEvent;
  const init = (model: string) => ev({ type: 'system_init', sessionId: 'p', model, tools: [] });
  const user = (uuid: string, text: string) => ev({ type: 'user_message', text, uuid });
  const toolUse = (toolUseId: string) => ev({ type: 'assistant_tool_use', toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId, uuid: `a-${toolUseId}` });
  const toolResult = (toolUseId: string, content: string) => ev({ type: 'tool_result', toolUseId, content });
  const result = () => ev({ type: 'result', subtype: 'success', isError: false });

  function newerPage(events: AgentEvent[], startIndex: number) {
    messageStore.replayEvents(ID, events, undefined, startIndex);
    messageStore.setPagination(ID, startIndex + events.length, startIndex);
  }
  function olderPage(events: AgentEvent[], startIndex = 0) {
    mockGroveBench.getEventHistoryPage.mockResolvedValueOnce({ events, totalCount: 999, startIndex } as never);
  }
  const toolCall = (toolUseId: string) => messageStore.getMessages(ID).find((m) => m.kind === 'tool_call' && m.toolUseId === toolUseId) as
    { pending?: boolean; result?: string } | undefined;

  afterEach(() => messageStore.destroySession(ID));

  it('leaves an idle conversation idle, on its current mode and model', async () => {
    newerPage([init('opus-new'), ev({ type: 'mode_sync', mode: 'acceptEdits', source: 'session' }), user('u2', 'latest'), result()], 200);
    // The older page ends mid-turn, on an earlier mode and model.
    olderPage([init('old-model'), ev({ type: 'mode_sync', mode: 'plan', source: 'session' }), user('u1', 'earlier'), toolUse('t9')]);

    await messageStore.loadOlderEvents(ID);

    expect(messageStore.getIsRunning(ID)).toBe(false);
    expect(messageStore.getMode(ID)).toBe('acceptEdits');
    expect(messageStore.getModel(ID)).toBe('opus-new');
    const texts = messageStore.getMessages(ID).filter((m) => m.kind === 'user').map((m) => (m as { text: string }).text);
    expect(texts).toEqual(['earlier', 'latest']);
    // Cut off before the newer page began: not still running.
    expect(toolCall('t9')?.pending).toBe(false);
  });

  it('keeps a live permission prompt open', async () => {
    newerPage([init('opus'), user('u2', 'do it'), toolUse('t5')], 200);
    messageStore.ingestEvent(ID, ev({ type: 'permission_request', toolName: 'Bash', toolInput: {}, toolUseId: 't5', requestId: 'r5' }));
    expect(messageStore.needsInput(ID)).toBe(true);
    // The older page ends with a finished turn.
    olderPage([user('u1', 'before'), result()]);

    await messageStore.loadOlderEvents(ID);

    expect(messageStore.getIsRunning(ID)).toBe(true);
    expect(messageStore.needsInput(ID)).toBe(true);
  });

  it('gives a tool call in the older page its result from the newer page', async () => {
    // The newer page starts with the result of a call made just before it.
    newerPage([toolResult('t1', 'file-a\nfile-b'), result(), user('u2', 'next')], 200);
    olderPage([user('u1', 'list files'), toolUse('t1')]);

    await messageStore.loadOlderEvents(ID);

    expect(toolCall('t1')).toMatchObject({ pending: false, result: 'file-a\nfile-b' });
  });

  it('carries an unmatched result on to the page that holds its call', async () => {
    newerPage([toolResult('t1', 'done'), user('u3', 'next')], 400);
    olderPage([user('u2', 'middle')], 200);
    await messageStore.loadOlderEvents(ID, 200);
    olderPage([user('u1', 'first'), toolUse('t1')], 0);
    await messageStore.loadOlderEvents(ID, 200);

    expect(toolCall('t1')).toMatchObject({ result: 'done' });
  });

  it('answers a permission prompt in the older page as the newer page did', async () => {
    newerPage([ev({ type: 'permission_resolved', requestId: 'r1', toolUseId: 't1', decision: 'allow' }), toolResult('t1', 'ok'), result(), user('u2', 'next')], 200);
    olderPage([user('u1', 'go'), toolUse('t1'), ev({ type: 'permission_request', toolName: 'Bash', toolInput: {}, toolUseId: 't1', requestId: 'r1' })]);

    await messageStore.loadOlderEvents(ID);

    const perm = messageStore.getMessages(ID).find((m) => m.kind === 'permission') as { resolved?: boolean; decision?: string };
    expect(perm).toMatchObject({ resolved: true, decision: 'allow' });
  });

  it('drops a page that lands after the conversation was cleared', async () => {
    newerPage([user('u2', 'latest')], 200);
    let finish!: (v: unknown) => void;
    mockGroveBench.getEventHistoryPage.mockReturnValueOnce(new Promise((r) => { finish = r; }) as never);
    const loading = messageStore.loadOlderEvents(ID);
    messageStore.clearSession(ID);
    finish({ events: [user('u1', 'old')], totalCount: 999, startIndex: 0 });
    await loading;

    expect(messageStore.getMessages(ID)).toEqual([]);
  });
});

describe('rewind', () => {
  const ID = 'rewind-unloaded';
  const ev = (e: Record<string, unknown>) => e as unknown as AgentEvent;
  const user = (uuid: string, text: string) => ev({ type: 'user_message', text, uuid });

  afterEach(() => {
    messageStore.destroySession(ID);
    checkpointStore.checkpointsBySession = {};
  });

  it('to a message in a page not loaded yet, drops everything shown and loads the shorter history', async () => {
    messageStore.replayEvents(ID, [user('u5', 'fifth'), user('u6', 'sixth')], undefined, 200);
    messageStore.setPagination(ID, 202, 200);
    checkpointStore.checkpointsBySession = { [ID]: [{ uuid: 'u2', turn: 2, ref: 'r2', text: 'second prompt' }] };
    // Main cut the history to the 150 events before u2.
    mockGroveBench.getEventHistoryPage
      .mockResolvedValueOnce({ events: [], totalCount: 150, startIndex: 149 } as never)
      .mockResolvedValueOnce({ events: [user('u1', 'first')], totalCount: 150, startIndex: 0 } as never);

    messageStore.ingestEvent(ID, ev({ type: 'rewind', toMessageId: 'u2' }));

    await vi.waitFor(() => expect(messageStore.getMessages(ID).map((m) => (m as { text?: string }).text)).toEqual(['first']));
    expect(messageStore.getDraft(ID)).toBe('second prompt');
    expect(messageStore.hasOlderEvents(ID)).toBe(false);
  });

  it('conversation-only, while replaying history, keeps the edits of the turn it rewinds away', () => {
    messageStore.replayEvents(ID, [
      user('u1', 'edit it'),
      ev({ type: 'assistant_tool_use', toolName: 'Edit', toolInput: { file_path: 'a.ts', old_string: 'x', new_string: 'y' }, toolUseId: 't1', uuid: 'a1' }),
      ev({ type: 'tool_result', toolUseId: 't1', content: 'ok' }),
      ev({ type: 'result', subtype: 'success', isError: false }),
      user('u2', 'more'),
      ev({ type: 'rewind', toMessageId: 'u2', conversationOnly: true }),
    ]);

    expect(messageStore.preservedEditHistory[ID]?.map((f) => f.filePath)).toEqual(['a.ts']);
  });
});

describe('ingestEvent — tool views', () => {
  it('keeps the view an adapter attached to a tool call', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use', toolName: 'run_shell_command', toolInput: {}, toolUseId: 't1', uuid: 'u1',
      toolView: { kind: 'shell', command: 'npm test' },
    });
    const msg = messageStore.getMessages(SID).find((m) => m.kind === 'tool_call');
    expect(msg && msg.kind === 'tool_call' && msg.toolView).toEqual({ kind: 'shell', command: 'npm test' });
  });

  it('fills in a tool call and its permission prompt from tool_update', () => {
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use', toolName: 'edit', toolInput: {}, toolUseId: 't2', uuid: 'u2',
      toolView: { kind: 'edit', summary: 'Editing' },
    });
    messageStore.ingestEvent(SID, {
      type: 'permission_request', toolName: 'edit', toolInput: {}, toolUseId: 't2', requestId: 'r2', toolCategory: 'edit',
      toolView: { kind: 'edit', summary: 'Editing' },
    });
    const view = { kind: 'edit' as const, path: 'a.ts', edits: [{ oldText: 'a', newText: 'b' }] };
    messageStore.ingestEvent(SID, { type: 'tool_update', toolUseId: 't2', toolName: 'replace', toolView: view });
    const msgs = messageStore.getMessages(SID);
    const call = msgs.find((m) => m.kind === 'tool_call');
    const perm = msgs.find((m) => m.kind === 'permission');
    expect(call && call.kind === 'tool_call' && [call.toolName, call.toolView]).toEqual(['replace', view]);
    expect(perm && perm.kind === 'permission' && perm.toolView).toEqual(view);
  });

  it('lists edits from adapter views in the turn\'s file changes', () => {
    messageStore.ingestEvent(SID, { type: 'user_message', text: 'go' });
    messageStore.ingestEvent(SID, {
      type: 'assistant_tool_use', toolName: 'edit', toolInput: {}, toolUseId: 't3', uuid: 'u3',
      toolView: { kind: 'edit', path: '/w/a.ts', edits: [{ oldText: 'a', newText: 'b' }] },
    });
    messageStore.ingestEvent(SID, { type: 'tool_result', toolUseId: 't3', content: 'ok' });
    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', isError: false });
    expect(messageStore.getLastTurnFileChanges(SID).map((c) => c.filePath)).toEqual(['/w/a.ts']);
  });
});
