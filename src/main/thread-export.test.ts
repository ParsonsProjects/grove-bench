import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '../shared/types.js';
import { THREAD_EXPORT_VERSION, exportFileName, threadJson, threadMarkdown, type ThreadExportInfo } from './thread-export.js';

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

    expect(md).toContain('See these\n\nAttached: screen.png, notes.pdf');
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
    expect(exportFileName('x'.repeat(200), 'md')).toBe(`${'x'.repeat(80)}.md`);
  });
});
