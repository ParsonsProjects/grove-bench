import { describe, it, expect } from 'vitest';
import Fuse from 'fuse.js';
import { toEntries, searchFiles, initialItems, moveSelection, type FileEntry } from './file-picker.js';

const paths = (r: { items: { entry: FileEntry }[] }) => r.items.map((i) => i.entry.path);

const files = toEntries([
  '.github/', 'src/', 'src/main/', 'src/renderer/',
  '.gitignore', 'README.md', 'package.json',
  'src/main/git.ts', 'src/main/git.test.ts', 'src/main/git-status-parser.ts',
  'src/renderer/components/GitNotice.svelte', 'src/main/ipc.ts',
]);
const fuse = new Fuse(files, { keys: ['filename', 'path'], threshold: 0.4, ignoreLocation: true });

describe('searchFiles', () => {
  it('ranks an exact name first, then name prefixes, then substrings', () => {
    const r = paths(searchFiles(files, 'git', fuse));
    expect(r[0]).toBe('src/main/git.ts');
    // Source before tests, shorter names first.
    expect(r.indexOf('src/main/git-status-parser.ts')).toBeLessThan(r.indexOf('src/main/git.test.ts'));
    // `.github/` only contains "git": after every name that starts with it.
    expect(r.indexOf('.github/')).toBeGreaterThan(r.indexOf('src/renderer/components/GitNotice.svelte'));
  });

  it('matches paths when the query has a folder in it', () => {
    expect(paths(searchFiles(files, 'main/ipc', fuse))[0]).toBe('src/main/ipc.ts');
  });

  it('pads with fuzzy matches for typos', () => {
    expect(paths(searchFiles(files, 'packge', fuse))).toContain('package.json');
  });

  it('counts the matches it doesn\'t show', () => {
    const many = toEntries(Array.from({ length: 60 }, (_, i) => `src/file${i}.ts`));
    const r = searchFiles(many, 'file', null, 50);
    expect(r.items).toHaveLength(50);
    expect(r.more).toBe(10);
    expect(r.moreIsLowerBound).toBe(false);
  });
});

describe('initialItems', () => {
  it('lists changed files first, then the top level with folders first', () => {
    const r = initialItems(files, ['src/main/ipc.ts', 'README.md', 'gone.ts']);
    expect(r.items.map((i) => [i.entry.path, i.group])).toEqual([
      ['src/main/ipc.ts', 'Changed'],
      ['README.md', 'Changed'],
      ['.github/', 'Project'],
      ['src/', 'Project'],
      ['.gitignore', 'Project'],
      ['package.json', 'Project'],
    ]);
  });
});

describe('moveSelection', () => {
  it('wraps with the arrow keys', () => {
    expect(moveSelection('ArrowDown', 4, 5)).toBe(0);
    expect(moveSelection('ArrowUp', 0, 5)).toBe(4);
  });

  it('pages without wrapping', () => {
    expect(moveSelection('PageDown', 2, 20)).toBe(10);
    expect(moveSelection('PageDown', 15, 20)).toBe(19);
    expect(moveSelection('PageUp', 3, 20)).toBe(0);
  });

  it('ignores other keys and empty lists', () => {
    expect(moveSelection('Home', 3, 20)).toBeNull();
    expect(moveSelection('ArrowDown', 0, 0)).toBeNull();
  });
});
