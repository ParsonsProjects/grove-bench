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
import * as settings from './settings.js';
import {
  needsCompaction,
  pruneSessionNotes,
  compactMemory,
  cancelCompaction,
  onCompactionEvent,
  validateCompactionResult,
  listBackups,
  restoreBackup,
  previewBackup,
  readBackupFile,
  getCompactionInfo,
  type CompactionEvent,
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
  vi.mocked(settings.getSettings).mockImplementation(() => (
    { memoryAutoSave: true, memoryAutoCompact: true } as ReturnType<typeof settings.getSettings>
  ));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── getMemoryStats ───

describe('getMemoryStats', () => {
  it('counts non-session bytes and files, session notes separately', () => {
    writeMemory('repo/overview.md', 'Overview', 'x'.repeat(100));
    writeMemory('conventions/naming.md', 'Naming', 'y'.repeat(50));
    writeMemory('sessions/note.md', 'Note', 'z'.repeat(999));

    const stats = memory.getMemoryStats(REPO);

    expect(stats.fileCount).toBe(2);
    expect(stats.sessionNoteCount).toBe(1);
    expect(stats.totalBytes).toBe(150);
    expect(stats.budgetBytes).toBe(16 * 1024);
    expect(stats.skippedFiles).toEqual([]);
  });

  it('marks files beyond the prompt budget as skipped, matching the prompt builder', () => {
    writeMemory('repo/big-1.md', 'Big 1', 'a'.repeat(9 * 1024));
    writeMemory('repo/big-2.md', 'Big 2', 'b'.repeat(9 * 1024));

    const stats = memory.getMemoryStats(REPO);

    expect(stats.skippedFiles).toHaveLength(1);
    // The same file the prompt builder reports as skipped
    expect(memory.getMemoryForSystemPrompt(REPO)).toContain(stats.skippedFiles[0]);
  });
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

  it('falls back to file mtime when updatedAt is missing — a freshly-written note is never pruned first', () => {
    writeMemory('sessions/dated.md', 'Dated', 'note', '2026-01-01T00:00:00Z');
    writeMemory('sessions/undated-active.md', 'Active plan', 'note', ''); // no timestamp, but just written

    const deleted = pruneSessionNotes(REPO, 1);
    // The stale dated note goes, not the actively-written undated one
    expect(deleted).toEqual(['sessions/dated.md']);
    expect(memory.readMemoryFile(REPO, 'sessions/undated-active.md')).not.toBeNull();
  });

  it('prunes an undated note whose file is genuinely old', () => {
    writeMemory('sessions/fresh.md', 'Fresh', 'note', new Date().toISOString());
    writeMemory('sessions/undated-stale.md', 'Stale', 'note', '');
    const stalePath = path.join(memoryDir(), 'sessions', 'undated-stale.md');
    const old = new Date('2024-01-01');
    fs.utimesSync(stalePath, old, old);

    const deleted = pruneSessionNotes(REPO, 1);
    expect(deleted).toEqual(['sessions/undated-stale.md']);
  });

  it('archives pruned notes into the hidden _pruned-sessions folder before deleting', () => {
    writeMemory('sessions/keep.md', 'Keep', 'recent note', new Date().toISOString());
    writeMemory('sessions/goner.md', 'Goner', 'precious context', '2024-01-01T00:00:00Z');

    const deleted = pruneSessionNotes(REPO, 1);
    expect(deleted).toEqual(['sessions/goner.md']);

    const archiveDir = path.join(memoryDir(), '_pruned-sessions');
    const archived = fs.readdirSync(archiveDir);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toContain('goner.md');
    expect(fs.readFileSync(path.join(archiveDir, archived[0]), 'utf-8')).toContain('precious context');

    // The archive is invisible to memory listing and the prompt
    const listed = memory.listMemoryFiles(REPO).map(e => e.relativePath);
    expect(listed.some(p => p.includes('_pruned-sessions'))).toBe(false);
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

  it('passes the configured memoryModel to generateText', async () => {
    writeMemory('repo/overview.md', 'Overview', 'fact');
    vi.mocked(settings.getSettings).mockReturnValue({
      memoryAutoSave: true, memoryAutoCompact: true, memoryModel: 'claude-haiku-4-5',
    } as ReturnType<typeof settings.getSettings>);
    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [{ action: 'keep', path: 'repo/overview.md', content: '', reason: '' }],
    }));

    await compactMemory({ repoPath: REPO, force: true });

    expect(mockAdapter.generateText).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ model: 'claude-haiku-4-5' }),
    );
  });

  it('omits the model when memoryModel is empty (provider default)', async () => {
    writeMemory('repo/overview.md', 'Overview', 'fact');
    vi.mocked(settings.getSettings).mockReturnValue({
      memoryAutoSave: true, memoryAutoCompact: true, memoryModel: '',
    } as ReturnType<typeof settings.getSettings>);
    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [{ action: 'keep', path: 'repo/overview.md', content: '', reason: '' }],
    }));

    await compactMemory({ repoPath: REPO, force: true });

    expect(mockAdapter.generateText).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ model: undefined }),
    );
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

  it('reports per-file changes and the undo backupId, and records compaction info', async () => {
    writeMemory('repo/overview.md', 'Overview', 'Uses Webpack');

    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [
        { action: 'update', path: 'repo/overview.md', content: 'Uses Vite', reason: 'kept the newer claim' },
      ],
    }));

    const status = await compactMemory({ repoPath: REPO, force: true });

    expect(status.changes).toEqual([
      { action: 'update', path: 'repo/overview.md', reason: 'kept the newer claim' },
    ]);
    expect(status.backupId).toBeTruthy();

    // The reported backupId really is the undo handle
    const undo = restoreBackup(REPO, status.backupId!);
    expect(undo.restored).toBe(true);
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('Webpack');

    const info = getCompactionInfo(REPO);
    expect(info.lastCompactedAt).toBeTruthy();
    expect(info.lastAuto).toBe(false);
    expect(info.lastFilesChanged).toBe(1);
  });

  it('marks auto-triggered passes in the compaction info', async () => {
    writeMemory('repo/overview.md', 'Overview', 'x'.repeat(13 * 1024));
    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [{ action: 'update', path: 'repo/overview.md', content: 'condensed '.repeat(200), reason: '' }],
    }));

    await compactMemory({ repoPath: REPO, auto: true });

    expect(getCompactionInfo(REPO).lastAuto).toBe(true);
  });

  it('previews snapshot contents and reads single files without touching live memory', async () => {
    writeMemory('repo/overview.md', 'Overview', 'original body');
    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [{ action: 'update', path: 'repo/overview.md', content: 'rewritten', reason: '' }],
    }));

    const status = await compactMemory({ repoPath: REPO, force: true });
    const files = previewBackup(REPO, status.backupId!);

    expect(files).toEqual([{ path: 'repo/overview.md', bytes: expect.any(Number) }]);
    expect(readBackupFile(REPO, status.backupId!, 'repo/overview.md')).toContain('original body');
    expect(readBackupFile(REPO, status.backupId!, '../../_index.json')).toBeNull();
    // Live memory unchanged by the reads
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toBe('rewritten');
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

  it('reports an adapter failure as an error, not a skip, and leaves memory untouched', async () => {
    writeMemory('repo/overview.md', 'Overview', 'important fact');
    mockAdapter.generateText.mockRejectedValue(new Error('Operation aborted'));

    const status = await compactMemory({ repoPath: REPO, force: true });

    expect(status.compacted).toBe(false);
    expect(status.error).toContain('Operation aborted');
    expect(status.skippedReason).toBeUndefined();
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('important fact');
  });

  it('aborts a hung generation after the timeout and reports a timeout error', async () => {
    vi.useFakeTimers();
    try {
      writeMemory('repo/overview.md', 'Overview', 'important fact');

      // Hangs until the abort signal fires, like a real long-running generation
      mockAdapter.generateText.mockImplementation((_sys, _user, opts) => {
        const signal = (opts as { abortSignal: AbortSignal }).abortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Operation aborted')));
        });
      });

      const pending = compactMemory({ repoPath: REPO, force: true });
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      const status = await pending;

      expect(status.compacted).toBe(false);
      expect(status.error).toContain('timed out');
      expect(status.skippedReason).toBeUndefined();
      expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('important fact');
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors the memoryCompactTimeoutSeconds setting, clamped to the 30s floor', async () => {
    vi.useFakeTimers();
    try {
      writeMemory('repo/overview.md', 'Overview', 'important fact');
      vi.mocked(settings.getSettings).mockReturnValueOnce({
        memoryAutoSave: true, memoryAutoCompact: true, memoryCompactTimeoutSeconds: 10, // below floor → 30s
      } as ReturnType<typeof settings.getSettings>);

      mockAdapter.generateText.mockImplementation((_sys, _user, opts) => {
        const signal = (opts as { abortSignal: AbortSignal }).abortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Operation aborted')));
        });
      });

      const pending = compactMemory({ repoPath: REPO, force: true });
      await vi.advanceTimersByTimeAsync(30 * 1000);
      const status = await pending;

      expect(status.compacted).toBe(false);
      expect(status.error).toContain('timed out after 30s');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelCompaction aborts a running pass, reported as cancelled with memory untouched', async () => {
    writeMemory('repo/overview.md', 'Overview', 'important fact');

    mockAdapter.generateText.mockImplementation((_sys, _user, opts) => {
      const signal = (opts as { abortSignal: AbortSignal }).abortSignal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Operation aborted')));
      });
    });

    const pending = compactMemory({ repoPath: REPO, force: true });
    // Give the pass a beat to reach the generate stage, then cancel
    await new Promise(r => setTimeout(r, 10));
    expect(cancelCompaction(REPO)).toBe(true);
    const status = await pending;

    expect(status.compacted).toBe(false);
    expect(status.skippedReason).toBe('cancelled');
    expect(status.error).toBeUndefined();
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('important fact');
    // Nothing left to cancel afterwards
    expect(cancelCompaction(REPO)).toBe(false);
  });

  it('emits stage and done events for a manual pass', async () => {
    writeMemory('repo/overview.md', 'Overview', 'fact');
    mockAdapter.generateText.mockResolvedValue(JSON.stringify({
      files: [{ action: 'update', path: 'repo/overview.md', content: 'condensed fact', reason: '' }],
    }));

    const events: CompactionEvent[] = [];
    const unsubscribe = onCompactionEvent(e => events.push(e));
    try {
      await compactMemory({ repoPath: REPO, force: true });
    } finally {
      unsubscribe();
    }

    const stages = events.filter(e => e.kind === 'stage').map(e => (e as Extract<CompactionEvent, { kind: 'stage' }>).stage);
    expect(stages).toEqual(['pruning', 'generating', 'validating', 'applying']);
    const done = events.find(e => e.kind === 'done') as Extract<CompactionEvent, { kind: 'done' }>;
    expect(done.auto).toBe(false);
    expect(done.status.compacted).toBe(true);
  });

  it('emits no events for an auto pass that skips below threshold', async () => {
    writeMemory('repo/overview.md', 'Overview', 'small');

    const events: CompactionEvent[] = [];
    const unsubscribe = onCompactionEvent(e => events.push(e));
    try {
      await compactMemory({ repoPath: REPO, auto: true });
    } finally {
      unsubscribe();
    }

    expect(events).toEqual([]);
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
