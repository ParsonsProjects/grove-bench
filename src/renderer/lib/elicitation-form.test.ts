import { describe, it, expect } from 'vitest';
import { elicitationFields, elicitationContent, initialElicitationValues } from './elicitation-form.js';

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Your name', minLength: 2 },
    email: { type: 'string', format: 'email' },
    count: { type: 'integer', minimum: 1, maximum: 5, default: 2 },
    confirm: { type: 'boolean', description: 'Go ahead?' },
    color: { type: 'string', enum: ['r', 'g'], enumNames: ['Red', 'Green'] },
    size: { type: 'string', oneOf: [{ const: 's', title: 'Small' }, { const: 'l', title: 'Large' }] },
    tags: { type: 'array', items: { type: 'string', enum: ['a', 'b', 'c'] }, maxItems: 2 },
    nested: { type: 'object', properties: {} },
  },
  required: ['name', 'color'],
};

describe('elicitationFields()', () => {
  it('maps every spec field type and flags the rest', () => {
    const { fields, unsupported } = elicitationFields(schema);
    expect(fields.map((f) => [f.key, f.kind])).toEqual([
      ['name', 'text'], ['email', 'text'], ['count', 'number'], ['confirm', 'boolean'],
      ['color', 'select'], ['size', 'select'], ['tags', 'multiselect'],
    ]);
    expect(unsupported).toEqual(['nested']);
    expect(fields[0]).toMatchObject({ label: 'Your name', required: true });
    expect(fields[1]).toMatchObject({ inputType: 'email', required: false });
    expect(fields.find((f) => f.key === 'color')).toMatchObject({ options: [{ value: 'r', label: 'Red' }, { value: 'g', label: 'Green' }] });
    expect(fields.find((f) => f.key === 'size')).toMatchObject({ options: [{ value: 's', label: 'Small' }, { value: 'l', label: 'Large' }] });
  });

  it('handles a missing schema', () => {
    expect(elicitationFields(undefined)).toEqual({ fields: [], unsupported: [] });
  });
});

describe('elicitationContent()', () => {
  const { fields } = elicitationFields(schema);

  it('starts from defaults', () => {
    expect(initialElicitationValues(fields)).toMatchObject({ count: '2', confirm: false, tags: [], name: '' });
  });

  it('builds typed content and drops empty optional fields', () => {
    const values = { ...initialElicitationValues(fields), name: ' Ada ', color: 'g', tags: ['a'] };
    expect(elicitationContent(fields, values)).toEqual({
      content: { name: 'Ada', count: 2, confirm: false, color: 'g', tags: ['a'] },
    });
  });

  it('reports required, range and length problems', () => {
    const values = { ...initialElicitationValues(fields), name: 'A', count: '9', tags: ['a', 'b', 'c'] };
    expect(elicitationContent(fields, values)).toEqual({
      errors: { name: 'At least 2 characters', count: 'Must be at most 5', color: 'Required', tags: 'Pick at most 2' },
    });
  });

  it('accepts the numbers a bound number input holds', () => {
    const base = { ...initialElicitationValues(fields), name: 'Ada', color: 'r' };
    expect(elicitationContent(fields, { ...base, count: 4 })).toMatchObject({ content: { count: 4 } });
    expect(elicitationContent(fields, { ...base, count: 0 })).toEqual({ errors: { count: 'Must be at least 1' } });
    // Cleared input: null, and count is optional
    expect(elicitationContent(fields, { ...base, count: null })).not.toHaveProperty('content.count');
  });

  it('rejects non-integers for integer fields', () => {
    const values = { ...initialElicitationValues(fields), name: 'Ada', color: 'r', count: '1.5' };
    expect(elicitationContent(fields, values)).toEqual({ errors: { count: 'Enter a whole number' } });
  });
});
