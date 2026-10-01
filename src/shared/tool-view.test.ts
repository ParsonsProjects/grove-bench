import { describe, it, expect } from 'vitest';
import { categoryForView, changesFiles, claudeToolView, toolViewOf, toolViewSummary, type ToolView } from './tool-view.js';

describe('claudeToolView', () => {
  it('reads Edit as one replacement in a file', () => {
    expect(claudeToolView('Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' })).toEqual({
      kind: 'edit', path: 'a.ts', edits: [{ oldText: 'x', newText: 'y' }],
    });
  });

  it('reads MultiEdit as several replacements', () => {
    const view = claudeToolView('MultiEdit', {
      file_path: 'a.ts',
      edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }],
    });
    expect(view.edits).toEqual([{ oldText: 'a', newText: 'b' }, { oldText: 'c', newText: 'd' }]);
  });

  it('reads Write as a whole-file write', () => {
    expect(claudeToolView('Write', { file_path: 'n.ts', content: 'hi' })).toEqual({ kind: 'edit', path: 'n.ts', write: 'hi' });
  });

  it('reads NotebookEdit as an edit with no diff', () => {
    const view = claudeToolView('NotebookEdit', { notebook_path: 'n.ipynb' });
    expect(view).toEqual({ kind: 'edit', path: 'n.ipynb' });
  });

  it('reads file reads and searches', () => {
    expect(claudeToolView('Read', { file_path: 'a.ts' })).toEqual({ kind: 'read', path: 'a.ts' });
    expect(claudeToolView('Grep', { pattern: 'x', path: 'src' })).toEqual({ kind: 'search', pattern: 'x', path: 'src' });
    expect(claudeToolView('Glob', { pattern: '*.ts' })).toEqual({ kind: 'search', pattern: '*.ts', path: undefined });
    expect(claudeToolView('TodoRead', {})).toEqual({ kind: 'read' });
  });

  it('reads Bash and PowerShell as shell commands', () => {
    expect(claudeToolView('Bash', { command: 'ls' })).toEqual({ kind: 'shell', command: 'ls' });
    expect(claudeToolView('PowerShell', { command: 'dir' })).toEqual({ kind: 'shell', command: 'dir' });
  });

  it('reads web, question, agent and plan tools', () => {
    expect(claudeToolView('WebFetch', { url: 'https://x.dev' })).toEqual({ kind: 'fetch', url: 'https://x.dev' });
    expect(claudeToolView('mcp__fetch__WebFetch', { url: 'https://x.dev' }).kind).toBe('fetch');
    expect(claudeToolView('WebSearch', { query: 'q' })).toEqual({ kind: 'web_search', query: 'q' });
    expect(claudeToolView('AskUserQuestion', {}).kind).toBe('question');
    expect(claudeToolView('Agent', { description: 'Find usages' })).toEqual({ kind: 'agent', summary: 'Find usages' });
    expect(claudeToolView('ExitPlanMode', { plan: 'p' }).kind).toBe('plan');
  });

  it('summarises other tools from common input fields', () => {
    expect(claudeToolView('mcp__linear__create_issue', { description: 'Bug' })).toEqual({ kind: 'other', summary: 'Bug' });
    expect(claudeToolView('Mystery', null)).toEqual({ kind: 'other', summary: undefined });
  });
});

describe('toolViewOf', () => {
  it('prefers the view an adapter attached', () => {
    const view: ToolView = { kind: 'shell', command: 'pytest' };
    expect(toolViewOf({ toolName: 'run_shell_command', toolInput: { cmd: 'pytest' }, toolView: view })).toBe(view);
  });

  it('reads calls without a view as Claude Code tools', () => {
    expect(toolViewOf({ toolName: 'Bash', toolInput: { command: 'ls' } })).toEqual({ kind: 'shell', command: 'ls' });
  });
});

describe('view helpers', () => {
  it('maps kinds to permission-rule categories', () => {
    expect(categoryForView({ kind: 'edit' })).toBe('edit');
    expect(categoryForView({ kind: 'search' })).toBe('read');
    expect(categoryForView({ kind: 'shell' })).toBe('bash');
    expect(categoryForView({ kind: 'fetch' })).toBe('web_fetch');
    expect(categoryForView({ kind: 'web_search' })).toBe('other');
  });

  it('says which calls change files', () => {
    expect(changesFiles({ kind: 'edit' })).toBe(true);
    expect(changesFiles({ kind: 'shell' })).toBe(true);
    expect(changesFiles({ kind: 'read' })).toBe(false);
  });

  it('summarises a view by its most telling field', () => {
    expect(toolViewSummary({ kind: 'shell', command: 'ls' })).toBe('ls');
    expect(toolViewSummary({ kind: 'read', path: 'a.ts' })).toBe('a.ts');
    expect(toolViewSummary({ kind: 'search', pattern: 'TODO', path: 'src' })).toBe('TODO');
    expect(toolViewSummary({ kind: 'other', summary: 'Doing a thing' })).toBe('Doing a thing');
    expect(toolViewSummary({ kind: 'other' })).toBe('');
  });
});
