import { describe, it, expect } from 'vitest';
import { CONTINUE_PROMPT, cutOffDivider, cutOffReasonText, openCutOff } from './cut-off.js';
import type { AgentEvent } from './types.js';

const prompt = (text = 'Run the tests'): AgentEvent => ({ type: 'user_message', text });
const cut: AgentEvent = { type: 'turn_cut_off', reason: 'update', at: 1_000 };
const exit: AgentEvent = { type: 'process_exit' };
const result: AgentEvent = { type: 'result', subtype: 'success', isError: false };

describe('openCutOff', () => {
  it('finds a cut-off turn nothing has answered, past the exit written after it', () => {
    expect(openCutOff([prompt(), cut, exit])).toEqual({ reason: 'update', at: 1_000 });
    expect(openCutOff([prompt(), cut])).toEqual({ reason: 'update', at: 1_000 });
  });

  it('is answered by a prompt, a dismissal, or a later turn that ended', () => {
    expect(openCutOff([prompt(), cut, exit, prompt(CONTINUE_PROMPT)])).toBeNull();
    expect(openCutOff([prompt(), cut, exit, { type: 'turn_cut_off_dismissed' }])).toBeNull();
    expect(openCutOff([prompt(), cut, exit, prompt(), result])).toBeNull();
  });

  it("isn't answered by a steer, or by a subagent's events", () => {
    expect(openCutOff([prompt(), cut, exit, { type: 'user_message', text: 'and this', steer: true }])).toEqual({ reason: 'update', at: 1_000 });
    expect(openCutOff([prompt(), cut, { type: 'result', subtype: 'success', isError: false, parentToolUseId: 't1' } as AgentEvent])).toEqual({ reason: 'update', at: 1_000 });
  });

  it('an exit of its own (a thread closed, an agent that died) ends the turn: nothing cut off', () => {
    expect(openCutOff([prompt(), exit])).toBeNull();
    expect(openCutOff([prompt(), exit], true)).toBeNull();
  });

  it('counts a turn left unfinished (a crash) only with no agent running', () => {
    const crashed = [prompt(), { type: 'assistant_text', text: 'Running them' } as AgentEvent];
    expect(openCutOff(crashed)).toBeNull();
    expect(openCutOff(crashed, true)).toEqual({ reason: 'unknown', inferred: true });
    expect(openCutOff([prompt(), result], true)).toBeNull();
    expect(openCutOff([], true)).toBeNull();
  });
});

describe('text', () => {
  it('says why, with the time when known', () => {
    expect(cutOffReasonText('update')).toBe('Grove Bench closed to install an update, while the agent was still working.');
    expect(cutOffReasonText('quit')).toBe('Grove Bench was closed while the agent was still working.');
    expect(cutOffReasonText('windows')).toBe('Windows shut down or signed out while the agent was still working.');
    expect(cutOffReasonText('unknown')).toBe('Grove Bench stopped before the agent finished.');
    expect(cutOffReasonText('quit', new Date(2026, 0, 1, 14, 5).getTime())).toMatch(/^Grove Bench was closed at \d{1,2}:05/);
    expect(cutOffDivider('update')).toBe('Cut off when Grove Bench closed to install an update');
    expect(cutOffDivider('unknown')).toBe('Cut off when Grove Bench stopped');
  });
});
