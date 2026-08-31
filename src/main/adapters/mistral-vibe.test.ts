import { describe, it, expect } from 'vitest';
import {
  MistralVibeAdapter,
  PERMISSION_MODE_TO_VIBE_MODE,
  VIBE_MODE_TO_PERMISSION_MODE,
  categorizeToolKind,
  createVibeContext,
  flushPending,
  parseDotEnvKey,
  selectPermissionOption,
  toolCallContentToString,
  transformSessionUpdate,
} from './mistral-vibe.js';
import type { AgentEvent } from '../../shared/types.js';

// ─── Adapter surface ───

describe('MistralVibeAdapter surface', () => {
  const adapter = new MistralVibeAdapter();

  it('has the expected identity', () => {
    expect(adapter.id).toBe('mistral-vibe');
    expect(adapter.displayName).toBe('Mistral');
  });

  it('declares capabilities matching what ACP can deliver', () => {
    expect(adapter.capabilities).toMatchObject({
      permissions: true,
      permissionModes: true,
      resume: true,
      modelSwitching: true,
      thinking: false,
      plugins: false,
      skills: true,
      imageAttachments: false,
      structuredOutput: false,
      sandbox: false,
    });
  });

  it('lists Devstral 2 first (used as the default model)', () => {
    const models = adapter.getModels();
    expect(models[0]).toMatchObject({ id: 'devstral-2512', label: 'Devstral 2', family: 'Mistral' });
    expect(models.every((m) => m.family === 'Mistral')).toBe(true);
  });
});

// ─── Permission mode ↔ vibe profile mapping ───

describe('permission mode mapping', () => {
  it('maps every Grove mode to a vibe profile and back', () => {
    for (const [groveMode, vibeMode] of Object.entries(PERMISSION_MODE_TO_VIBE_MODE)) {
      expect(VIBE_MODE_TO_PERMISSION_MODE[vibeMode]).toBe(groveMode);
    }
  });

  it('maps acceptEdits to vibe accept-edits', () => {
    expect(PERMISSION_MODE_TO_VIBE_MODE.acceptEdits).toBe('accept-edits');
  });
});

// ─── Tool categorization ───

describe('categorizeToolKind()', () => {
  it('maps ACP kinds to Grove categories', () => {
    expect(categorizeToolKind('edit')).toBe('edit');
    expect(categorizeToolKind('delete')).toBe('edit');
    expect(categorizeToolKind('move')).toBe('edit');
    expect(categorizeToolKind('execute')).toBe('bash');
    expect(categorizeToolKind('fetch')).toBe('web_fetch');
    expect(categorizeToolKind('read')).toBe('other');
    expect(categorizeToolKind('think')).toBe('other');
  });

  it('falls back to title sniffing when kind is missing', () => {
    expect(categorizeToolKind(undefined, 'Run bash command')).toBe('bash');
    expect(categorizeToolKind(undefined, 'Write file src/a.ts')).toBe('edit');
    expect(categorizeToolKind(undefined, 'Fetch https://example.com')).toBe('web_fetch');
    expect(categorizeToolKind(undefined, 'Delegate task to explore agent')).toBe('agent');
    expect(categorizeToolKind(undefined, 'Something else')).toBe('other');
  });
});

// ─── parseDotEnvKey ───

describe('parseDotEnvKey()', () => {
  it('reads a plain KEY=value line', () => {
    expect(parseDotEnvKey('MISTRAL_API_KEY=abc123\n', 'MISTRAL_API_KEY')).toBe('abc123');
  });

  it('handles export prefixes and quotes', () => {
    expect(parseDotEnvKey('export MISTRAL_API_KEY="abc 123"', 'MISTRAL_API_KEY')).toBe('abc 123');
    expect(parseDotEnvKey("MISTRAL_API_KEY='xyz'", 'MISTRAL_API_KEY')).toBe('xyz');
  });

  it('skips comments and other keys', () => {
    const content = '# credentials\nOTHER_KEY=nope\nMISTRAL_API_KEY=yes\n';
    expect(parseDotEnvKey(content, 'MISTRAL_API_KEY')).toBe('yes');
  });

  it('returns undefined when the key is absent or empty', () => {
    expect(parseDotEnvKey('OTHER=1', 'MISTRAL_API_KEY')).toBeUndefined();
    expect(parseDotEnvKey('MISTRAL_API_KEY=', 'MISTRAL_API_KEY')).toBeUndefined();
  });
});

// ─── selectPermissionOption ───

describe('selectPermissionOption()', () => {
  const options = [
    { optionId: 'always', kind: 'allow_always' },
    { optionId: 'once', kind: 'allow_once' },
    { optionId: 'no', kind: 'reject_once' },
    { optionId: 'never', kind: 'reject_always' },
  ];

  it('prefers the *_once variant for each decision', () => {
    expect(selectPermissionOption(options, 'allow')).toBe('once');
    expect(selectPermissionOption(options, 'deny')).toBe('no');
  });

  it('falls back to any option in the same family', () => {
    expect(selectPermissionOption([{ optionId: 'a', kind: 'allow_always' }], 'allow')).toBe('a');
    expect(selectPermissionOption([{ optionId: 'r', kind: 'reject_always' }], 'deny')).toBe('r');
  });

  it('returns undefined when no matching option exists', () => {
    expect(selectPermissionOption([{ optionId: 'a', kind: 'allow_once' }], 'deny')).toBeUndefined();
    expect(selectPermissionOption([], 'allow')).toBeUndefined();
  });
});

// ─── toolCallContentToString ───

describe('toolCallContentToString()', () => {
  it('extracts text content blocks', () => {
    const content = [{ type: 'content', content: { type: 'text', text: 'file contents' } }];
    expect(toolCallContentToString(content)).toBe('file contents');
  });

  it('renders diffs with their path', () => {
    const content = [{ type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' }];
    expect(toolCallContentToString(content)).toBe('[diff src/a.ts]\nb');
  });

  it('falls back to rawOutput when no content blocks exist', () => {
    expect(toolCallContentToString(undefined, { exitCode: 0 })).toBe('{"exitCode":0}');
    expect(toolCallContentToString([], 'plain output')).toBe('plain output');
  });

  it('returns empty string when nothing is reported', () => {
    expect(toolCallContentToString(undefined)).toBe('');
  });
});

// ─── transformSessionUpdate ───

function types(events: AgentEvent[]): string[] {
  return events.map((e) => e.type);
}

describe('transformSessionUpdate()', () => {
  it('streams agent message chunks as partial_text and accumulates for the flush', () => {
    const ctx = createVibeContext();
    const first = transformSessionUpdate(
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } }, ctx);
    expect(types(first)).toEqual(['activity', 'partial_text']);

    const second = transformSessionUpdate(
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } }, ctx);
    expect(types(second)).toEqual(['partial_text']);

    const flushed = flushPending(ctx);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({ type: 'assistant_text', text: 'Hello world' });
    // Flushing clears the buffer
    expect(flushPending(ctx)).toEqual([]);
  });

  it('streams thought chunks as partial_thinking and flushes thinking before text', () => {
    const ctx = createVibeContext();
    transformSessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }, ctx);
    transformSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } }, ctx);

    const flushed = flushPending(ctx);
    expect(types(flushed)).toEqual(['thinking', 'assistant_text']);
    expect(flushed[0]).toMatchObject({ thinking: 'hmm' });
  });

  it('finalizes buffered text before a tool call and emits assistant_tool_use', () => {
    const ctx = createVibeContext();
    transformSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Let me look.' } }, ctx);

    const events = transformSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Run npm test',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'npm test' },
    }, ctx);

    expect(types(events)).toEqual(['assistant_text', 'activity', 'assistant_tool_use']);
    expect(events[2]).toMatchObject({
      toolName: 'Run npm test',
      toolUseId: 'tc-1',
      toolInput: { command: 'npm test' },
      toolCategory: 'bash',
    });
    expect(ctx.toolNames.get('tc-1')).toBe('Run npm test');
  });

  it('emits one tool_result when a tool call completes', () => {
    const ctx = createVibeContext();
    transformSessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'Read file', kind: 'read', status: 'in_progress' }, ctx);

    const done = transformSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'ok' } }],
    }, ctx);
    expect(done).toEqual([
      { type: 'tool_result', toolUseId: 'tc-1', content: 'ok', isError: false },
    ]);

    // A duplicate terminal update must not re-emit the result
    const dup = transformSessionUpdate(
      { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', status: 'completed' }, ctx);
    expect(dup).toEqual([]);
  });

  it('marks failed tool calls as errors', () => {
    const ctx = createVibeContext();
    const events = transformSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-2',
      status: 'failed',
      rawOutput: 'command not found',
    }, ctx);
    expect(events).toEqual([
      { type: 'tool_result', toolUseId: 'tc-2', content: 'command not found', isError: true },
    ]);
  });

  it('emits a tool_result immediately for a tool_call reported already completed', () => {
    const ctx = createVibeContext();
    const events = transformSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-3',
      title: 'Grep',
      kind: 'search',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '3 matches' } }],
    }, ctx);
    expect(types(events)).toEqual(['activity', 'assistant_tool_use', 'tool_result']);
  });

  it('syncs known vibe modes back to Grove permission modes', () => {
    const ctx = createVibeContext();
    expect(transformSessionUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'accept-edits' }, ctx))
      .toEqual([{ type: 'mode_sync', mode: 'acceptEdits', source: 'sdk' }]);
    expect(transformSessionUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'auto-approve' }, ctx))
      .toEqual([]);
  });

  it('ignores unknown update kinds', () => {
    const ctx = createVibeContext();
    expect(transformSessionUpdate({ sessionUpdate: 'plan', entries: [] }, ctx)).toEqual([]);
    expect(transformSessionUpdate({ sessionUpdate: 'available_commands_update', availableCommands: [] }, ctx)).toEqual([]);
    expect(transformSessionUpdate(undefined, ctx)).toEqual([]);
  });

  it('drops everything while a session/load replay is suppressed', () => {
    const ctx = createVibeContext();
    ctx.suppress = true;
    expect(transformSessionUpdate(
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old history' } }, ctx)).toEqual([]);
    expect(ctx.pendingText).toBe('');
  });
});
