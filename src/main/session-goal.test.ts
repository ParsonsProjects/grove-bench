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
  MAX_USER_GOAL_LENGTH,
} from './session-goal.js';
import { buildContentBlock } from '../shared/prompt-text.js';
import type { AgentAdapter } from './adapters/types.js';
import type { AgentEvent } from '../shared/types.js';

function makeAdapter(generateText?: (sys: string, user: string, opts?: any) => Promise<string>): AgentAdapter {
  return {
    id: 'test',
    displayName: 'Test Agent',
    ...(generateText ? { generateText } : {}),
  } as unknown as AgentAdapter;
}

describe('goalInputFromEvents', () => {
  it('collects real user messages in order and keeps the latest reply', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: '/model opus' },
      { type: 'user_message', text: 'Add CSV export to reports' },
      { type: 'assistant_text', text: 'Looking at the reports page.', uuid: 'a1' },
      { type: 'user_message', text: '   ' },
      { type: 'assistant_text', text: 'Done: CSV export added.', uuid: 'a2' },
      { type: 'user_message', text: 'Also add Excel' },
      { type: 'assistant_text', text: '   ', uuid: 'a3' },
    ];

    expect(goalInputFromEvents(events)).toEqual({
      prompts: ['Add CSV export to reports', 'Also add Excel'],
      reply: 'Done: CSV export added.',
    });
  });

  it('shows attached files as a name label, not their content', () => {
    const sent = `${buildContentBlock('file', 'src/a.ts', 'const a = 1;')}\n\nFix this`;
    const { prompts } = goalInputFromEvents([{ type: 'user_message', text: sent }]);
    expect(prompts).toEqual(['[src/a.ts] Fix this']);
  });

  it('has no prompts or reply for an empty history', () => {
    expect(goalInputFromEvents([])).toEqual({ prompts: [], reply: null });
  });
});

describe('buildGoalPrompt', () => {
  it('fences the messages and the reply off as data', () => {
    const prompt = buildGoalPrompt({ prompts: ['Fix the login bug'], reply: 'Fixed it.' });
    expect(prompt).toContain('<message>\nFix the login bug\n</message>');
    expect(prompt).toContain('<reply>\nFixed it.\n</reply>');
    expect(prompt).toMatch(/do not answer them/);
    expect(prompt.trim().endsWith('Write the goal for this conversation.')).toBe(true);
  });

  it('leaves the reply out when there is none', () => {
    expect(buildGoalPrompt({ prompts: ['Fix it'], reply: null })).not.toContain('<reply>');
  });

  it('keeps only the end of a long reply', () => {
    const reply = `${'a'.repeat(3_000)}THE END`;
    const prompt = buildGoalPrompt({ prompts: ['x'], reply });
    expect(prompt).toContain('THE END');
    expect(prompt).not.toContain('a'.repeat(2_500));
  });

  it('keeps the first message and the most recent ones when they do not all fit', () => {
    const prompts = ['FIRST task', ...Array.from({ length: 20 }, (_, i) => `msg ${i} ${'x'.repeat(900)}`), 'LATEST change'];
    const prompt = buildGoalPrompt({ prompts, reply: null });
    expect(prompt).toContain('FIRST task');
    expect(prompt).toContain('LATEST change');
    expect(prompt).toMatch(/\(\d+ earlier messages left out\)/);
    expect(prompt).not.toContain('msg 0 ');
    expect(prompt.length).toBeLessThan(10_000);
  });

  it('caps one long message', () => {
    const prompt = buildGoalPrompt({ prompts: ['start', 'y'.repeat(5_000)], reply: null });
    expect(prompt).toContain('... (truncated)');
    expect(prompt).not.toContain('y'.repeat(1_001));
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
    const goal = await generateGoal({ prompts: ['Add CSV export'], reply: 'Done.' }, makeAdapter(generateText), '/wt');

    expect(goal).toBe('Add CSV export');
    expect(generateText).toHaveBeenCalledWith(
      GOAL_SYSTEM_PROMPT,
      expect.stringContaining('Add CSV export'),
      expect.objectContaining({ cwd: '/wt', model: 'small-model' }),
    );
  });

  it('throws for an agent that cannot generate text', async () => {
    await expect(generateGoal({ prompts: ['x'], reply: null }, makeAdapter(), '/wt'))
      .rejects.toThrow('does not support text generation');
  });

  it('throws when there is nothing to summarise, without asking the agent', async () => {
    const generateText = vi.fn(async () => 'x');
    await expect(generateGoal({ prompts: [], reply: 'hi' }, makeAdapter(generateText), '/wt'))
      .rejects.toThrow('no messages');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('throws on an empty answer', async () => {
    await expect(generateGoal({ prompts: ['x'], reply: null }, makeAdapter(async () => '   '), '/wt'))
      .rejects.toThrow('empty goal');
  });
});
