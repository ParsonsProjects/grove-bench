import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./background-tasks.js', () => ({ backgroundModelFor: () => 'small-model' }));
vi.mock('./logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const settingsMock = vi.hoisted(() => ({ promptSuggestions: true }));
vi.mock('./settings.js', () => ({ getSettings: () => settingsMock }));

import {
  suggestionInputFromEvents,
  buildSuggestionPrompt,
  cleanSuggestion,
  SessionPromptSuggestions,
  SUGGESTION_SYSTEM_PROMPT,
  MAX_SUGGESTION_LENGTH,
} from './session-prompt-suggestions.js';
import type { AgentEvent } from '../shared/types.js';
import type { AgentAdapter } from './adapters/types.js';
import type { ManagedSession } from './session-types.js';

const user = (text: string): AgentEvent => ({ type: 'user_message', text });
const reply = (text: string, uuid = text): AgentEvent => ({ type: 'assistant_text', text, uuid });
const result = (isError = false) => ({ type: 'result', isError } as Extract<AgentEvent, { type: 'result' }>);

describe('suggestionInputFromEvents', () => {
  it('takes the latest three typed messages and the latest reply', () => {
    const events = [
      user('Add CSV export'),
      reply('Done.'),
      user('/compact'),
      user('Also Excel'),
      reply('Added.'),
      user('Fix the header row'),
      reply('Fixed.'),
      user('Now the footer'),
      reply('Footer fixed. Want me to run the tests?'),
    ];
    expect(suggestionInputFromEvents(events)).toEqual({
      prompts: ['Also Excel', 'Fix the header row', 'Now the footer'],
      reply: 'Footer fixed. Want me to run the tests?',
    });
  });

  it('reads only the part since the last agent switch', () => {
    const events = [
      user('Old agent work'),
      reply('Old reply'),
      { type: 'agent_changed', from: 'a', to: 'b' } as unknown as AgentEvent,
      user('New agent work'),
      reply('New reply'),
    ];
    expect(suggestionInputFromEvents(events)).toEqual({ prompts: ['New agent work'], reply: 'New reply' });
  });
});

describe('buildSuggestionPrompt', () => {
  it('fences the messages and keeps the end of a long reply', () => {
    const long = `${'x'.repeat(5_000)}Shall I commit?`;
    const prompt = buildSuggestionPrompt({ prompts: ['Fix it', 'Thanks'], reply: long });
    expect(prompt).toContain('<message>\nFix it\n</message>\n<message>\nThanks\n</message>');
    expect(prompt).toContain('Shall I commit?\n</reply>');
    expect(prompt).not.toContain('x'.repeat(3_001));
    expect(prompt.endsWith('Write the message the user is most likely to send next.')).toBe(true);
  });

  it('leaves the reply out when there is none', () => {
    expect(buildSuggestionPrompt({ prompts: ['Fix it'], reply: null })).not.toContain('<reply>');
  });
});

describe('cleanSuggestion', () => {
  it('returns a plain one-line message', () => {
    expect(cleanSuggestion('Run the tests')).toBe('Run the tests');
    expect(cleanSuggestion('  Run the tests\n\nThis checks the fix.')).toBe('Run the tests');
  });

  it('takes off quotes, labels, fences and a lead-in line', () => {
    expect(cleanSuggestion('"Run the tests"')).toBe('Run the tests');
    expect(cleanSuggestion('Next message: Commit these changes')).toBe('Commit these changes');
    expect(cleanSuggestion('**Suggestion:** Commit')).toBe('Commit');
    expect(cleanSuggestion('```\nRun the tests\n```')).toBe('Run the tests');
    expect(cleanSuggestion('Here is the likely next message:\nYes, go ahead')).toBe('Yes, go ahead');
  });

  it('keeps quotes used inside the message', () => {
    expect(cleanSuggestion('Rename "foo" to "bar"')).toBe('Rename "foo" to "bar"');
  });

  it('offers nothing for NONE, empty or overlong replies', () => {
    expect(cleanSuggestion('NONE')).toBe('');
    expect(cleanSuggestion('None.')).toBe('');
    expect(cleanSuggestion('   ')).toBe('');
    expect(cleanSuggestion('a'.repeat(MAX_SUGGESTION_LENGTH + 1))).toBe('');
  });
});

describe('SessionPromptSuggestions', () => {
  const history = [user('Add CSV export'), reply('Done.'), user('Also Excel'), reply('Added. Run the tests?')];

  function makeSession(generateText?: AgentAdapter['generateText'], overrides: Partial<ManagedSession> = {}, nativeSuggestions = false): ManagedSession {
    return {
      id: 's1',
      worktreePath: '/wt',
      permissionMode: 'default',
      interrupting: false,
      eventHistory: [...history],
      adapter: {
        id: 'gemini',
        displayName: 'Gemini',
        capabilities: { promptSuggestions: nativeSuggestions },
        ...(generateText ? { generateText } : {}),
      },
      ...overrides,
    } as unknown as ManagedSession;
  }

  /** Let the request and its handlers run. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    settingsMock.promptSuggestions = true;
  });

  it('asks the agent on its background model and emits the suggestion', async () => {
    const generateText = vi.fn(async () => 'Run the tests');
    const emit = vi.fn();
    new SessionPromptSuggestions().afterTurn(makeSession(generateText), result(), emit, () => true);
    await settle();
    expect(generateText).toHaveBeenCalledWith(SUGGESTION_SYSTEM_PROMPT, expect.stringContaining('Also Excel'), expect.objectContaining({ cwd: '/wt', model: 'small-model' }));
    expect(emit).toHaveBeenCalledWith({ type: 'prompt_suggestion', suggestion: 'Run the tests' });
  });

  it('leaves an agent that makes its own suggestions alone', async () => {
    const generateText = vi.fn(async () => 'Run the tests');
    new SessionPromptSuggestions().afterTurn(makeSession(generateText, {}, true), result(), vi.fn(), () => true);
    await settle();
    expect(generateText).not.toHaveBeenCalled();
  });

  it.each([
    ['the setting is off', {}, false, () => { settingsMock.promptSuggestions = false; }],
    ['the turn failed', {}, true, () => {}],
    ['the user stopped the turn', { interrupting: true }, false, () => {}],
    ['the thread is in plan mode', { permissionMode: 'plan' }, false, () => {}],
    ['it is the thread\'s first turn', { eventHistory: [user('Add CSV export'), reply('Done.')] }, false, () => {}],
  ] as const)('does not ask when %s', async (_name, overrides, isError, setup) => {
    setup();
    const generateText = vi.fn(async () => 'Run the tests');
    new SessionPromptSuggestions().afterTurn(makeSession(generateText, overrides as Partial<ManagedSession>), result(isError), vi.fn(), () => true);
    await settle();
    expect(generateText).not.toHaveBeenCalled();
  });

  it('drops a suggestion that arrives once the thread is no longer idle', async () => {
    const emit = vi.fn();
    new SessionPromptSuggestions().afterTurn(makeSession(async () => 'Run the tests'), result(), emit, () => false);
    await settle();
    expect(emit).not.toHaveBeenCalled();
  });

  it('drops a suggestion when the thread\'s latest message changed meanwhile', async () => {
    const emit = vi.fn();
    let answer!: (text: string) => void;
    const session = makeSession(() => new Promise<string>((resolve) => { answer = resolve; }));
    new SessionPromptSuggestions().afterTurn(session, result(), emit, () => true);
    // A rewind cut the thread back to an earlier message.
    session.eventHistory = history.slice(0, 2);
    answer('Run the tests');
    await settle();
    expect(emit).not.toHaveBeenCalled();
  });

  it('cancels the request when a prompt is sent', async () => {
    const emit = vi.fn();
    let signal: AbortSignal | undefined;
    const generateText = vi.fn((_s: string, _u: string, opts?: { abortSignal?: AbortSignal }) => {
      signal = opts?.abortSignal;
      return new Promise<string>((_resolve, reject) => {
        opts?.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const suggestions = new SessionPromptSuggestions();
    suggestions.afterTurn(makeSession(generateText), result(), emit, () => true);
    suggestions.cancel('s1');
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it('stops asking a thread after two failures in a row', async () => {
    const generateText = vi.fn(async () => { throw new Error('agent not signed in'); });
    const suggestions = new SessionPromptSuggestions();
    const session = makeSession(generateText);
    for (let i = 0; i < 3; i++) {
      suggestions.afterTurn(session, result(), vi.fn(), () => true);
      await settle();
    }
    expect(generateText).toHaveBeenCalledTimes(2);
    // Forgetting the thread (closed) starts the count again.
    suggestions.forget('s1');
    suggestions.afterTurn(session, result(), vi.fn(), () => true);
    await settle();
    expect(generateText).toHaveBeenCalledTimes(3);
  });

  it('emits nothing for a NONE answer', async () => {
    const emit = vi.fn();
    new SessionPromptSuggestions().afterTurn(makeSession(async () => 'NONE'), result(), emit, () => true);
    await settle();
    expect(emit).not.toHaveBeenCalled();
  });
});
