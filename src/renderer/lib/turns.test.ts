import { describe, it, expect } from 'vitest';
import {
  foldsByDefault,
  formatTurnTime,
  groupTurns,
  isWorkStep,
  lineChanges,
  retryLinks,
  showsImagesFolded,
  tallyTurn,
  turnStatus,
  turnViewMessages,
  type Turn,
} from './turns.js';
import type { ChatMessage } from '../stores/messages.svelte.js';

const user = (id: string, extra: object = {}): ChatMessage => ({ kind: 'user', id, text: `prompt ${id}`, ...extra });
const text = (id: string): ChatMessage => ({ kind: 'text', id, text: `text ${id}`, uuid: '' });
const thinking = (id: string): ChatMessage => ({ kind: 'thinking', id, thinking: 'hmm' });
const result = (id: string, isError = false): ChatMessage => ({ kind: 'result', id, subtype: 'success', isError, durationMs: 1000 });
function tool(id: string, toolName: string, toolInput: object, extra: object = {}): ChatMessage {
  return { kind: 'tool_call', id, toolName, toolInput, toolUseId: `tu-${id}`, uuid: '', pending: false, result: 'ok', ...extra };
}
const bash = (id: string, command: string, isError = false) => tool(id, 'Bash', { command }, isError ? { isError: true } : {});

describe('turnViewMessages', () => {
  it('keeps all of each turn, and before the first prompt only what Summary shows', () => {
    const thread = [thinking('t0'), text('a'), user('u1'), thinking('t1'), tool('r1', 'Read', { file_path: 'a.ts' })];
    expect(turnViewMessages(thread).map((m) => m.id)).toEqual(['a', 'u1', 't1', 'r1']);
  });

  it('leaves out a tool call that waits on a permission, as every view does', () => {
    const thread = [user('u1'), tool('b1', 'Bash', { command: 'ls' }, { awaitingPermission: true })];
    expect(turnViewMessages(thread).map((m) => m.id)).toEqual(['u1']);
  });
});

describe('groupTurns', () => {
  it('starts a turn at each prompt, keeps a steer inside it and takes its result', () => {
    const msgs = [text('pre'), user('u1'), text('a'), user('s1', { steer: true }), result('r1'), user('u2'), text('b')];
    const groups = groupTurns(msgs, false);
    expect(groups.map((g) => g.kind)).toEqual(['rows', 'turn', 'turn']);
    const first = (groups[1] as { turn: Turn }).turn;
    expect(first.id).toBe('u1');
    expect(first.msgs.map((m) => m.id)).toEqual(['a', 's1', 'r1']);
    expect(first.result?.id).toBe('r1');
    expect((groups[2] as { turn: Turn }).turn.result).toBeUndefined();
  });

  it("opens with the rest of a turn whose prompt isn't drawn", () => {
    const groups = groupTurns([text('a'), result('r1'), user('u2')], true);
    const first = (groups[0] as { turn: Turn }).turn;
    expect(first.id).toBe('continued:a');
    expect(first.prompt).toBeUndefined();
    expect(first.result?.id).toBe('r1');
  });
});

describe('turnStatus', () => {
  const turn = (msgs: ChatMessage[]): Turn => ({ id: 'u', msgs, result: msgs.find((m) => m.kind === 'result') });
  const waiting: ChatMessage = { kind: 'permission', id: 'p', requestId: 'r', toolName: 'Bash', toolInput: {}, toolUseId: 'tu', resolved: false };

  it('is working or waiting while live', () => {
    expect(turnStatus(turn([text('a')]), true)).toBe('working');
    expect(turnStatus(turn([text('a'), waiting]), true)).toBe('attention');
  });

  it('is done, failed or ended once over', () => {
    expect(turnStatus(turn([result('r')]), false)).toBe('done');
    expect(turnStatus(turn([result('r', true)]), false)).toBe('error');
    expect(turnStatus(turn([{ kind: 'error', id: 'e', text: 'API error' }]), false)).toBe('error');
    expect(turnStatus(turn([text('a')]), false)).toBe('ended');
  });

  it('goes by the result when there is one, not an error note along the way', () => {
    const note: ChatMessage = { kind: 'error', id: 'e', text: 'Checkpoint could not be captured for this message' };
    expect(turnStatus(turn([note, text('a'), result('r')]), false)).toBe('done');
  });
});

describe('isWorkStep', () => {
  const notes = new Set(['note']);

  it('folds tool calls, thinking, notes, answered permissions and plain status lines', () => {
    expect(isWorkStep(tool('r', 'Read', { file_path: 'a' }), notes)).toBe(true);
    expect(isWorkStep(thinking('t'), notes)).toBe(true);
    expect(isWorkStep(text('note'), notes)).toBe(true);
    expect(isWorkStep({ kind: 'permission', id: 'p', requestId: 'r', toolName: 'Bash', toolInput: {}, toolUseId: 'tu', resolved: true }, notes)).toBe(true);
    expect(isWorkStep({ kind: 'system', id: 's', text: 'Compacted' }, notes)).toBe(true);
  });

  it('keeps the answer, what waits for you, warnings, steers and subagents in view', () => {
    expect(isWorkStep(text('answer'), notes)).toBe(false);
    expect(isWorkStep({ kind: 'permission', id: 'p', requestId: 'r', toolName: 'Bash', toolInput: {}, toolUseId: 'tu', resolved: false }, notes)).toBe(false);
    expect(isWorkStep({ kind: 'system', id: 's', text: 'No sandbox', level: 'warning' }, notes)).toBe(false);
    expect(isWorkStep(user('s', { steer: true }), notes)).toBe(false);
    expect(isWorkStep(tool('a', 'Agent', { description: 'Look', subagent_type: 'Explore' }), notes)).toBe(false);
  });

  it('keeps tools that may act outside the project in view, as Summary did', () => {
    expect(isWorkStep(tool('j', 'mcp__jira__create_issue', { title: 'Bug' }), notes)).toBe(false);
    expect(isWorkStep(tool('f', 'mcp__grove-followups__followup_add', { title: 'Later' }), notes)).toBe(false);
    expect(isWorkStep(tool('m', 'mcp__grove-memory__memory_read', {}), notes)).toBe(true);
  });

  it("shows a tool's images, and an image file it wrote, while its work is folded", () => {
    expect(showsImagesFolded(tool('s', 'screenshot', {}, { images: [{ file: 'a.png', mediaType: 'image/png' }] }))).toBe(true);
    expect(showsImagesFolded(tool('w', 'Write', { file_path: 'chart.svg', content: '<svg/>' }))).toBe(true);
    expect(showsImagesFolded(tool('f', 'Write', { file_path: 'chart.svg', content: '<svg/>' }, { isError: true }))).toBe(false);
    expect(showsImagesFolded(tool('r', 'Read', { file_path: 'a' }))).toBe(false);
  });

  it('counts any text as a step while the turn runs', () => {
    expect(isWorkStep(text('answer'), notes, true)).toBe(true);
    expect(isWorkStep(text('answer'), notes, false)).toBe(false);
  });
});

describe('retryLinks', () => {
  it('links a failed command to the same command passing later, and back', () => {
    const links = retryLinks([bash('b1', 'npm test'), bash('f1', 'npm test -- auth', true), bash('b2', 'ls'), bash('p1', ' npm test -- auth ')]);
    expect(links.get('f1')).toEqual({ kind: 'passed', to: 'p1' });
    expect(links.get('p1')).toEqual({ kind: 'retry-of', to: 'f1' });
    expect(links.has('b1')).toBe(false);
  });

  it('links every failure before the pass, and the pass to the last of them', () => {
    const links = retryLinks([bash('f1', 'make', true), bash('f2', 'make', true), bash('p1', 'make')]);
    expect(links.get('f1')).toEqual({ kind: 'passed', to: 'p1' });
    expect(links.get('f2')).toEqual({ kind: 'passed', to: 'p1' });
    expect(links.get('p1')).toEqual({ kind: 'retry-of', to: 'f2' });
  });

  it("doesn't link a failure that never passed, or a run still going", () => {
    const links = retryLinks([bash('f1', 'make', true), tool('p1', 'Bash', { command: 'make' }, { pending: true, result: undefined })]);
    expect(links.size).toBe(0);
  });
});

describe('tallyTurn', () => {
  it('counts files read, searches, edits with their lines, commands and failures', () => {
    const msgs = [
      thinking('t1'),
      tool('r1', 'Read', { file_path: 'a.ts' }),
      tool('r2', 'Read', { file_path: 'a.ts' }),
      tool('r3', 'Read', { file_path: 'b.ts' }),
      tool('g1', 'Grep', { pattern: 'x' }),
      tool('e1', 'Edit', { file_path: 'a.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nB2\nc' }),
      tool('e2', 'Write', { file_path: 'new.ts', content: 'one\ntwo\n' }),
      bash('f1', 'npm test', true),
      bash('p1', 'npm test'),
      bash('f2', 'npm run lint', true),
      tool('w1', 'WebFetch', { url: 'https://example.com' }),
      tool('ag', 'Agent', { description: 'Look', subagent_type: 'Explore' }),
    ];
    const t = tallyTurn(msgs, retryLinks(msgs));
    expect(t.filesRead).toBe(2);
    expect(t.searches).toBe(1);
    expect([...t.edits]).toEqual([['a.ts', { add: 2, del: 1 }], ['new.ts', { add: 2, del: 0 }]]);
    expect([t.add, t.del]).toEqual([4, 1]);
    expect([t.commands, t.failed, t.passedOnRetry]).toEqual([3, 2, 1]);
    expect(t.other).toBe(1);
  });

  it("doesn't count reads, searches or edits that failed, were denied or haven't finished", () => {
    const msgs = [
      tool('e1', 'Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }, { isError: true, result: 'String to replace not found' }),
      tool('e2', 'Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' }),
      tool('w1', 'Write', { file_path: 'denied.ts', content: 'z' }, { isError: true, result: 'Permission denied' }),
      tool('e3', 'Edit', { file_path: 'b.ts', old_string: 'a', new_string: 'b' }, { pending: true, result: undefined }),
      tool('r1', 'Read', { file_path: 'missing.ts' }, { isError: true }),
      tool('g1', 'Grep', { pattern: 'x' }, { pending: true, result: undefined }),
    ];
    const t = tallyTurn(msgs, retryLinks(msgs));
    expect([...t.edits]).toEqual([['a.ts', { add: 1, del: 1 }]]);
    expect([t.filesRead, t.searches]).toEqual([0, 0]);
  });
});

describe('lineChanges', () => {
  it('counts the lines a replacement adds and removes', () => {
    expect(lineChanges('a\nb\nc', 'a\nX\nc')).toEqual({ add: 1, del: 1 });
    expect(lineChanges('a\nc', 'a\nb\nc')).toEqual({ add: 1, del: 0 });
    expect(lineChanges('a\nb', '')).toEqual({ add: 0, del: 2 });
    expect(lineChanges('same', 'same')).toEqual({ add: 0, del: 0 });
  });

  it('counts a change in two places as just those lines', () => {
    const before = 'export function f() {\n  const x = rotate();\n  return x;\n}';
    const after = 'const cache = new Map();\nexport function f() {\n  const x = cached();\n  return x;\n}';
    expect(lineChanges(before, after)).toEqual({ add: 2, del: 1 });
  });

  it('counts a long replacement without diffing it', () => {
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const changed = [...long.slice(0, 10), 'new', ...long.slice(10)];
    expect(lineChanges(long.join('\n'), changed.join('\n'))).toEqual({ add: 1, del: 0 });
  });
});

describe('formatTurnTime', () => {
  it('reads as seconds, minutes and seconds, or hours and minutes', () => {
    expect(formatTurnTime(41_400)).toBe('41s');
    expect(formatTurnTime(192_000)).toBe('3m 12s');
    expect(formatTurnTime(3_900_000)).toBe('1h 5m');
  });
});

describe('foldsByDefault', () => {
  it('folds finished turns before the last two, never a live one', () => {
    expect([0, 1, 2, 3].map((i) => foldsByDefault(i, 4, 'done'))).toEqual([true, true, false, false]);
    expect(foldsByDefault(0, 4, 'working')).toBe(false);
    expect(foldsByDefault(0, 4, 'attention')).toBe(false);
    expect(foldsByDefault(0, 4, 'error')).toBe(true);
  });
});
