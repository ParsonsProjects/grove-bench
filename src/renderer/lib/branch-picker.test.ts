import { describe, it, expect } from 'vitest';
import { branchPickerRows } from './branch-picker.js';

const BRANCHES = ['main', 'feat/api-auth', 'feat/ui', 'fix/api-timeout'];

describe('branchPickerRows', () => {
  it('lists every branch with the current one first when the query is empty', () => {
    expect(branchPickerRows(BRANCHES, '', 'feat/ui')).toEqual({
      matches: ['feat/ui', 'main', 'feat/api-auth', 'fix/api-timeout'],
      createName: null,
    });
  });

  it('matches every space-separated token, ignoring case', () => {
    expect(branchPickerRows(BRANCHES, 'API feat', 'main').matches).toEqual(['feat/api-auth']);
    expect(branchPickerRows(BRANCHES, 'api', 'main').matches).toEqual(['feat/api-auth', 'fix/api-timeout']);
  });

  it('offers to create the typed name when no branch has it exactly', () => {
    expect(branchPickerRows(BRANCHES, ' feat/api ', 'main').createName).toBe('feat/api');
  });

  it('does not offer to create an existing branch', () => {
    expect(branchPickerRows(BRANCHES, 'feat/ui', 'main').createName).toBeNull();
  });

  it('does not offer names git would reject outright', () => {
    expect(branchPickerRows(BRANCHES, 'two words', 'main').createName).toBeNull();
    expect(branchPickerRows(BRANCHES, '-f', 'main').createName).toBeNull();
  });
});
