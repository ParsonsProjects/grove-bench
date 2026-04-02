import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '../shared/types.js';

import {
  sanitizeFilePath,
  extractDirsFromFiles,
  synthesizeNewFileDiff,
  validatePort,
  validateExternalUrl,
  PrelaunchBuffer,
} from './ipc-utils.js';

// ─── sanitizeFilePath ───

describe('sanitizeFilePath()', () => {
  // On Windows, path.resolve and path.normalize use backslashes.
  // Use a real absolute path so path.resolve doesn't prepend CWD.
  const worktreePath = process.platform === 'win32'
    ? 'C:\\worktrees\\abc123'
    : '/worktrees/abc123';

  it('resolves a simple relative path within the worktree', () => {
    const result = sanitizeFilePath(worktreePath, 'src/index.ts');
    expect(result).toContain('src');
    expect(result).toContain('index.ts');
  });

  it('strips /workspace/ Docker prefix', () => {
    const result = sanitizeFilePath(worktreePath, '/workspace/src/index.ts');
    expect(result).toContain('src');
    expect(result).not.toContain('workspace');
  });

  it('strips worktree absolute prefix from the file path', () => {
    const absPath = worktreePath + (process.platform === 'win32' ? '\\src\\file.ts' : '/src/file.ts');
    const result = sanitizeFilePath(worktreePath, absPath);
    expect(result).toContain('src');
    expect(result).toContain('file.ts');
  });

  it('throws on path traversal with ..', () => {
    expect(() => sanitizeFilePath(worktreePath, '../etc/passwd')).toThrow('Path traversal not allowed');
  });

  it('throws on absolute path outside worktree', () => {
    const outsidePath = process.platform === 'win32'
      ? 'C:\\other\\secret.txt'
      : '/other/secret.txt';
    expect(() => sanitizeFilePath(worktreePath, outsidePath)).toThrow('Path traversal not allowed');
  });

  it('handles trailing slashes in file path', () => {
    const result = sanitizeFilePath(worktreePath, 'src/components/');
    expect(result).toContain('src');
    expect(result).toContain('components');
  });
});

// ─── extractDirsFromFiles ───

describe('extractDirsFromFiles()', () => {
  it('extracts unique directory prefixes from file paths', () => {
    const files = ['src/main/index.ts', 'src/main/ipc.ts', 'src/shared/types.ts'];
    const dirs = extractDirsFromFiles(files);
    expect(dirs).toContain('src/');
    expect(dirs).toContain('src/main/');
    expect(dirs).toContain('src/shared/');
  });

  it('returns sorted directories', () => {
    const files = ['z/b.ts', 'a/c.ts'];
    const dirs = extractDirsFromFiles(files);
    expect(dirs).toEqual(['a/', 'z/']);
  });

  it('returns empty array for files with no directories', () => {
    const files = ['README.md', 'package.json'];
    expect(extractDirsFromFiles(files)).toEqual([]);
  });

  it('handles deeply nested paths', () => {
    const files = ['a/b/c/d.ts'];
    const dirs = extractDirsFromFiles(files);
    expect(dirs).toEqual(['a/', 'a/b/', 'a/b/c/']);
  });

  it('handles empty input', () => {
    expect(extractDirsFromFiles([])).toEqual([]);
  });

  it('deduplicates directories from multiple files', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const dirs = extractDirsFromFiles(files);
    expect(dirs).toEqual(['src/']);
  });
});

// ─── synthesizeNewFileDiff ───

describe('synthesizeNewFileDiff()', () => {
  it('creates a unified diff for new file content', () => {
    const diff = synthesizeNewFileDiff('src/new.ts', 'line1\nline2\nline3');
    expect(diff).toContain('--- /dev/null');
    expect(diff).toContain('+++ b/src/new.ts');
    expect(diff).toContain('@@ -0,0 +1,3 @@');
    expect(diff).toContain('+line1');
    expect(diff).toContain('+line2');
    expect(diff).toContain('+line3');
  });

  it('normalizes backslashes in path to forward slashes', () => {
    const diff = synthesizeNewFileDiff('src\\win\\file.ts', 'content');
    expect(diff).toContain('+++ b/src/win/file.ts');
  });

  it('handles single-line content', () => {
    const diff = synthesizeNewFileDiff('file.ts', 'single');
    expect(diff).toContain('@@ -0,0 +1,1 @@');
    expect(diff).toContain('+single');
  });

  it('handles empty content', () => {
    const diff = synthesizeNewFileDiff('file.ts', '');
    expect(diff).toContain('@@ -0,0 +1,1 @@');
  });

  it('strips trailing newline to avoid phantom blank line', () => {
    const diff = synthesizeNewFileDiff('file.ts', 'line1\nline2\n');
    expect(diff).toContain('@@ -0,0 +1,2 @@');
    expect(diff).toContain('+line1');
    expect(diff).toContain('+line2');
    // Should NOT have a trailing +<empty> line
    expect(diff).not.toMatch(/\+\n\+$/);
  });
});

// ─── validatePort ───

describe('validatePort()', () => {
  it('accepts valid port numbers', () => {
    expect(() => validatePort(80)).not.toThrow();
    expect(() => validatePort(3000)).not.toThrow();
    expect(() => validatePort(65535)).not.toThrow();
    expect(() => validatePort(1)).not.toThrow();
  });

  it('rejects non-integer ports', () => {
    expect(() => validatePort(3.14)).toThrow('Invalid port number');
    expect(() => validatePort(NaN)).toThrow('Invalid port number');
  });

  it('rejects port 0', () => {
    expect(() => validatePort(0)).toThrow('Invalid port number');
  });

  it('rejects negative ports', () => {
    expect(() => validatePort(-1)).toThrow('Invalid port number');
  });

  it('rejects ports above 65535', () => {
    expect(() => validatePort(65536)).toThrow('Invalid port number');
  });
});

// ─── validateExternalUrl ───

describe('validateExternalUrl()', () => {
  it('accepts http URLs', () => {
    expect(() => validateExternalUrl('http://example.com')).not.toThrow();
  });

  it('accepts https URLs', () => {
    expect(() => validateExternalUrl('https://example.com')).not.toThrow();
  });

  it('rejects file:// URLs', () => {
    expect(() => validateExternalUrl('file:///etc/passwd')).toThrow('Only http/https URLs are allowed');
  });

  it('rejects javascript: URLs', () => {
    expect(() => validateExternalUrl('javascript:alert(1)')).toThrow('Only http/https URLs are allowed');
  });

  it('rejects plain strings', () => {
    expect(() => validateExternalUrl('not-a-url')).toThrow('Only http/https URLs are allowed');
  });

  it('is case-insensitive for protocol', () => {
    expect(() => validateExternalUrl('HTTP://example.com')).not.toThrow();
    expect(() => validateExternalUrl('HTTPS://example.com')).not.toThrow();
  });
});

// ─── PrelaunchBuffer ───

describe('PrelaunchBuffer', () => {
  function makeEvent(type: string, message?: string): AgentEvent {
    return { type, message } as any;
  }

  it('creates a buffer for a session', () => {
    const buf = new PrelaunchBuffer();
    buf.create('s1');
    expect(buf.get('s1')).toEqual([]);
  });

  it('pushes events to the buffer', () => {
    const buf = new PrelaunchBuffer();
    buf.create('s1');
    const evt = makeEvent('status', 'Creating worktree…');
    buf.push('s1', evt);
    expect(buf.get('s1')).toEqual([evt]);
  });

  it('returns empty array for unknown session', () => {
    const buf = new PrelaunchBuffer();
    expect(buf.get('unknown')).toEqual([]);
  });

  it('deletes buffer for a session', () => {
    const buf = new PrelaunchBuffer();
    buf.create('s1');
    buf.push('s1', makeEvent('status'));
    buf.delete('s1');
    expect(buf.get('s1')).toEqual([]);
  });

  describe('prependToHistory()', () => {
    it('prepends prelaunch events to session history', () => {
      const buf = new PrelaunchBuffer();
      buf.create('s1');
      buf.push('s1', makeEvent('status', 'Creating worktree…'));
      buf.push('s1', makeEvent('status', 'Installing…'));

      const history = [makeEvent('system_init'), makeEvent('assistant')];
      const result = buf.prependToHistory('s1', history);

      expect(result).toHaveLength(4);
      expect((result[0] as any).message).toBe('Creating worktree…');
      expect((result[1] as any).message).toBe('Installing…');
      expect(result[2].type).toBe('system_init');
    });

    it('returns history as-is when no prelaunch events', () => {
      const buf = new PrelaunchBuffer();
      const history = [makeEvent('system_init')];
      expect(buf.prependToHistory('s1', history)).toBe(history);
    });
  });

  describe('adjustPage()', () => {
    it('prepends events on first page (startIndex=0)', () => {
      const buf = new PrelaunchBuffer();
      buf.create('s1');
      buf.push('s1', makeEvent('status', 'pre1'));
      buf.push('s1', makeEvent('status', 'pre2'));

      const page = { events: [makeEvent('init')], totalCount: 10, startIndex: 0 };
      const result = buf.adjustPage('s1', page);

      expect(result.events).toHaveLength(3);
      expect((result.events[0] as any).message).toBe('pre1');
      expect(result.totalCount).toBe(12);
      expect(result.startIndex).toBe(0);
    });

    it('adjusts indices on non-first pages', () => {
      const buf = new PrelaunchBuffer();
      buf.create('s1');
      buf.push('s1', makeEvent('status'));
      buf.push('s1', makeEvent('status'));

      const page = { events: [makeEvent('assistant')], totalCount: 10, startIndex: 5 };
      const result = buf.adjustPage('s1', page);

      expect(result.events).toHaveLength(1); // no prepend
      expect(result.totalCount).toBe(12);
      expect(result.startIndex).toBe(7); // 5 + 2 prelaunch
    });

    it('returns page as-is when no prelaunch events', () => {
      const buf = new PrelaunchBuffer();
      const page = { events: [makeEvent('init')], totalCount: 5, startIndex: 0 };
      const result = buf.adjustPage('s1', page);
      expect(result).toBe(page);
    });
  });

  describe('count()', () => {
    it('returns count of prelaunch events', () => {
      const buf = new PrelaunchBuffer();
      buf.create('s1');
      buf.push('s1', makeEvent('a'));
      buf.push('s1', makeEvent('b'));
      expect(buf.count('s1')).toBe(2);
    });

    it('returns 0 for unknown session', () => {
      const buf = new PrelaunchBuffer();
      expect(buf.count('unknown')).toBe(0);
    });
  });
});
