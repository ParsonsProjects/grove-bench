import { describe, it, expect } from 'vitest';
import { defaultModelChoices, DEFAULT_MODEL_VALUE } from './model-choices.js';

const models = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
];

describe('defaultModelChoices()', () => {
  it('puts Default first, named after the model new conversations use', () => {
    expect(defaultModelChoices(models, '')).toEqual([
      { value: DEFAULT_MODEL_VALUE, label: 'Default (Opus 5.5)' },
      { value: 'claude-opus-5-5', label: 'Opus 5.5' },
      { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    ]);
  });

  it('adds nothing extra when the saved model is in the list', () => {
    expect(defaultModelChoices(models, 'claude-sonnet-4-6')).toHaveLength(3);
  });

  it('keeps a saved model that is not in the list', () => {
    const choices = defaultModelChoices(models, 'claude-old-model');
    expect(choices.at(-1)).toEqual({ value: 'claude-old-model', label: 'claude-old-model (custom)' });
  });

  it('does not mark the saved model custom before the list has loaded', () => {
    expect(defaultModelChoices([], 'claude-opus-5-5')).toEqual([
      { value: DEFAULT_MODEL_VALUE, label: 'Default' },
    ]);
  });

  it('names a given default model instead of the first one', () => {
    expect(defaultModelChoices(models, '', 'claude-sonnet-4-6')[0]).toEqual({ value: DEFAULT_MODEL_VALUE, label: 'Default (Sonnet 4.6)' });
    // A default the list doesn't know is shown by its id.
    expect(defaultModelChoices(models, '', 'claude-mystery')[0].label).toBe('Default (claude-mystery)');
    // Unknown default (the agent picks): no model named.
    expect(defaultModelChoices(models, '', null)[0].label).toBe('Default');
  });
});
