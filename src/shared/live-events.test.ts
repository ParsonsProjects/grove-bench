import { describe, it, expect } from 'vitest';
import { lastSystemInit, liveEventsMissingFrom, systemInfoOf } from './live-events.js';
import type { AgentEvent } from './types.js';

const status = (message: string): AgentEvent => ({ type: 'status', message });
const user = (text: string, uuid: string): AgentEvent => ({ type: 'user_message', text, uuid });

describe('liveEventsMissingFrom()', () => {
  it('drops live events the page already ends with (a new conversation\'s first events)', () => {
    const page = [status('Creating worktree…'), status('Starting agent…'), status('Connecting'), user('hi', 'u1')];
    const held = [status('Starting agent…'), status('Connecting'), user('hi', 'u1')];
    expect(liveEventsMissingFrom(page, held)).toEqual([]);
  });

  it('keeps live events logged after the page was read', () => {
    const page = [status('Connecting'), user('hi', 'u1')];
    const later: AgentEvent = { type: 'assistant_text', text: 'Hello', uuid: 'a1' };
    expect(liveEventsMissingFrom(page, [user('hi', 'u1'), later])).toEqual([later]);
  });

  it('keeps everything when the page has none of them', () => {
    const held = [status('Connecting'), user('hi', 'u1')];
    expect(liveEventsMissingFrom([], held)).toEqual(held);
    expect(liveEventsMissingFrom([status('older')], held)).toEqual(held);
  });

  it('matches by position, so a repeat that came later is kept', () => {
    const page = [status('Retrying'), status('Connected')];
    const held = [status('Retrying'), status('Connected'), status('Retrying')];
    expect(liveEventsMissingFrom(page, held)).toEqual([status('Retrying')]);
  });

  it('drops stale transient events, which are never in a page', () => {
    const held: AgentEvent[] = [{ type: 'activity', activity: 'thinking' }, { type: 'partial_text', text: 'He' }, user('hi', 'u1')];
    expect(liveEventsMissingFrom([user('hi', 'u1')], held)).toEqual([]);
  });
});

describe('lastSystemInit() and systemInfoOf()', () => {
  const init = (model: string): AgentEvent => ({ type: 'system_init', sessionId: 's', model, tools: [], skills: ['review'], mcpServers: [{ name: 'linear', status: 'connected' }] });

  it("gives the agent's newest report, or none in a history without one", () => {
    expect(lastSystemInit([init('old'), user('a', 'u1'), init('newest'), user('b', 'u2')])).toEqual(init('newest'));
    expect(lastSystemInit([user('a', 'u1')])).toBeUndefined();
  });

  it('reads what a report says the agent has, with nothing for what it leaves out', () => {
    expect(systemInfoOf({ type: 'system_init', sessionId: 's', model: 'm', tools: ['Read'], mcpServers: [{ name: 'linear', status: 'connected' }] })).toEqual({
      tools: ['Read'], agents: [], skills: [], slashCommands: [], mcpServers: [{ name: 'linear', status: 'connected' }],
    });
  });
});
