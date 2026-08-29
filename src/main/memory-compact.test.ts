import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

// ─── Mocks ───

const mockAdapter = {
  id: 'mock',
  generateText: vi.fn<(sys: string, user: string, opts?: unknown) => Promise<string>>(),
};

vi.mock('./adapters/index.js', () => ({
  adapterRegistry: {
    get: vi.fn(() => mockAdapter),
    getDefault: vi.fn(() => mockAdapter),
  },
}));

vi.mock('./settings.js', () => ({
  getSettings: vi.fn(() => ({ memoryAutoSave: true, memoryAutoCompact: true })),
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as memory from './memory.js';
import {
  needsCompaction,
  pruneSessionNotes,
  compactMemory,
  validateCompactionResult,
  listBackups,
  restoreBackup,
} from './memory-compact.js';

// ─── Helpers ───

// Unique per test — memory-compact caches cooldown state per repo path in module scope.
let REPO: string;

let tmpDir: string;

function writeMemory(relPath: string, title: string, body: string, updatedAt = new Date().toISOString()): void {
  memory.writeMemoryFile(REPO, relPath, `---\ntitle: "${title}"\nupdatedAt: "${updatedAt}"\n---\n\n${body}\n`);
}

function memoryDir(): string {
  return memory.getMemoryDir(REPO);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-memory-test-'));
  REPO = path.join(tmpDir, 'test-repo');
  vi.mocked(app.getPath).mockReturnValue(tmpDir);
  mockAdapter.generateText.mockReset();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── needsCompaction ───

describe('needsCompaction', () => {
  it('is false for small memory', () => {
    writeMemory('repo/overview.md', 'Overview', 'A small note.');
    const result = needsCompaction(REPO);
    expect(result.needed).toBe(false);
    expect(result.fileCount).toBe(1);
  });

  it('is true when total bytes exceed the threshold', () => {
    writeMemory('repo/overview.md', 'Overview', 'x'.repeat(13 * 1024));
    expect(needsCompaction(REPO).needed).toBe(true);
  });

  it('is true when too many files accumulate', () => {
    for (let i = 0; i < 16; i++) {
      writeMemory(`conventions/note-${i}.md`, `Note ${i}`, 'A convention.');
    }
    expect(needsCompaction(REPO).needed).toBe(true);
  });

  it('ignores session notes', () => {
    writeMemory('sessions/big.md', 'Big session', 'x'.repeat(20 * 1024));
    expect(needsCompaction(REPO).needed).toBe(false);
  });
});

// ─── pruneSessionNotes ───

describe('pruneSessionNotes', () => {
  it('does nothing under the cap', () => {
    writeMemory('sessions/a.md', 'A', 'note');
    writeMemory('sessions/b.md', 'B', 'note');
    expect(pruneSessionNotes(REPO, 5)).toEqual([]);
    expect(memory.readMemoryFile(REPO, 'sessions/a.md')).not.toBeNull();
  });

  it('deletes the oldest notes beyond the cap, keeping the newest', () => {
    writeMemory('sessions/old.md', 'Old', 'note', '2024-01-01T00:00:00Z');
    writeMemory('sessions/mid.md', 'Mid', 'note', '2025-01-01T00:00:00Z');
    writeMemory('sessions/new.md', 'New', 'note', '2026-01-01T00:00:00Z');

    const deleted = pruneSessionNotes(REPO, 2);

    expect(deleted).toEqual(['sessions/old.md']);
    expect(memory.readMemoryFile(REPO, 'sessions/old.md')).toBeNull();
    expect(memory.readMemoryFile(REPO, 'sessions/mid.md')).not.toBeNull();
    expect(memory.readMemoryFile(REPO, 'sessions/new.md')).not.toBeNull();
  });

  it('treats notes without a timestamp as oldest', () => {
    writeMemory('sessions/dated.md', 'Dated', 'note', '2026-01-01T00:00:00Z');
    writeMemory('sessions/undated.md', 'Undated', 'note', '');

    const deleted = pruneSessionNotes(REPO, 1);
    expect(deleted).toEqual(['sessions/undated.md']);
  });
});

// ─── validateCompactionResult ───

describe('validateCompactionResult', () => {
  const original = {
    'repo/overview.md': 'x'.repeat(3000),
    'repo/tech-stack.md': 'y'.repeat(3000),
  };

  it('accepts a merge that updates one file and deletes the other', () => {
    const result = {
      files: [
        { action: 'update' as const, path: 'repo/overview.md', content: 'merged content '.repeat(50), reason: 'merged' },
        { action: 'delete' as const, path: 'repo/tech-stack.md', content: '', reason: 'merged into overview' },
      ],
    };
    expect(validateCompactionResult(result, original)).toBeNull();
  });

  it('rejects an empty result', () => {
    expect(validateCompactionResult({ files: [] }, original)).toContain('empty');
  });

  it('rejects paths outside repo/, conventions/, architecture/', () => {
    const result = {
      files: [{ action: 'update' as const, path: 'sessions/x.md', content: 'stuff', reason: '' }],
    };
    expect(validateCompactionResult(result, original)).toContain('disallowed path');
  });

  it('rejects path traversal', () => {
    const result = {
      files: [{ action: 'update' as const, path: '../evil.md', content: 'stuff', reason: '' }],
    };
    expect(validateCompactionResult(result, original)).toContain('disallowed path');
  });

  it('rejects deleting a file that does not exist', () => {
    const result = {
      files: [{ action: 'delete' as const, path: 'repo/ghost.md', content: '', reason: '' }],
    };
    expect(validateCompactionResult(result, original)).toContain('unknown file');
  });

  it('rejects a result that would destroy nearly all content', () => {
    const result = {
      files: [
        { action: 'update' as const, path: 'repo/overview.md', content: 'tiny', reason: '' },
        { action: 'delete' as const, path: 'repo/tech-stack.md', content: '', reason: '' },
      ],
    };
    expect(validateCompactionResult(result, original)).toContain('too destructive');
  });

  it('rejects an update with empty content', () => {
    const result = {
      files: [{ action: 'update' as const, path: 'repo/overview.md', content: '   ', reason: '' }],
    };
    expect(validateCompactionResult(result, original)).toContain('empty content');
  });
});

// ─── compactMemory ───

describe('compactMemory', () => {
  it('skips below threshold when not forced', async () => {
    writeMemory('repo/overview.md', 'Overview', 'small');
    const status = await compactMemory({ repoPath: REPO });
    expect(status.compacted).toBe(false);
    expect(status.skippedReason).toBe('below threshold');
    expect(mockAdapter.generateText).not.toHaveBeenCalled();
  });

  it('merges duplicates, resolves contradictions, and backs up originals', async () => {
    writeMemory('repo/overview.md', 'Overview', 'The project uses Vite.\nThe project uses Webpack.', '2024-01-01T00:00:00Z');
    writeMemory('repo/build.md', 'Build', 'The project uses Vite.', '2026-01-01T00:00:00Z');

    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [
        {
          action: 'update',
          path: 'repo/overview.md',
          content: '---\ntitle: "Overview"\nupdatedAt: "2026-01-01T00:00:00Z"\n---\n\nThe project uses Vite.\n',
          reason: 'merged build info, dropped contradicted Webpack claim',
        },
        { action: 'delete', path: 'repo/build.md', content: '', reason: 'merged into overview' },
      ],
    }));

    const status = await compactMemory({ repoPath: REPO, force: true });

    expect(status.compacted).toBe(true);
    expect(status.filesChanged).toEqual(expect.arrayContaining(['repo/overview.md', 'repo/build.md']));
    expect(memory.readMemoryFile(REPO, 'repo/build.md')).toBeNull();
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('Vite');
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).not.toContain('Webpack');

    // Originals backed up under a timestamped snapshot in the hidden _compact-backup folder
    const backupRoot = path.join(memoryDir(), '_compact-backup');
    const snapshots = fs.readdirSync(backupRoot);
    expect(snapshots).toHaveLength(1);
    const backup = path.join(backupRoot, snapshots[0], 'repo', 'build.md');
    expect(fs.readFileSync(backup, 'utf-8')).toContain('The project uses Vite.');

    // Backup folder is invisible to memory listing
    const listed = memory.listMemoryFiles(REPO).map(e => e.relativePath);
    expect(listed.some(p => p.includes('_compact-backup'))).toBe(false);
  });

  it('leaves files untouched when the adapter returns invalid JSON', async () => {
    writeMemory('repo/overview.md', 'Overview', 'important fact');
    mockAdapter.generateText.mockResolvedValue('not json at all');

    const status = await compactMemory({ repoPath: REPO, force: true });

    expect(status.compacted).toBe(false);
    expect(status.skippedReason).toBe('unparseable result');
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('important fact');
  });

  it('rejects and does not apply a destructive result', async () => {
    writeMemory('repo/overview.md', 'Overview', 'x'.repeat(3000));
    writeMemory('repo/details.md', 'Details', 'y'.repeat(3000));

    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [
        { action: 'delete', path: 'repo/overview.md', content: '', reason: '' },
        { action: 'update', path: 'repo/details.md', content: 'gone', reason: '' },
      ],
    }));

    const status = await compactMemory({ repoPath: REPO, force: true });

    expect(status.compacted).toBe(false);
    expect(status.skippedReason).toContain('too destructive');
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).not.toBeNull();
  });

  it('prunes session notes even when LLM compaction is skipped', async () => {
    for (let i = 0; i < 25; i++) {
      writeMemory(`sessions/s-${String(i).padStart(2, '0')}.md`, `S${i}`, 'note', new Date(2026, 0, i + 1).toISOString());
    }
    writeMemory('repo/overview.md', 'Overview', 'small');

    const status = await compactMemory({ repoPath: REPO });

    expect(status.compacted).toBe(false);
    expect(status.filesChanged).toHaveLength(5); // 25 - 20 kept
    const remaining = memory.listMemoryFiles(REPO).filter(e => e.folder.startsWith('sessions'));
    expect(remaining).toHaveLength(20);
  });

  it('respects the cooldown between LLM passes', async () => {
    writeMemory('repo/overview.md', 'Overview', 'x'.repeat(13 * 1024));

    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [
        { action: 'update', path: 'repo/overview.md', content: 'x'.repeat(8 * 1024), reason: 'condensed' },
      ],
    }));

    const first = await compactMemory({ repoPath: REPO });
    expect(first.compacted).toBe(true);

    // Still over threshold, but within cooldown
    writeMemory('repo/more.md', 'More', 'y'.repeat(13 * 1024));
    const second = await compactMemory({ repoPath: REPO });
    expect(second.compacted).toBe(false);
    expect(second.skippedReason).toBe('cooldown');
    expect(mockAdapter.generateText).toHaveBeenCalledTimes(1);
  });

  it('restore round-trips a compaction, snapshotting the pre-restore state', async () => {
    writeMemory('repo/overview.md', 'Overview', 'Uses Webpack');

    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [
        { action: 'update', path: 'repo/overview.md', content: '---\ntitle: "Overview"\n---\n\nUses Vite\n', reason: 'corrected' },
      ],
    }));

    await compactMemory({ repoPath: REPO, force: true });
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('Vite');

    const backups = listBackups(REPO);
    expect(backups).toHaveLength(1);
    expect(backups[0].fileCount).toBe(1);

    const status = restoreBackup(REPO, backups[0].id);
    expect(status.restored).toBe(true);
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('Webpack');

    // The compacted (pre-restore) state was snapshotted, so the restore is undoable
    expect(listBackups(REPO)).toHaveLength(2);
  });

  it('restore removes files the snapshot does not contain', async () => {
    writeMemory('repo/overview.md', 'Overview', 'original');

    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [
        { action: 'update', path: 'repo/overview.md', content: 'rewritten', reason: '' },
        { action: 'update', path: 'repo/merged.md', content: 'new merged file', reason: '' },
      ],
    }));

    await compactMemory({ repoPath: REPO, force: true });
    expect(memory.readMemoryFile(REPO, 'repo/merged.md')).not.toBeNull();

    const backups = listBackups(REPO);
    restoreBackup(REPO, backups[0].id);

    expect(memory.readMemoryFile(REPO, 'repo/merged.md')).toBeNull();
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('original');
  });

  it('rejects unknown and traversal backup ids', () => {
    writeMemory('repo/overview.md', 'Overview', 'safe');
    expect(restoreBackup(REPO, 'does-not-exist').restored).toBe(false);
    expect(restoreBackup(REPO, '../../repo').restored).toBe(false);
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('safe');
  });

  it('rotates snapshots beyond the retention cap', async () => {
    writeMemory('repo/overview.md', 'Overview', 'v0');

    for (let i = 1; i <= 7; i++) {
      mockAdapter.generateText.mockResolvedValue(JSON.stringify({
        files: [{ action: 'update', path: 'repo/overview.md', content: `version ${i}`, reason: '' }],
      }));
      await compactMemory({ repoPath: REPO, force: true });
    }

    expect(listBackups(REPO)).toHaveLength(5);
  });

  it('hard-truncates an oversized compacted file', async () => {
    writeMemory('repo/overview.md', 'Overview', 'x'.repeat(3000));

    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [
        { action: 'update', path: 'repo/overview.md', content: 'z'.repeat(64 * 1024), reason: '' },
      ],
    }));

    const status = await compactMemory({ repoPath: REPO, force: true });
    expect(status.compacted).toBe(true);
    const written = memory.readMemoryFile(REPO, 'repo/overview.md')!;
    expect(Buffer.byteLength(written, 'utf-8')).toBeLessThanOrEqual(16 * 1024);
  });
});
