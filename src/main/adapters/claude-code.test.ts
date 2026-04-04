import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transformMessage } from './claude-code.js';
import type { AgentEvent } from '../../shared/types.js';

// ─── transformMessage ───

function makeCtx() {
  return { toolUseMap: new Map<string, string>(), detectedPorts: new Set<number>() };
}

describe('transformMessage()', () => {
  describe('system messages', () => {
    it('transforms init into system_init', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-4-6', tools: ['Bash', 'Read'] } as any,
        makeCtx(),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'system_init',
        sessionId: 's1',
        model: 'claude-opus-4-6',
      });
    });

    it('transforms compact_boundary with metadata', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 150000 } } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'compact_boundary', trigger: 'auto', preTokens: 150000 }]);
    });

    it('transforms compact_boundary with missing metadata gracefully', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'compact_boundary' } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'compact_boundary', trigger: 'manual', preTokens: 0 }]);
    });

    it('extracts mode_sync from status message (camelCase)', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'status', permissionMode: 'plan' } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'plan', source: 'sdk' });
    });

    it('extracts mode_sync from status message (snake_case)', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'status', permission_mode: 'default' } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'default', source: 'sdk' });
    });

    it('detects plan mode from local_command_output', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'local_command_output', content: 'Switched to plan mode' } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'mode_sync', mode: 'plan', source: 'sdk' });
    });

    it('emits compacting status', () => {
      const events = transformMessage(
        { type: 'system', subtype: 'status', status: 'compacting' } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'status', message: 'Compacting conversation...' });
    });
  });

  describe('assistant messages', () => {
    it('transforms text blocks', () => {
      const events = transformMessage(
        {
          type: 'assistant',
          uuid: 'u1',
          message: { content: [{ type: 'text', text: 'Hello world' }] },
        } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'assistant_text', text: 'Hello world', uuid: 'u1' });
    });

    it('transforms tool_use blocks and registers in toolUseMap', () => {
      const ctx = makeCtx();
      const events = transformMessage(
        {
          type: 'assistant',
          uuid: 'u2',
          message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] },
        } as any,
        ctx,
      );
      expect(events).toContainEqual({
        type: 'assistant_tool_use',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        toolUseId: 'tu1',
        uuid: 'u2',
        toolCategory: 'bash',
      });
      expect(ctx.toolUseMap.get('tu1')).toBe('Bash');
    });

    it('transforms thinking blocks', () => {
      const events = transformMessage(
        {
          type: 'assistant',
          uuid: 'u3',
          message: { content: [{ type: 'thinking', thinking: 'Let me think...' }] },
        } as any,
        makeCtx(),
      );
      expect(events).toContainEqual({ type: 'thinking', thinking: 'Let me think...', uuid: 'u3' });
    });

    it('extracts usage from assistant message', () => {
      const events = transformMessage(
        {
          type: 'assistant',
          uuid: 'u4',
          message: {
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
          },
        } as any,
        makeCtx(),
      );
      const usage = events.find((e) => e.type === 'usage');
      expect(usage).toMatchObject({
        type: 'usage',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
      });
    });

    it('ignores usage from subagent assistant messages (parent_tool_use_id set)', () => {
      const events = transformMessage(
        {
          type: 'assistant',
          uuid: 'u5',
          parent_tool_use_id: 'tu-agent-123',
          message: {
            content: [{ type: 'text', text: 'subagent reply' }],
            usage: { input_tokens: 200, output_tokens: 30 },
          },
        } as any,
        makeCtx(),
      );
      expect(events.find((e) => e.type === 'usage')).toBeUndefined();
      // text should still come through
      expect(events.find((e) => e.type === 'assistant_text')).toMatchObject({ text: 'subagent reply' });
    });
  });

  describe('user messages (tool results)', () => {
    it('transforms tool_result blocks', () => {
      const events = transformMessage(
        {
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false }] },
        } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'tool_result', toolUseId: 'tu1', content: 'file contents', isError: false }]);
    });

    it('handles array content in tool_result', () => {
      const events = transformMessage(
        {
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: [{ text: 'part1' }, { text: 'part2' }], is_error: false }] },
        } as any,
        makeCtx(),
      );
      expect(events[0]).toMatchObject({ content: 'part1part2' });
    });
  });

  describe('result messages', () => {
    it('transforms result with cost and duration', () => {
      const events = transformMessage(
        {
          type: 'result',
          subtype: 'success',
          result: 'Done',
          total_cost_usd: 0.05,
          duration_ms: 3000,
          is_error: false,
          num_turns: 3,
        } as any,
        makeCtx(),
      );
      expect(events[0]).toMatchObject({
        type: 'result',
        subtype: 'success',
        totalCostUsd: 0.05,
        durationMs: 3000,
        isError: false,
        numTurns: 3,
      });
    });
  });

  describe('stream_event messages', () => {
    it('transforms text_delta', () => {
      const events = transformMessage(
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
        } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'partial_text', text: 'hi' }]);
    });

    it('transforms thinking_delta', () => {
      const events = transformMessage(
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
        } as any,
        makeCtx(),
      );
      expect(events).toEqual([{ type: 'partial_thinking', text: 'hmm' }]);
    });
  });

  describe('unknown message types', () => {
    it('returns empty array for unknown type', () => {
      const events = transformMessage({ type: 'unknown_type' } as any, makeCtx());
      expect(events).toEqual([]);
    });
  });
});
