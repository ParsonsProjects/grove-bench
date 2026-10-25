import { describe, it, expect } from 'vitest';
import { ruleTotals, grownRules, missingFiles } from './check-lint-suppressions.mjs';

const list = (entries) => Object.fromEntries(
  Object.entries(entries).map(([file, rules]) => [
    file,
    Object.fromEntries(Object.entries(rules).map(([rule, count]) => [rule, { count }])),
  ]),
);

describe('ruleTotals', () => {
  it('adds up each rule across files', () => {
    expect(ruleTotals(list({
      'a.ts': { 'no-undef': 2, 'prefer-const': 1 },
      'b.ts': { 'no-undef': 3 },
    }))).toEqual({ 'no-undef': 5, 'prefer-const': 1 });
  });

  it('is empty for an empty list', () => {
    expect(ruleTotals({})).toEqual({});
  });
});

describe('grownRules', () => {
  const baseEntries = { 'a.ts': { 'no-undef': 2 }, 'b.ts': { 'prefer-const': 1 } };
  const base = list(baseEntries);

  it('reports a rule with more errors listed', () => {
    const head = list({ 'a.ts': { 'no-undef': 3 }, 'b.ts': { 'prefer-const': 1 } });
    expect(grownRules(base, head)).toEqual([{ rule: 'no-undef', base: 2, head: 3 }]);
  });

  it('reports a rule the base has no errors listed for', () => {
    const head = list({ 'a.ts': { 'no-undef': 2, 'no-var': 1 }, 'b.ts': { 'prefer-const': 1 } });
    expect(grownRules(base, head)).toEqual([{ rule: 'no-var', base: 0, head: 1 }]);
  });

  it('reports a new file that adds to a rule', () => {
    const head = list({ ...baseEntries, 'c.ts': { 'prefer-const': 1 } });
    expect(grownRules(base, head)).toEqual([{ rule: 'prefer-const', base: 1, head: 2 }]);
  });

  it('passes a renamed file whose entry moved with it', () => {
    const head = list({ 'renamed.ts': { 'no-undef': 2 }, 'b.ts': { 'prefer-const': 1 } });
    expect(grownRules(base, head)).toEqual([]);
  });

  it('passes a list that shrank', () => {
    expect(grownRules(base, list({ 'a.ts': { 'no-undef': 1 } }))).toEqual([]);
  });
});

describe('missingFiles', () => {
  it('lists the files that are gone, sorted', () => {
    const suppressions = list({ 'z.ts': { 'no-undef': 1 }, 'here.ts': { 'no-undef': 1 }, 'a.ts': { 'no-var': 1 } });
    expect(missingFiles(suppressions, (file) => file === 'here.ts')).toEqual(['a.ts', 'z.ts']);
  });

  it('is empty when every file exists', () => {
    expect(missingFiles(list({ 'a.ts': { 'no-undef': 1 } }), () => true)).toEqual([]);
  });
});
