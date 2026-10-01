import { describe, it, expect, vi } from 'vitest';

vi.mock('./background-tasks.js', () => ({ backgroundModelFor: () => 'small-model' }));

import {
  goalInputFromEvents,
  buildGoalPrompt,
  cleanGoal,
  cleanUserGoal,
  clampGoal,
  generateGoal,
  GOAL_SYSTEM_PROMPT,
  MAX_GOAL_LENGTH,
} from './session-goal.js';
import { buildContentBlock } from '../shared/prompt-text.js';
import { MAX_USER_GOAL_LENGTH, type AgentEvent } from '../shared/types.js';
import type { AgentAdapter } from './adapters/types.js';

function makeAdapter(generateText?: (sys: string, user: string, opts?: any) => Promise<string>): AgentAdapter {
  return {
    id: 'test',
    displayName: 'Test Agent',
    ...(generateText ? { generateText } : {}),
  } as unknown as AgentAdapter;
}

const user = (text: string): AgentEvent => ({ type: 'user_message', text });
const reply = (text: string, uuid = text): AgentEvent => ({ type: 'assistant_text', text, uuid });

describe('goalInputFromEvents', () => {
  it('collects real user messages in order, slash commands and empty ones skipped', () => {
    const events = [
      user('/model opus'),
      user('Add CSV export to reports'),
      reply('Looking at the reports page.'),
      user('   '),
      user('Also add Excel'),
    ];
    expect(goalInputFromEvents(events)).toMatchObject({
      prompts: ['Add CSV export to reports', 'Also add Excel'],
      skipped: 0,
    });
  });

  it('takes every text block of the latest turn that has text', () => {
    const events = [
      user('Audit the API'),
      reply('Old turn.'),
      user('Now fix what you found'),
      reply('Findings: two bugs.'),
      { type: 'tool_use_summary', summary: 'edited files', toolUseIds: [] } as AgentEvent,
      reply('Next steps: run the tests.'),
      user('Thanks'),
      reply('   '),
    ];
    expect(goalInputFromEvents(events).reply).toBe('Findings: two bugs.\n\nNext steps: run the tests.');
  });

  it('shows attached files as a name label, not their content', () => {
    const sent = `${buildContentBlock('file', 'src/a.ts', 'const a = 1;')}\n\nFix this`;
    expect(goalInputFromEvents([user(sent)]).prompts).toEqual(['[src/a.ts] Fix this']);
  });

  it('keeps the first message and the most recent ones that fit, and counts the rest', () => {
    const events = [
      user('FIRST task'),
      ...Array.from({ length: 20 }, (_, i) => user(`msg ${i} ${'x'.repeat(900)}`)),
      user('/compact'),
      user('LATEST change'),
    ];
    const { prompts, skipped } = goalInputFromEvents(events);
    expect(prompts[0]).toBe('FIRST task');
    expect(prompts.at(-1)).toBe('LATEST change');
    expect(prompts.some((p) => p.startsWith('msg 0 '))).toBe(false);
    // Every message is accounted for: kept, or counted as left out.
    expect(prompts.length - 2 + skipped).toBe(20);
    expect(prompts.join('').length).toBeLessThan(8_100);
  });

  it('caps long messages', () => {
    const { prompts } = goalInputFromEvents([user('z'.repeat(9_000)), user('y'.repeat(5_000))]);
    expect(prompts[0].length).toBeLessThan(4_100);
    expect(prompts[1]).toMatch(/^y{1000}\n\.\.\. \(truncated\)$/);
  });

  it('has no prompts or reply for an empty history', () => {
    expect(goalInputFromEvents([])).toEqual({ prompts: [], skipped: 0, reply: null });
  });
});

describe('buildGoalPrompt', () => {
  it('fences the messages and the reply off as data', () => {
    const prompt = buildGoalPrompt({ prompts: ['Fix the login bug'], skipped: 0, reply: 'Fixed it.' });
    expect(prompt).toContain('<message>\nFix the login bug\n</message>');
    expect(prompt).toContain('<reply>\nFixed it.\n</reply>');
    expect(prompt).toMatch(/do not answer them/);
    expect(prompt.trim().endsWith('Write the goal for this conversation.')).toBe(true);
  });

  it('says how many messages were left out, outside the fences', () => {
    const prompt = buildGoalPrompt({ prompts: ['first', 'latest'], skipped: 3, reply: null });
    expect(prompt).toContain('<message>\nfirst\n</message>\n(3 more messages left out here)\n<message>\nlatest\n</message>');
  });

  it('leaves the reply out when there is none', () => {
    expect(buildGoalPrompt({ prompts: ['Fix it'], skipped: 0, reply: null })).not.toContain('<reply>');
  });

  it('keeps only the end of a long reply', () => {
    const prompt = buildGoalPrompt({ prompts: ['x'], skipped: 0, reply: `${'a'.repeat(3_000)}THE END` });
    expect(prompt).toContain('THE END');
    expect(prompt).not.toContain('a'.repeat(2_500));
  });
});

describe('cleanGoal', () => {
  it('passes a plain goal through', () => {
    expect(cleanGoal('Add CSV export to the reports page')).toBe('Add CSV export to the reports page');
  });

  it('strips fences, labels, quotes and markdown', () => {
    expect(cleanGoal('```\nFix login\n```')).toBe('Fix login');
    expect(cleanGoal('Goal: Fix login')).toBe('Fix login');
    expect(cleanGoal('**Goal:** Fix login')).toBe('Fix login');
    expect(cleanGoal('"Fix login"')).toBe('Fix login');
    expect(cleanGoal('# Fix **login**')).toBe('Fix login');
    expect(cleanGoal('- Fix login')).toBe('Fix login');
  });

  it('drops a label or lead-in on its own line', () => {
    expect(cleanGoal('**Goal:**\n\nFix the login bug')).toBe('Fix the login bug');
    expect(cleanGoal('Here is the goal:\n\nAdd CSV export')).toBe('Add CSV export');
    expect(cleanGoal('## Goal\nShip dark mode')).toBe('Ship dark mode');
  });

  it('keeps names that look like markdown', () => {
    expect(cleanGoal('Add tests under src/__tests__/auth for the __init__.py loader'))
      .toBe('Add tests under src/__tests__/auth for the __init__.py loader');
    expect(cleanGoal('Lint src/**/*.ts and lib/**/*.js')).toBe('Lint src/**/*.ts and lib/**/*.js');
  });

  it('keeps backticks that are part of the goal', () => {
    expect(cleanGoal('Add a `--dry-run` flag to `deploy`')).toBe('Add a `--dry-run` flag to `deploy`');
    expect(cleanGoal('`npm test` should pass on CI')).toBe('`npm test` should pass on CI');
    expect(cleanGoal('`Fix login`')).toBe('Fix login');
  });

  it('keeps the first paragraph on one line', () => {
    expect(cleanGoal('Fix login\nfor SSO users\n\nI kept it short because...')).toBe('Fix login for SSO users');
  });

  it('caps a runaway goal at a word boundary', () => {
    const goal = cleanGoal(Array.from({ length: 100 }, () => 'word').join(' '));
    expect(goal.length).toBeLessThanOrEqual(MAX_GOAL_LENGTH);
    expect(goal.endsWith('word…')).toBe(true);
  });

  it('returns empty for empty output', () => {
    expect(cleanGoal('  \n ')).toBe('');
  });
});

describe('cleanUserGoal and clampGoal', () => {
  it('puts a typed goal on one trimmed line', () => {
    expect(cleanUserGoal('  Ship the\n new   sidebar ')).toBe('Ship the new sidebar');
    expect(cleanUserGoal('   ')).toBe('');
  });

  it('caps a typed goal', () => {
    expect(cleanUserGoal('z'.repeat(MAX_USER_GOAL_LENGTH + 50)).length).toBe(MAX_USER_GOAL_LENGTH);
  });

  it('leaves short text alone', () => {
    expect(clampGoal('short', 10)).toBe('short');
  });
});

describe('generateGoal', () => {
  it('asks the agent on its background model and cleans the answer', async () => {
    const generateText = vi.fn(async () => 'Goal: "Add CSV export"');
    const goal = await generateGoal({ prompts: ['Add CSV export'], skipped: 0, reply: 'Done.' }, makeAdapter(generateText), '/wt');

    expect(goal).toBe('Add CSV export');
    expect(generateText).toHaveBeenCalledWith(
      GOAL_SYSTEM_PROMPT,
      expect.stringContaining('Add CSV export'),
      expect.objectContaining({ cwd: '/wt', model: 'small-model' }),
    );
  });

  it('throws for an agent that cannot generate text', async () => {
    await expect(generateGoal({ prompts: ['x'], skipped: 0, reply: null }, makeAdapter(), '/wt'))
      .rejects.toThrow('does not support text generation');
  });

  it('throws when there is nothing to summarise, without asking the agent', async () => {
    const generateText = vi.fn(async () => 'x');
    await expect(generateGoal({ prompts: [], skipped: 0, reply: 'hi' }, makeAdapter(generateText), '/wt'))
      .rejects.toThrow('no messages');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('throws on an empty answer', async () => {
    await expect(generateGoal({ prompts: ['x'], skipped: 0, reply: null }, makeAdapter(async () => '   '), '/wt'))
      .rejects.toThrow('empty goal');
  });
});
