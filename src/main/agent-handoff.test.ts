import { describe, it, expect } from 'vitest';
import path from 'node:path';
import type { AgentEvent } from '../shared/types.js';
import { HANDOFF_MAX_CHARS, eventsSinceAgentChange, handoffTranscript, isSlashCommand, lastAgentChange, pendingHandoff } from './agent-handoff.js';
import { goalInputFromEvents } from './session-goal.js';

const switched = (transcript: boolean, fromName = 'Claude Agent', toName = 'Gemini CLI'): Extract<AgentEvent, { type: 'agent_changed' }> =>
  ({ type: 'agent_changed', from: 'claude-code', to: 'gemini-cli', fromName, toName, transcript });

describe('pendingHandoff', () => {
  it('is the last switch that asked for a transcript, until the new agent replies', () => {
    const events: AgentEvent[] = [{ type: 'user_message', text: 'hi' }, switched(true), { type: 'status', message: 'Switched' }];
    expect(pendingHandoff(events)?.index).toBe(1);
    // A message the agent never answered (its start failed) leaves it pending.
    const sent: AgentEvent[] = [...events, { type: 'user_message', text: 'next' }, { type: 'error', message: 'auth' }];
    expect(pendingHandoff(sent)?.index).toBe(1);
    expect(pendingHandoff([...sent, { type: 'assistant_text', text: 'On it', uuid: 'a1' }])).toBeNull();
    expect(pendingHandoff([{ type: 'user_message', text: 'hi' }, switched(false)])).toBeNull();
    expect(pendingHandoff([])).toBeNull();
  });

  it('knows slash commands and the last switch', () => {
    expect(isSlashCommand('/clear')).toBe(true);
    expect(isSlashCommand('  /compact now')).toBe(true);
    expect(isSlashCommand('a/b test')).toBe(false);
    expect(isSlashCommand('/ not a command')).toBe(false);
    expect(lastAgentChange([switched(true), { type: 'user_message', text: 'x' }, switched(false)])?.transcript).toBe(false);
    expect(lastAgentChange([])).toBeNull();
  });
});

describe('handoffTranscript', () => {
  it('has the messages and replies, who gave them, and the files changed, without tool output', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: 'Add a README', uuid: 'u1' },
      { type: 'assistant_text', text: 'Writing it now.', uuid: 'a1' },
      { type: 'assistant_tool_use', toolName: 'Write', toolInput: { file_path: '/wt/README.md', content: 'secret tool content' }, toolUseId: 't1', uuid: 'a2' },
      { type: 'tool_result', toolUseId: 't1', content: 'tool output here', isError: false } as AgentEvent,
      { type: 'assistant_tool_use', toolName: 'Read', toolInput: { file_path: '/wt/package.json' }, toolUseId: 't2', uuid: 'a3' },
      { type: 'assistant_text', text: 'Done.', uuid: 'a4' },
      { type: 'assistant_text', text: 'subagent chatter', uuid: 'a5', parentToolUseId: 't9' },
    ];
    const text = handoffTranscript(events, switched(true));

    expect(text).toContain('it started with Claude Agent');
    expect(text).toContain('User: Add a README');
    expect(text).toContain('Claude Agent: Writing it now.\nDone.');
    expect(text).toContain('Files changed so far: /wt/README.md');
    expect(text).not.toContain('package.json');
    expect(text).not.toContain('tool output here');
    expect(text).not.toContain('secret tool content');
    expect(text).not.toContain('subagent chatter');
  });

  it('names each agent for its own turns after an earlier switch', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: 'one' },
      { type: 'assistant_text', text: 'from claude', uuid: 'a1' },
      switched(true),
      { type: 'user_message', text: 'two' },
      { type: 'assistant_text', text: 'from gemini', uuid: 'a2' },
    ];
    const text = handoffTranscript(events, switched(true, 'Gemini CLI', 'OpenCode'));
    expect(text).toContain('Claude Agent: from claude');
    expect(text).toContain('Gemini CLI: from gemini');
  });

  it('lists the images and files the user attached with the paths of their saved copies', () => {
    const dir = path.join('C:', 'att', 's1');
    const events: AgentEvent[] = [
      {
        type: 'user_message', text: 'Read these', uuid: 'u1',
        images: [{ file: `${'a'.repeat(32)}.png`, name: 'shot.png' }],
        files: [{ file: `${'b'.repeat(32)}.pdf`, name: 'spec.pdf', mediaType: 'application/pdf', size: 10 }],
      },
      { type: 'tool_result', toolUseId: 't1', content: '', images: [{ file: `${'c'.repeat(32)}.png` }] },
    ];
    const text = handoffTranscript(events, switched(true), dir);

    expect(text).toContain([
      'Files the user attached, saved outside the project (open them by the absolute path given):',
      `- shot.png: ${path.join(dir, `${'a'.repeat(32)}.png`)}`,
      `- spec.pdf: ${path.join(dir, `${'b'.repeat(32)}.pdf`)}`,
    ].join('\n'));
    // A tool's screenshot isn't something the user attached.
    expect(text).not.toContain('c'.repeat(32));
  });

  it('leaves the list out without a folder to give paths in', () => {
    const events: AgentEvent[] = [{ type: 'user_message', text: 'x', files: [{ file: 'f', name: 'spec.pdf', mediaType: '', size: 1 }] }];
    expect(handoffTranscript(events, switched(true))).not.toContain('Files the user attached');
  });

  it('keeps the newest turns when the conversation is long', () => {
    const events: AgentEvent[] = Array.from({ length: 60 }, (_, i) => ({ type: 'user_message', text: `message ${i} ${'x'.repeat(1500)}` }));
    const text = handoffTranscript(events, switched(true));
    expect(text).toContain('[earlier messages left out]');
    expect(text).toContain('message 59');
    expect(text).not.toContain('message 0 ');
    expect(text.length).toBeLessThan(HANDOFF_MAX_CHARS + 2_000);
  });
});

describe('eventsSinceAgentChange', () => {
  it('keeps only what came after the last switch, for background tasks on the new agent', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: 'private to claude' },
      switched(false),
      { type: 'user_message', text: 'for gemini' },
    ];
    expect(eventsSinceAgentChange(events)).toEqual([{ type: 'user_message', text: 'for gemini' }]);
    expect(eventsSinceAgentChange(events.slice(0, 1))).toEqual(events.slice(0, 1));
    expect(JSON.stringify(goalInputFromEvents(events))).not.toContain('private to claude');
  });
});
