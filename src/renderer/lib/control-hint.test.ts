import { describe, it, expect } from 'vitest';
import { controlHint } from './control-hint.js';
import type { ControlDescriptor } from '../../shared/types.js';

const mode: ControlDescriptor = {
  id: 'permissionMode',
  label: 'Mode',
  default: 'default',
  options: [
    { value: 'default', label: 'Ask', description: 'Asks first' },
    { value: 'plan', label: 'Plan', description: 'Plans only' },
  ],
};
const effort: ControlDescriptor = {
  id: 'effort',
  label: 'Effort',
  default: 'high',
  options: [{ value: 'high', label: 'High', description: 'Deep reasoning' }, { value: 'low', label: 'Low' }],
};

describe('controlHint', () => {
  it('explains the current mode when nothing is hovered', () => {
    expect(controlHint([effort, mode], () => 'plan', null)).toEqual({ label: 'Plan', description: 'Plans only' });
  });

  it('falls back to the mode\'s default when no value is recorded', () => {
    expect(controlHint([mode], () => undefined, null)).toEqual({ label: 'Ask', description: 'Asks first' });
  });

  it('explains the hovered option instead, from any control', () => {
    expect(controlHint([mode, effort], () => 'default', effort.options[0])).toEqual({ label: 'High', description: 'Deep reasoning' });
  });

  it('keeps the mode line for a hovered option with no description', () => {
    expect(controlHint([mode, effort], () => 'default', effort.options[1])).toEqual({ label: 'Ask', description: 'Asks first' });
  });

  it('has nothing to say without a mode control', () => {
    expect(controlHint([effort], () => 'high', null)).toBeNull();
  });
});
