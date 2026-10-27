import { describe, it, expect } from 'vitest';
import { WORKTREE_FOLDER_MAX_LENGTH, worktreeFolderError, worktreeFolderTooLong } from './worktree-folder.js';

describe('worktreeFolderError', () => {
  it('takes an empty folder (the data folder) and full paths', () => {
    for (const folder of ['', '   ', 'D:\\wt', 'D:/wt', 'd:\\', '\\\\server\\share\\wt', '/home/me/wt']) {
      expect(worktreeFolderError(folder)).toBeNull();
    }
  });

  it('refuses a path that depends on where Grove started', () => {
    for (const folder of ['wt', '.\\wt', '..\\wt', 'D:wt', '\\\\server']) {
      expect(worktreeFolderError(folder)).toBe('Use a full path, such as D:\\worktrees.');
    }
  });
});

describe('worktreeFolderTooLong', () => {
  it('flags a folder longer than the default one usually is', () => {
    expect(worktreeFolderTooLong('D:\\wt')).toBe(false);
    expect(worktreeFolderTooLong(`D:\\${'a'.repeat(WORKTREE_FOLDER_MAX_LENGTH - 3)}`)).toBe(false);
    expect(worktreeFolderTooLong(`D:\\${'a'.repeat(WORKTREE_FOLDER_MAX_LENGTH - 2)}`)).toBe(true);
  });
});
