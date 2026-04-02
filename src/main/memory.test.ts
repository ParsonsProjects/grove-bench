import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExistsSync, mockMkdirSync, mockWriteFileSync, mockReadFileSync, mockReaddirSync, mockUnlinkSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    readFileSync: mockReadFileSync,
    readdirSync: mockReaddirSync,
    unlinkSync: mockUnlinkSync,
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\mock\\userData',
  },
}));

import {
  sanitizeRepoPath,
  getMemoryDir,
  ensureRepoMemory,
  listMemoryFiles,
  readMemoryFile,
  writeMemoryFile,
  deleteMemoryFile,
  getMemoryForSystemPrompt,
} from './memory.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sanitizeRepoPath()', () => {
  it('replaces colons, slashes and backslashes with hyphens', () => {
    expect(sanitizeRepoPath('C:\\Users\\test\\repo')).toBe('c-users-test-repo');
  });

  it('lowercases the path', () => {
    expect(sanitizeRepoPath('/Home/User/Repo')).toBe('home-user-repo');
  });

  it('removes leading hyphens', () => {
    expect(sanitizeRepoPath('/repo')).toBe('repo');
  });

  it('collapses consecutive hyphens', () => {
    expect(sanitizeRepoPath('C:\\\\double')).toBe('c-double');
  });
});

describe('getMemoryDir()', () => {
  it('joins userData path with sanitized repo path', () => {
    const dir = getMemoryDir('/home/user/repo');
    // path.join will use the platform separator
    expect(dir).toContain('memory');
    expect(dir).toContain('home-user-repo');
  });
});

describe('ensureRepoMemory()', () => {
  it('creates directory structure when dir does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    ensureRepoMemory('/repo/test');

    expect(mockMkdirSync).toHaveBeenCalled();
    // Should create default folders: repo, conventions, architecture, sessions
    const mkdirCalls = mockMkdirSync.mock.calls.map((c: any[]) => c[0]);
    expect(mkdirCalls.length).toBeGreaterThanOrEqual(5); // root + 4 folders
    expect(mockWriteFileSync).toHaveBeenCalled(); // _index.json
  });

  it('does nothing when dir already exists', () => {
    mockExistsSync.mockReturnValue(true);

    ensureRepoMemory('/repo/test');

    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

describe('listMemoryFiles()', () => {
  it('returns empty array when dir does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(listMemoryFiles('/repo/test')).toEqual([]);
  });

  it('lists .md files recursively, skipping _ prefixed items', () => {
    mockExistsSync.mockReturnValue(true);

    // Root directory
    mockReaddirSync.mockImplementation((dir: string) => {
      const normalized = dir.replace(/\\/g, '/');
      if (normalized.endsWith('/home-user-repo')) {
        return [
          { name: '_index.json', isDirectory: () => false },
          { name: 'repo', isDirectory: () => true },
          { name: 'top.md', isDirectory: () => false },
        ];
      }
      if (normalized.endsWith('/repo')) {
        return [
          { name: 'overview.md', isDirectory: () => false },
        ];
      }
      return [];
    });

    mockReadFileSync.mockReturnValue('---\ntitle: Test\nupdatedAt: 2026-01-01\n---\nContent');

    const files = listMemoryFiles('/home/user/repo');

    // Should skip _index.json, include top.md and repo/overview.md
    expect(files).toHaveLength(2);
    expect(files.find(f => f.relativePath === 'top.md')).toBeDefined();
    expect(files.find(f => f.relativePath === 'repo/overview.md')).toBeDefined();
    expect(files.find(f => f.relativePath === '_index.json')).toBeUndefined();
  });

  it('extracts title from frontmatter', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: 'note.md', isDirectory: () => false },
    ]);
    mockReadFileSync.mockReturnValue('---\ntitle: My Note\nupdatedAt: 2026-03-15\n---\nBody');

    const files = listMemoryFiles('/repo');
    expect(files[0].title).toBe('My Note');
    expect(files[0].updatedAt).toBe('2026-03-15');
  });

  it('uses filename as fallback title when frontmatter has no title', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: 'note.md', isDirectory: () => false },
    ]);
    mockReadFileSync.mockReturnValue('No frontmatter here');

    const files = listMemoryFiles('/repo');
    expect(files[0].title).toBe('note');
  });
});

describe('readMemoryFile()', () => {
  it('reads file content', () => {
    mockReadFileSync.mockReturnValue('file content');
    const result = readMemoryFile('/repo', 'repo/note.md');
    expect(result).toBe('file content');
  });

  it('returns null when file does not exist', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(readMemoryFile('/repo', 'missing.md')).toBeNull();
  });

  it('rejects path traversal with ..', () => {
    expect(() => readMemoryFile('/repo', '../etc/passwd')).toThrow('Invalid memory path');
  });

  it('rejects absolute paths', () => {
    expect(() => readMemoryFile('/repo', '/etc/passwd')).toThrow('Invalid memory path');
  });

  it('rejects _index.json access', () => {
    expect(() => readMemoryFile('/repo', '_index.json')).toThrow('Cannot access _index.json');
  });
});

describe('writeMemoryFile()', () => {
  it('writes content to file', () => {
    mockExistsSync.mockReturnValue(true); // ensureRepoMemory check

    writeMemoryFile('/repo', 'repo/note.md', '# Hello');

    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();
    const writeCall = mockWriteFileSync.mock.calls.find((c: any[]) =>
      typeof c[1] === 'string' && c[1] === '# Hello'
    );
    expect(writeCall).toBeDefined();
  });

  it('rejects non-.md files', () => {
    expect(() => writeMemoryFile('/repo', 'note.txt', 'content')).toThrow(
      'Memory files must have a .md extension',
    );
  });

  it('rejects path traversal', () => {
    expect(() => writeMemoryFile('/repo', '../evil.md', 'content')).toThrow('Invalid memory path');
  });
});

describe('deleteMemoryFile()', () => {
  it('deletes file and returns true', () => {
    mockUnlinkSync.mockReturnValue(undefined);
    expect(deleteMemoryFile('/repo', 'repo/old.md')).toBe(true);
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('returns false when file does not exist', () => {
    mockUnlinkSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(deleteMemoryFile('/repo', 'missing.md')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(() => deleteMemoryFile('/repo', '../evil.md')).toThrow('Invalid memory path');
  });
});

describe('getMemoryForSystemPrompt()', () => {
  it('returns empty string when no memory files', () => {
    mockExistsSync.mockReturnValue(false);
    expect(getMemoryForSystemPrompt('/repo')).toBe('');
  });

  it('includes project memory and session file list', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dir: string) => {
      const normalized = dir.replace(/\\/g, '/');
      if (normalized.endsWith('/sessions')) {
        return [{ name: 's1.md', isDirectory: () => false }];
      }
      if (normalized.endsWith('/repo')) {
        return [{ name: 'overview.md', isDirectory: () => false }];
      }
      // Root memory dir
      return [
        { name: 'repo', isDirectory: () => true },
        { name: 'sessions', isDirectory: () => true },
      ];
    });
    mockReadFileSync.mockReturnValue('---\ntitle: Overview\nupdatedAt: 2026-01-01\n---\nProject info');

    const prompt = getMemoryForSystemPrompt('/test/repo');

    expect(prompt).toContain('<project_memory>');
    expect(prompt).toContain('Project info');
    expect(prompt).toContain('Session memory files available');
    expect(prompt).toContain('sessions/s1.md');
    expect(prompt).toContain('grove-memory MCP server');
  });

  it('excludes session entries from project_memory block', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dir: string) => {
      const normalized = dir.replace(/\\/g, '/');
      if (normalized.endsWith('/sessions')) {
        return [{ name: 's1.md', isDirectory: () => false }];
      }
      return [
        { name: 'sessions', isDirectory: () => true },
      ];
    });
    mockReadFileSync.mockReturnValue('---\ntitle: Session\nupdatedAt: 2026-01-01\n---\nSession data');

    const prompt = getMemoryForSystemPrompt('/repo');

    // Session entries should not be in project_memory block
    expect(prompt).not.toContain('<project_memory>');
    expect(prompt).toContain('Session memory files available');
  });
});
