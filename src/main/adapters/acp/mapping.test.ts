import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  agentControls, categoryForKind, commandOf, configIdForControl, mergeToolCall, modelList, pickPermissionOption,
  planSummary, specifierFor, toolNameFor, toolViewFor,
} from './mapping.js';
import { customAcpAgents } from './presets.js';
import { JsonRpcConnection, JsonRpcError } from './rpc.js';

const CWD = path.resolve('/work/tree');

describe('tool calls', () => {
  it('merges updates, keeping fields an update leaves out or nulls', () => {
    const merged = mergeToolCall({ toolCallId: 't', title: 'Read', kind: 'read' }, { toolCallId: 't', title: null, status: 'completed' });
    expect(merged).toEqual({ toolCallId: 't', title: 'Read', kind: 'read', status: 'completed' });
  });

  it('names a call by its programmatic name, else its kind or, for other tools, its title', () => {
    expect(toolNameFor({ toolCallId: 't', name: 'read_file', kind: 'read' })).toBe('read_file');
    expect(toolNameFor({ toolCallId: 't', kind: 'execute', title: 'npm test' })).toBe('execute');
    // Allowing one MCP tool always mustn't allow every 'other' tool.
    expect(toolNameFor({ toolCallId: 't', kind: 'other', title: 'preview_screenshot (grove-preview MCP Server)' }))
      .toBe('preview_screenshot (grove-preview MCP Server)');
    expect(toolNameFor({ toolCallId: 't' })).toBe('other');
  });

  it('maps kinds to rule categories', () => {
    expect(categoryForKind('delete')).toBe('edit');
    expect(categoryForKind('search')).toBe('read');
    expect(categoryForKind('execute')).toBe('bash');
    expect(categoryForKind('think')).toBe('other');
  });

  it('shows edits as replacements or a new-file write, with paths relative to the worktree', () => {
    const file = path.join(CWD, 'src', 'a.ts');
    expect(toolViewFor({ toolCallId: 't', kind: 'edit', content: [{ type: 'diff', path: file, oldText: 'a', newText: 'b' }] }, CWD))
      .toMatchObject({ kind: 'edit', path: path.join('src', 'a.ts'), edits: [{ oldText: 'a', newText: 'b' }] });
    expect(toolViewFor({ toolCallId: 't', kind: 'edit', content: [{ type: 'diff', path: file, oldText: null, newText: 'new' }] }, CWD))
      .toMatchObject({ kind: 'edit', write: 'new' });
  });

  it('keeps every path an edit names, not just its diff\'s', () => {
    const outside = path.resolve('/home/me/.ssh/config');
    const view = toolViewFor({
      toolCallId: 't', kind: 'move',
      locations: [{ path: outside }],
      content: [{ type: 'diff', path: path.join(CWD, 'src', 'a.ts'), oldText: 'a', newText: 'b' }],
    }, CWD);
    expect(view.path).toBe(path.join('src', 'a.ts'));
    expect(view.morePaths).toEqual([outside]);
  });

  it('keeps paths outside the worktree absolute', () => {
    const outside = path.resolve('/etc/hosts');
    expect(toolViewFor({ toolCallId: 't', kind: 'read', locations: [{ path: outside }] }, CWD).path).toBe(outside);
  });

  it('takes a command only from the raw input, never the title', () => {
    expect(toolViewFor({ toolCallId: 't', kind: 'execute', title: 'rm -rf /', rawInput: {} }, CWD)).toMatchObject({ kind: 'other', summary: 'rm -rf /' });
    expect(toolViewFor({ toolCallId: 't', kind: 'execute', rawInput: { command: 'git status' } }, CWD)).toEqual({ kind: 'shell', command: 'git status' });
    expect(commandOf({ command: ['git', 'commit', '-m', 'a b'] })).toBe('git commit -m "a b"');
  });

  it('reads fetches as URLs or web searches', () => {
    expect(toolViewFor({ toolCallId: 't', kind: 'fetch', rawInput: { url: 'https://x.dev' } }, CWD)).toMatchObject({ kind: 'fetch', url: 'https://x.dev' });
    expect(toolViewFor({ toolCallId: 't', kind: 'fetch', rawInput: { query: 'acp' } }, CWD)).toMatchObject({ kind: 'web_search', query: 'acp' });
  });

  it('matches rules on the command, path or URL, never the agent\'s title', () => {
    expect(specifierFor({ kind: 'shell', command: 'npm test' })).toBe('npm test');
    expect(specifierFor({ kind: 'edit', path: 'a.ts' })).toBe('a.ts');
    expect(specifierFor({ kind: 'other', summary: 'npm test' })).toBe('');
  });
});

describe('permissions', () => {
  const options = [
    { optionId: 'a1', name: 'Allow', kind: 'allow_once' as const },
    { optionId: 'r1', name: 'Reject', kind: 'reject_once' as const },
  ];
  it('picks the matching option, falling back on the same side', () => {
    expect(pickPermissionOption(options, 'allow')?.optionId).toBe('a1');
    expect(pickPermissionOption(options, 'allowAlways')?.optionId).toBe('a1');
    expect(pickPermissionOption(options, 'deny')?.optionId).toBe('r1');
    expect(pickPermissionOption([options[0]], 'deny')).toBeNull();
  });
});

describe('controls and models', () => {
  const configOptions = [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'm1', options: [{ value: 'm1', name: 'M1' }] },
    { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'ask',
      options: [{ group: 'g', name: 'G', options: [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }] }] },
    { id: 'brave', name: 'Brave', type: 'boolean', currentValue: true },
  ];

  it('turns select options into controls, leaving the model to the model picker', () => {
    const controls = agentControls(configOptions, { currentModeId: 'x', availableModes: [{ id: 'x', name: 'X' }] });
    expect(controls).toEqual([{ id: 'acp:mode', label: 'Mode', default: 'ask', options: [{ value: 'ask', label: 'Ask' }, { value: 'code', label: 'Code' }] }]);
    expect(configIdForControl('acp:mode', configOptions)).toBe('mode');
  });

  it('uses the modes API when there is no mode option', () => {
    const controls = agentControls([], { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'yolo', name: 'YOLO' }] });
    expect(controls[0]).toMatchObject({ id: 'acp:mode', default: 'default' });
    expect(configIdForControl('acp:mode', [])).toBeNull();
  });

  it('finds the model list in config options or the older models field', () => {
    expect(modelList(configOptions, null)).toMatchObject({ current: 'm1', via: { configId: 'model' } });
    expect(modelList([], { currentModelId: 'g', availableModels: [{ modelId: 'g', name: 'Gemini' }] }))
      .toEqual({ models: [{ id: 'g', label: 'Gemini' }], current: 'g', via: 'set_model' });
    expect(modelList([], null)).toBeNull();
  });

  it('summarises a plan', () => {
    expect(planSummary([{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }])).toBe('Plan: 1/2 done · b');
  });
});

describe('customAcpAgents', () => {
  it('builds prefixed ids and skips entries without a command or with a repeated id', () => {
    const defs = customAcpAgents([
      { id: '', name: 'Codex (ACP)', command: 'codex-acp', args: [] },
      { id: 'codex-acp-', name: 'Again', command: 'x', args: [] },
      { id: 'empty', name: 'No command', command: '  ', args: [] },
    ]);
    expect(defs).toEqual([{ id: 'acp-codex-acp', displayName: 'Codex (ACP)', command: 'codex-acp', args: [] }]);
  });

  it('falls back to the command when the name gives no usable id', () => {
    expect(customAcpAgents([{ id: '', name: '\u4ee3\u7406', command: 'codex-acp', args: [] }]))
      .toEqual([{ id: 'acp-codex-acp', displayName: '\u4ee3\u7406', command: 'codex-acp', args: [] }]);
    const [hashed] = customAcpAgents([{ id: '', name: '\u{1F916}', command: '\u4ee3\u7406', args: [] }]);
    expect(hashed.id).toMatch(/^acp-agent-[0-9a-f]{8}$/);
  });
});

describe('JsonRpcConnection', () => {
  it('matches responses, answers requests and reports errors', async () => {
    const toUs = new PassThrough();
    const fromUs = new PassThrough();
    const written: any[] = [];
    fromUs.on('data', (b: Buffer) => b.toString().split('\n').filter(Boolean).forEach((l) => written.push(JSON.parse(l))));
    const notes: string[] = [];
    const rpc = new JsonRpcConnection(toUs, fromUs, {
      onRequest: async (method) => {
        if (method === 'ping') return { pong: true };
        throw new JsonRpcError(-32601, 'nope');
      },
      onNotification: (method) => notes.push(method),
    });

    const pending = rpc.request('initialize', { a: 1 });
    await new Promise((r) => setImmediate(r));
    expect(written[0]).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { a: 1 } });
    // A response split across chunks still parses.
    toUs.write('{"jsonrpc":"2.0","id":1,');
    toUs.write('"result":{"ok":true}}\n');
    await expect(pending).resolves.toEqual({ ok: true });

    toUs.write('{"jsonrpc":"2.0","id":7,"method":"ping"}\n{"jsonrpc":"2.0","id":8,"method":"other"}\n{"jsonrpc":"2.0","method":"note"}\nnot json\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(written).toContainEqual({ jsonrpc: '2.0', id: 7, result: { pong: true } });
    expect(written).toContainEqual({ jsonrpc: '2.0', id: 8, error: { code: -32601, message: 'nope' } });
    expect(notes).toEqual(['note']);

    const failing = rpc.request('x');
    toUs.write('{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"Authentication required"}}\n');
    await expect(failing).rejects.toMatchObject({ code: -32000 });

    const orphan = rpc.request('y');
    rpc.close(new Error('gone'));
    await expect(orphan).rejects.toThrow('gone');
  });
});
