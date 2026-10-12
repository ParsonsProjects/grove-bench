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
  expireSessionNotes,
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

// ─── What reaches the agent ───

function writeWithDescription(relPath: string, title: string, description: string, body: string, updatedAt = new Date().toISOString()): void {
  memory.writeMemoryFile(REPO, relPath,
    `---\ntitle: "${title}"\ndescription: "${description}"\nupdatedAt: "${updatedAt}"\n---\n\n${body}\n`);
}

describe('memory prompt', () => {
  it('loads conventions in full and lists every other file in the index', () => {
    writeWithDescription('repo/overview.md', 'Overview', 'Tech stack and layout', 'OVERVIEW BODY');
    writeMemory('conventions/naming.md', 'Naming', 'NAMING BODY');
    writeMemory('architecture/flow.md', 'Flow', 'FLOW BODY');
    writeMemory('sessions/note.md', 'Note', 'NOTE BODY', '2026-10-01T00:00:00Z');

    const prompt = memory.getMemoryForSystemPrompt(REPO);

    expect(prompt).toContain('### Naming\nNAMING BODY');
    expect(prompt).not.toContain('OVERVIEW BODY');
    expect(prompt).not.toContain('FLOW BODY');
    expect(prompt).not.toContain('NOTE BODY');
    expect(prompt).toContain('- repo/overview.md: Overview. Tech stack and layout');
    expect(prompt).toContain('- architecture/flow.md: Flow');
    expect(prompt).toContain('- sessions/note.md: Note (updated 2026-10-01)');
    // Conventions loaded in full aren't listed again
    expect(prompt).not.toContain('- conventions/naming.md');
  });

  it('lists conventions past the full-load cap in the index', () => {
    writeMemory('conventions/a.md', 'A', 'a'.repeat(4 * 1024), '2026-02-01T00:00:00Z');
    writeMemory('conventions/b.md', 'B', 'b'.repeat(4 * 1024), '2026-01-01T00:00:00Z');

    const plan = memory.planMemoryPrompt(REPO);

    // Newest first: a fits, b would pass FULL_CONVENTIONS_BYTES
    expect(plan.full.map(f => f.entry.relativePath)).toEqual(['conventions/a.md']);
    expect(plan.indexed.map(i => i.entry.relativePath)).toEqual(['conventions/b.md']);
  });

  it('orders the index by folder, then newest first, with thread notes last', () => {
    writeMemory('sessions/s.md', 'S', 'x');
    writeMemory('architecture/old.md', 'Old', 'x', '2025-01-01T00:00:00Z');
    writeMemory('architecture/new.md', 'New', 'x', '2026-01-01T00:00:00Z');
    writeMemory('notes/other.md', 'Other', 'x');
    writeMemory('repo/overview.md', 'Overview', 'x');

    const order = memory.planMemoryPrompt(REPO).indexed.map(i => i.entry.relativePath);

    expect(order).toEqual([
      'repo/overview.md', 'architecture/new.md', 'architecture/old.md', 'notes/other.md', 'sessions/s.md',
    ]);
  });

  it('leaves the end of the index out when it outgrows the budget, matching the stats', () => {
    const longTitle = 'A long architecture note title '.repeat(3);
    for (let i = 0; i < 200; i++) {
      writeWithDescription(`architecture/note-${String(i).padStart(3, '0')}.md`, longTitle, 'd'.repeat(100), 'x');
    }
    writeMemory('sessions/s.md', 'S', 'x');

    const stats = memory.getMemoryStats(REPO);
    const prompt = memory.getMemoryForSystemPrompt(REPO);

    expect(stats.unlistedFiles.length).toBeGreaterThan(0);
    expect(stats.unlistedFiles).toContain('sessions/s.md');
    expect(stats.promptBytes).toBeLessThanOrEqual(stats.budgetBytes);
    expect(prompt).toContain(`${stats.unlistedFiles.length} more files are not listed here`);
    for (const p of stats.unlistedFiles) expect(prompt).not.toContain(`- ${p}:`);
  });

  it('counts files and what the prompt holds', () => {
    writeMemory('repo/overview.md', 'Overview', 'x'.repeat(100));
    writeMemory('conventions/naming.md', 'Naming', 'y'.repeat(50));
    writeMemory('sessions/note.md', 'Note', 'z'.repeat(999));

    const stats = memory.getMemoryStats(REPO);
    const plan = memory.planMemoryPrompt(REPO);

    expect(stats.fileCount).toBe(2);
    expect(stats.sessionNoteCount).toBe(1);
    expect(stats.fullFiles).toEqual(['conventions/naming.md']);
    expect(stats.unlistedFiles).toEqual([]);
    expect(stats.budgetBytes).toBe(16 * 1024);
    const indexBytes = plan.indexed.reduce((sum, i) => sum + Buffer.byteLength(i.line) + 1, 0);
    expect(stats.promptBytes).toBe(50 + indexBytes);
  });

  it('adds nothing to the prompt for a project without memory files', () => {
    expect(memory.getMemoryForSystemPrompt(REPO)).toBe('');
  });

  it('reads the description from frontmatter for memory_list', () => {
    writeWithDescription('repo/overview.md', 'Overview', 'Tech stack and layout', 'x');
    expect(memory.listMemoryFiles(REPO)[0].description).toBe('Tech stack and layout');
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

// ─── expireSessionNotes ───

describe('expireSessionNotes', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.parse('2026-10-12T12:00:00Z');

  it('archives thread notes older than 30 days and keeps newer ones', () => {
    writeMemory('sessions/old.md', 'Old', 'old work', new Date(NOW - 31 * DAY).toISOString());
    writeMemory('sessions/recent.md', 'Recent', 'note', new Date(NOW - 29 * DAY).toISOString());
    writeMemory('architecture/old.md', 'Lasting', 'note', new Date(NOW - 400 * DAY).toISOString());

    const expired = expireSessionNotes(REPO, NOW);

    expect(expired).toEqual(['sessions/old.md']);
    expect(memory.readMemoryFile(REPO, 'sessions/recent.md')).not.toBeNull();
    // Other folders never expire
    expect(memory.readMemoryFile(REPO, 'architecture/old.md')).not.toBeNull();
    const archived = fs.readdirSync(path.join(memoryDir(), '_pruned-sessions'));
    expect(archived.some(name => name.endsWith('old.md'))).toBe(true);
  });

  it('then keeps at most 20 notes', () => {
    for (let i = 0; i < 22; i++) {
      writeMemory(`sessions/s-${String(i).padStart(2, '0')}.md`, `S${i}`, 'note', new Date(NOW - i * 60_000).toISOString());
    }

    const expired = expireSessionNotes(REPO, NOW);

    expect(expired.sort()).toEqual(['sessions/s-20.md', 'sessions/s-21.md']);
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

  describe('background model', () => {
    const settingsWith = (backgroundModels: Record<string, string>) => ({
      memoryAutoSave: true, memoryAutoCompact: true, backgroundModels,
    }) as unknown as ReturnType<typeof settings.getSettings>;

    async function modelUsed(): Promise<unknown> {
      writeMemory('repo/overview.md', 'Overview', 'fact');
      mockAdapter.generateText.mockResolvedValue(JSON.stringify({
        files: [{ action: 'keep', path: 'repo/overview.md', content: '', reason: '' }],
      }));
      await compactMemory({ repoPath: REPO, force: true });
      return (mockAdapter.generateText.mock.calls[0][2] as { model?: string }).model;
    }

    afterEach(() => { delete (mockAdapter as { backgroundModel?: string }).backgroundModel; });

    it("uses the model picked for this agent in Settings", async () => {
      (mockAdapter as { backgroundModel?: string }).backgroundModel = 'cheap-default';
      vi.mocked(settings.getSettings).mockReturnValue(settingsWith({ [mockAdapter.id]: 'picked-model', other: 'other-model' }));
      expect(await modelUsed()).toBe('picked-model');
    });

    it("falls back to the agent's own background model", async () => {
      (mockAdapter as { backgroundModel?: string }).backgroundModel = 'cheap-default';
      vi.mocked(settings.getSettings).mockReturnValue(settingsWith({ other: 'other-model' }));
      expect(await modelUsed()).toBe('cheap-default');
    });

    it("omits the model when neither is set (the agent's default)", async () => {
      vi.mocked(settings.getSettings).mockReturnValue(settingsWith({}));
      expect(await modelUsed()).toBeUndefined();
    });
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
      // Within the last day, so only the cap applies, not the age limit
      writeMemory(`sessions/s-${String(i).padStart(2, '0')}.md`, `S${i}`, 'note', new Date(Date.now() - (25 - i) * 60_000).toISOString());
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
