import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';

import { messageStore } from './messages.svelte.js';
import type { AgentEvent } from '../../shared/types.js';

const SID = 'test-session';

beforeEach(() => {
  vi.clearAllMocks();
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
  messageStore.devServersBySession = {};
  messageStore.rateLimitBySession = {};
  messageStore.promptSuggestionsBySession = {};
  messageStore.backgroundTasksBySession = {};
  messageStore.contextWindowBySession = {};
  messageStore.turnsBySession = {};
  messageStore.thinkingBySession = {};
  messageStore.rewindDialogOpen = {};
});

describe('ingestEvent — system_init', () => {
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

    expect(messageStore.getStreamingText(SID)).toBe('Hello world');
    expect(messageStore.getIsRunning(SID)).toBe(true);
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

describe('ingestEvent — rate_limit', () => {
  it('stores rate limit state', () => {
    messageStore.ingestEvent(SID, {
      type: 'rate_limit',
      status: 'allowed_warning',
      utilization: 0.85,
    } as AgentEvent);

    const rl = messageStore.getRateLimit(SID);
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

describe('ingestEvent — devserver_detected', () => {
  it('adds dev server', () => {
    messageStore.ingestEvent(SID, {
      type: 'devserver_detected',
      port: 3000,
      url: 'http://localhost:3000',
    } as AgentEvent);

    expect(messageStore.getDevServers(SID)).toEqual([{ port: 3000, url: 'http://localhost:3000', status: 'ok' }]);
  });

  it('does not duplicate same port', () => {
    messageStore.ingestEvent(SID, { type: 'devserver_detected', port: 3000, url: 'http://localhost:3000' } as AgentEvent);
    messageStore.ingestEvent(SID, { type: 'devserver_detected', port: 3000, url: 'http://localhost:3000' } as AgentEvent);

    expect(messageStore.getDevServers(SID)).toHaveLength(1);
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

    let tasks = messageStore.getBackgroundTasks(SID);
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

    tasks = messageStore.getBackgroundTasks(SID);
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

    tasks = messageStore.getBackgroundTasks(SID);
    expect(tasks[0].status).toBe('completed');
    expect(tasks[0].summary).toBe('Found 3 endpoints');
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
  it('cycles default → plan → acceptEdits → default', () => {
    messageStore.modeBySession[SID] = 'default';
    messageStore.cycleMode(SID);
    expect(messageStore.getMode(SID)).toBe('plan');

    messageStore.cycleMode(SID);
    expect(messageStore.getMode(SID)).toBe('acceptEdits');

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

describe('resolveStaleBackgroundTasks', () => {
  it('removes running bg tasks when session is not running', () => {
    messageStore.backgroundTasksBySession[SID] = {
      't1': { taskId: 't1', description: 'task 1', status: 'running', totalTokens: 0, toolUses: 0, durationMs: 0 },
      't2': { taskId: 't2', description: 'task 2', status: 'completed', totalTokens: 10, toolUses: 1, durationMs: 500 },
    } as any;
    messageStore.setIsRunning(SID, false);

    messageStore.resolveStaleBackgroundTasks(SID);

    const tasks = messageStore.getBackgroundTasks(SID);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].taskId).toBe('t2');
  });

  it('does not touch bg tasks when session is running', () => {
    messageStore.backgroundTasksBySession[SID] = {
      't1': { taskId: 't1', description: 'task 1', status: 'running', totalTokens: 0, toolUses: 0, durationMs: 0 },
    } as any;
    messageStore.setIsRunning(SID, true);

    messageStore.resolveStaleBackgroundTasks(SID);

    expect(messageStore.getBackgroundTasks(SID)).toHaveLength(1);
  });

  it('is called on result event to clean up orphaned bg tasks', () => {
    messageStore.backgroundTasksBySession[SID] = {
      't1': { taskId: 't1', description: 'orphan', status: 'running', totalTokens: 0, toolUses: 0, durationMs: 0 },
    } as any;
    messageStore.setIsRunning(SID, true);

    messageStore.ingestEvent(SID, { type: 'result', subtype: 'success', result: '', totalCostUsd: 0, durationMs: 100 } as any);

    expect(messageStore.getBackgroundTasks(SID)).toHaveLength(0);
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

  it('getThinking returns true by default', () => {
    expect(messageStore.getThinking('unknown')).toBe(true);
  });

  it('getUsage returns zeros for unknown session', () => {
    const u = messageStore.getUsage('unknown');
    expect(u.inputTokens).toBe(0);
    expect(u.outputTokens).toBe(0);
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
    // Should keep messages up to and including the user message with uuid cp-2
    expect(msgs).toHaveLength(3);
    expect(msgs[0].id).toBe('1');
    expect(msgs[1].id).toBe('2');
    expect(msgs[2].id).toBe('3');
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

