import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { decideToolCall, editsInsideWorktree, groveServersOf, readsAttachedFiles, type PolicyCall, type PolicyContext } from './tool-policy.js';
import { categoryForView, claudeToolView, type ToolView } from '../shared/tool-view.js';
import { toolCallSpecifier } from './agent-utils.js';
import { groveToolOf } from './adapters/grove-tools.js';

const cwd = path.resolve('/wt/abc');
const att = path.resolve('/data/attachments/s1');

function ctx(extra: Partial<PolicyContext> = {}): PolicyContext {
  return { cwd, toolAllowRules: [], toolDenyRules: [], alwaysAllowedTools: new Set(), ...extra };
}

/** A Claude Code call, described the way its adapter does. */
function claude(toolName: string, input: Record<string, unknown>): PolicyCall {
  const view = claudeToolView(toolName, input);
  const category = categoryForView(view);
  return { toolName, category, view, specifier: toolCallSpecifier(toolName, input, category) };
}

function call(toolName: string, view: ToolView, extra: Partial<PolicyCall> = {}): PolicyCall {
  return { toolName, view, category: categoryForView(view), specifier: view.command ?? view.path ?? '', ...extra };
}

describe('decideToolCall', () => {
  it("refuses a tool the thread doesn't allow before anything else", () => {
    const decision = decideToolCall(claude('Bash', { command: 'ls' }), ctx({
      allowedTools: new Set(['Read']),
      toolAllowRules: [{ pattern: 'shell' }],
    }));
    expect(decision).toMatchObject({ behavior: 'deny', reason: 'not-allowed' });
  });

  it('applies deny rules ahead of allow rules and always-allow', () => {
    const decision = decideToolCall(claude('Bash', { command: 'rm -rf build' }), ctx({
      toolDenyRules: [{ pattern: 'shell(rm *)' }],
      toolAllowRules: [{ pattern: 'shell' }],
      alwaysAllowedTools: new Set(['Bash']),
    }));
    expect(decision).toEqual({ behavior: 'deny', reason: 'rule', message: 'Denied by settings rule: shell(rm *)' });
  });

  it('reads a command in every shell it may run in: a deny in one denies, an allow needs all', () => {
    const cmd = (command: string) => call('execute', { kind: 'shell', command }, { category: 'bash', shells: ['bash', 'powershell'] });
    // PowerShell's alias for Remove-Item.
    expect(decideToolCall(cmd('del build'), ctx({ toolDenyRules: [{ pattern: 'shell(Remove-Item *)' }] }))).toMatchObject({ behavior: 'deny' });
    expect(decideToolCall(cmd('npm test'), ctx({ toolAllowRules: [{ pattern: 'shell(npm test)' }] }))).toEqual({ behavior: 'allow' });
    expect(decideToolCall(cmd('npm test; echo hi'), ctx({ toolAllowRules: [{ pattern: 'shell(npm test)' }] }))).toEqual({ behavior: 'ask' });
  });

  it("stops Claude's NotebookEdit with an edit rule, and covers LS with a read rule", () => {
    const notebook = claude('NotebookEdit', { notebook_path: 'a.ipynb', new_source: 'x' });
    expect(notebook.category).toBe('edit');
    expect(decideToolCall(notebook, ctx({ toolDenyRules: [{ pattern: 'edit' }] }))).toMatchObject({ behavior: 'deny' });
    expect(decideToolCall(claude('LS', { path: 'src' }), ctx({ toolAllowRules: [{ pattern: 'read(src)' }] }))).toEqual({ behavior: 'allow' });
  });

  it('reads the files the user attached without a prompt, for any agent, but never edits them', () => {
    expect(decideToolCall(claude('Read', { file_path: path.join(att, 'a.pdf') }), ctx({ attachmentsDir: att }))).toEqual({ behavior: 'allow' });
    expect(decideToolCall(call('read', { kind: 'read', path: path.join(att, 'a.pdf') }), ctx({ attachmentsDir: att }))).toEqual({ behavior: 'allow' });
    expect(decideToolCall(claude('Write', { file_path: path.join(att, 'a.pdf'), content: '' }), ctx({ attachmentsDir: att }))).toEqual({ behavior: 'ask' });
  });

  it("runs Grove's memory and Preview looking tools without a prompt, under each agent's name for them", () => {
    const groveServers = groveServersOf({ memoryOperations: {} as never, previewOperations: {} as never });
    for (const name of ['mcp__grove-memory__memory_write', 'grove-memory_memory_read', 'memory_list (grove-memory MCP Server)', 'grove-preview_preview_screenshot']) {
      expect(decideToolCall(call(name, { kind: 'other' }), ctx({ groveServers })), name).toEqual({ behavior: 'allow' });
    }
    // Clicking asks like other actions; same-named tools elsewhere aren't Grove's.
    for (const name of ['mcp__grove-preview__preview_click', 'grove-preview_preview_type', 'mcp__notes__memory_read', 'memory_read(path: "a.md")']) {
      expect(decideToolCall(call(name, { kind: 'other' }), ctx({ groveServers })), name).toEqual({ behavior: 'ask' });
    }
    // A deny rule still wins.
    expect(decideToolCall(call('grove-memory_memory_write', { kind: 'other' }), ctx({ groveServers, toolDenyRules: [{ pattern: 'mcp(grove-memory__memory_write)' }] })))
      .toMatchObject({ behavior: 'deny' });
  });

  it("asks about a call named for a Grove server Grove didn't give the agent: another server took the name", () => {
    // The user turned the Preview tools off, so Grove started no grove-preview.
    const groveServers = groveServersOf({ memoryOperations: {} as never, previewOperations: null });
    expect(decideToolCall(call('mcp__grove-preview__preview_open', { kind: 'other' }), ctx({ groveServers }))).toEqual({ behavior: 'ask' });
    expect(decideToolCall(call('mcp__grove-memory__memory_read', { kind: 'other' }), ctx({ groveServers }))).toEqual({ behavior: 'allow' });
    expect(decideToolCall(call('mcp__grove-memory__memory_read', { kind: 'other' }), ctx())).toEqual({ behavior: 'ask' });
  });

  it("runs the agent's own checks before always-allow, so it can't get past them", () => {
    const guard = () => ({ behavior: 'deny' as const, reason: 'guard' as const, message: 'outside the sandbox' });
    const decision = decideToolCall(claude('Write', { file_path: '/etc/x', content: '' }), ctx({ alwaysAllowedTools: new Set(['Write']), guard }));
    expect(decision).toMatchObject({ behavior: 'deny', reason: 'guard' });
    expect(decideToolCall(claude('Write', { file_path: 'a', content: '' }), ctx({ alwaysAllowedTools: new Set(['Write']), guard: () => null })))
      .toEqual({ behavior: 'allow' });
  });

  it('approves edits inside the worktree only when asked to, and only when every path is inside', () => {
    const edit = (p: string, more?: string[]) => call('edit', { kind: 'edit', path: p, ...(more ? { morePaths: more } : {}) });
    expect(decideToolCall(edit('src/a.ts'), ctx())).toEqual({ behavior: 'ask' });
    expect(decideToolCall(edit('src/a.ts'), ctx({ approveEditsInWorktree: true }))).toEqual({ behavior: 'allow' });
    expect(decideToolCall(edit('src/a.ts', ['../other/b.ts']), ctx({ approveEditsInWorktree: true }))).toEqual({ behavior: 'ask' });
  });
});

describe('readsAttachedFiles / editsInsideWorktree', () => {
  it("needs a path, and doesn't let one climb out", () => {
    expect(readsAttachedFiles({ kind: 'read', path: path.join(att, '..', 's2', 'a.pdf') }, cwd, att)).toBe(false);
    expect(readsAttachedFiles({ kind: 'search', pattern: '*' }, cwd, att)).toBe(false);
    expect(readsAttachedFiles({ kind: 'read', path: path.join(att, 'a.pdf') }, cwd, null)).toBe(false);
    expect(editsInsideWorktree({ kind: 'edit' }, cwd)).toBe(false);
  });
});

describe('groveToolOf', () => {
  it("reads the forms that name Grove's server", () => {
    expect(groveToolOf('mcp__grove-memory__memory_read')).toEqual({ server: 'grove-memory', tool: 'memory_read' });
    expect(groveToolOf('grove-preview_preview_open')).toEqual({ server: 'grove-preview', tool: 'preview_open' });
    expect(groveToolOf('memory_list (grove-memory MCP Server)')).toEqual({ server: 'grove-memory', tool: 'memory_list' });
    expect(groveToolOf('memory_read(path: "a.md")')).toBeNull();
    expect(groveToolOf('grove-memoryx_memory_read')).toBeNull();
  });
});
