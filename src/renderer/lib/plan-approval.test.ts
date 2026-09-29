import { describe, it, expect } from 'vitest';
import { suggestedApproval } from './plan-approval.js';

describe('suggestedApproval', () => {
  it('has no choice when the agent suggested nothing', () => {
    expect(suggestedApproval(undefined)).toBeNull();
    expect(suggestedApproval([])).toBeNull();
  });

  it('names the mode a suggested mode switch lands in', () => {
    expect(suggestedApproval([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])?.label).toBe('Approve, auto-accept edits');
    expect(suggestedApproval([{ type: 'setMode', mode: 'default', destination: 'session' }])?.label).toBe('Approve, ask before edits');
  });

  it('uses the raw mode name for a mode it has no words for', () => {
    expect(suggestedApproval([{ type: 'setMode', mode: 'dontAsk' }])?.label).toBe('Approve in dontAsk mode');
  });

  it('falls back to a general label for other suggestions', () => {
    expect(suggestedApproval([{ type: 'addRules', rules: [], behavior: 'allow', destination: 'session' }])?.label)
      .toBe('Approve with suggested permissions');
  });
});
