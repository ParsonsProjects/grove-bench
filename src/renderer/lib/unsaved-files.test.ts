import { describe, it, expect } from 'vitest';
import { unsavedFileCount } from './unsaved-files.js';
import type { GitStatusEntry } from '../../shared/types.js';

const e = (filePath: string, status: GitStatusEntry['status'], staged = false) => ({ filePath, status, staged }) as GitStatusEntry;

describe('unsavedFileCount', () => {
  it('counts a partly staged file once', () => {
    expect(unsavedFileCount([e('a.ts', 'modified', true), e('a.ts', 'modified'), e('b.ts', 'untracked')])).toBe(2);
  });

  it('leaves out the settings file Grove writes into every worktree', () => {
    expect(unsavedFileCount([e('.claude/settings.local.json', 'untracked')])).toBe(0);
    expect(unsavedFileCount([e('.claude\\settings.local.json', 'untracked')])).toBe(0);
  });

  it('still counts that file once someone has committed and changed it', () => {
    expect(unsavedFileCount([e('.claude/settings.local.json', 'modified')])).toBe(1);
  });
});
