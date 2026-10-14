import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '../shared/types.js';
import { THREAD_EXPORT_VERSION, exportFileName, threadJson, threadMarkdown, type ThreadExportInfo } from './thread-export.js';
import { buildContentBlock } from '../shared/prompt-text.js';

const info: ThreadExportInfo = { id: 'abc12345', title: 'Fix the login', project: 'shop', branch: 'fix-login', agent: 'Claude Agent' };
const when = new Date(2026, 9, 14, 12);

const tool = (toolName: string, toolInput: unknown, extra: Partial<Extract<AgentEvent, { type: 'assistant_tool_use' }>> = {}): AgentEvent =>
  ({ type: 'assistant_tool_use', toolName, toolInput, toolUseId: `t-${toolName}`, uuid: '', ...extra });

describe('threadMarkdown', () => {
  it('heads the thread with its name, project, branch and the day', () => {
    const md = threadMarkdown([], info, when);
    expect(md).toBe('# Fix the login\n\nProject: shop  \nBranch: fix-login  \nExported from Grove Bench on 2026-10-14\n');
  });

  it('gives each turn a heading, with the agent\'s text and a line per tool call', () => {
    const md = threadMarkdown([
      { type: 'user_message', text: 'Why does login fail?' },
      { type: 'assistant_text', text: 'Let me look.', uuid: 'a1' },
      tool('Read', { file_path: 'src/login.ts' }),
      tool('Bash', { command: 'npm test' }),
      { type: 'assistant_text', text: 'The token expired.', uuid: 'a2' },
    ], info, when);

    expect(md).toContain('## You\n\nWhy does login fail?\n\n## Claude Agent\n\nLet me look.\n\n- Read `src/login.ts`\n- Bash `npm test`\n\nThe token expired.\n');
    expect(md.match(/## Claude Agent/g)).toHaveLength(1);
  });

  it('leaves out tool output, thinking and what subagents did', () => {
    const md = threadMarkdown([
      { type: 'user_message', text: 'go' },
      tool('Task', { description: 'Search the code' }),
      { type: 'tool_result', toolUseId: 't-Task', content: 'SECRET OUTPUT' },
      { type: 'thinking', thinking: 'private musing', uuid: 'th' },
      { type: 'assistant_text', text: 'subagent words', uuid: 's1', parentToolUseId: 't-Task' },
      tool('Grep', { pattern: 'inner' }, { parentToolUseId: 't-Task' }),
    ], info, when);

    expect(md).toContain('- Task');
    expect(md).not.toContain('SECRET OUTPUT');
    expect(md).not.toContain('private musing');
    expect(md).not.toContain('subagent words');
    expect(md).not.toContain('inner');
  });

  it('names attached files and says when the agent changed', () => {
    const md = threadMarkdown([
      { type: 'user_message', text: 'See these', images: [{ file: 'i1.png', name: 'screen.png' } as never], files: [{ file: 'f1', name: 'notes.pdf' } as never] },
      { type: 'assistant_text', text: 'Seen.', uuid: 'a1' },
      { type: 'agent_changed', from: 'claude-code', to: 'gemini', fromName: 'Claude Agent', toName: 'Gemini CLI', transcript: true },
      { type: 'user_message', text: 'Carry on' },
      { type: 'assistant_text', text: 'On it.', uuid: 'a2' },
    ] as AgentEvent[], { ...info, agent: 'Gemini CLI' }, when);

    expect(md).toContain('See these\n\nAttached: `screen.png`, `notes.pdf`');
    expect(md).toContain('## Claude Agent\n\nSeen.');
    expect(md).toContain('*Switched from Claude Agent to Gemini CLI.*');
    expect(md).toContain('## Gemini CLI\n\nOn it.');
  });

  it('keeps an error on one quoted line', () => {
    const md = threadMarkdown([
      { type: 'user_message', text: 'go' },
      { type: 'error', message: 'Rate limited.\nTry later.' },
    ], info, when);
    expect(md).toContain('> Error: Rate limited. Try later.');
  });

  it('gives what was typed, not the contents of a mentioned file', () => {
    const sent = `${buildContentBlock('file', 'src/secret.ts', 'const KEY = "abc123";')}\n\nFix @src/secret.ts please`;
    const md = threadMarkdown([{ type: 'user_message', text: sent }], info, when);
    expect(md).not.toContain('abc123');
    expect(md).not.toContain('<file');
    expect(md).toContain('## You\n\nFix @src/secret.ts please');
    expect(md).not.toContain('Attached:');
  });

  it('names an attached text file instead of including its contents', () => {
    const sent = `${buildContentBlock('file', 'notes.txt', 'private notes')}\n\nSummarise this`;
    const md = threadMarkdown([{ type: 'user_message', text: sent }], info, when);
    expect(md).not.toContain('private notes');
    expect(md).toContain('Summarise this\n\nAttached: `notes.txt`');
  });

  it('shows a tool call as its updates filled it in', () => {
    const md = threadMarkdown([
      { type: 'user_message', text: 'test it' },
      tool('other', {}, { toolUseId: 'acp-1' }),
      { type: 'tool_update', toolUseId: 'acp-1', toolName: 'run_shell_command', toolView: { kind: 'shell', command: 'npm test' } },
    ], info, when);
    expect(md).toContain('- run_shell_command `npm test`');
    expect(md).not.toContain('- other');
  });

  it('keeps a message exactly as written, blank lines in its code included', () => {
    const code = '```py\ndef a():\n    pass\n\n\ndef b():\n    pass\n```';
    const md = threadMarkdown([{ type: 'user_message', text: 'go' }, { type: 'assistant_text', text: code, uuid: 'a' }], info, when);
    expect(md).toContain(code);
  });

  it('includes a turn that ended in error, the plan the agent proposed and the user\'s answers', () => {
    const md = threadMarkdown([
      { type: 'user_message', text: 'plan it' },
      { type: 'permission_request', toolName: 'ExitPlanMode', toolInput: {}, toolUseId: 'p', requestId: 'r', isPlanExecution: true, planText: '1. Read\n2. Fix' },
      { type: 'permission_resolved', requestId: 'r', toolUseId: 'p', decision: 'deny', message: 'Do step 2 first' },
      { type: 'tool_use_summary', summary: 'Read the login code.', toolUseIds: [] },
      { type: 'result', subtype: 'error_max_turns', isError: true, errors: ['Reached max turns'] },
    ], info, when);
    expect(md).toContain('**Proposed plan:**\n\n1. Read\n2. Fix');
    expect(md).toContain('## You\n\nDo step 2 first');
    expect(md).toContain('Read the login code.');
    expect(md).toContain('> Error: Reached max turns');
  });

  it('keeps an agent\'s title for a call on one line, as plain text', () => {
    const md = threadMarkdown([
      { type: 'user_message', text: 'go' },
      tool('Write *notes*.md\n(Run)', { command: '\nnpm run build' }),
    ], info, when);
    expect(md).toContain('- Write \\*notes\\*.md (Run) `npm run build`');
  });

  it('leaves the branch out for a folder without git', () => {
    expect(threadMarkdown([], { ...info, branch: '' }, when)).not.toContain('Branch:');
  });

  it('shows a command on one line, in a fence its backticks can\'t close', () => {
    const md = threadMarkdown([
      { type: 'user_message', text: 'go' },
      tool('Bash', { command: 'echo `date`\necho done' }),
    ], info, when);
    expect(md).toContain('- Bash ``echo `date` …``');
  });
});

describe('threadJson', () => {
  it('keeps every event, with what the thread is', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: 'hi' },
      { type: 'tool_result', toolUseId: 't', content: 'all of it' },
    ];
    const parsed = JSON.parse(threadJson(events, info, when));
    expect(parsed).toEqual({ groveBenchThread: THREAD_EXPORT_VERSION, exportedAt: when.toISOString(), thread: info, events });
  });
});

describe('exportFileName', () => {
  it('uses the title, without characters Windows doesn\'t allow in a name', () => {
    expect(exportFileName('Fix: login/logout "bug"?', 'md')).toBe('Fix login logout bug.md');
    expect(exportFileName('notes.', 'json')).toBe('notes.json');
  });

  it('never gives an empty, device or overlong name', () => {
    expect(exportFileName('???', 'md')).toBe('Thread.md');
    expect(exportFileName('con', 'md')).toBe('Thread con.md');
    expect(exportFileName('aux.ts cleanup', 'md')).toBe('Thread aux.ts cleanup.md');
    expect(exportFileName('auxiliary', 'md')).toBe('auxiliary.md');
    expect(exportFileName('x'.repeat(200), 'md')).toBe(`${'x'.repeat(80)}.md`);
  });
});
