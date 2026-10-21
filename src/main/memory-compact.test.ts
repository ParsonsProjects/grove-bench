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
  getSettings: vi.fn(() => ({ memoryAutoSave: true })),
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as memory from './memory.js';
import * as settings from './settings.js';
import {
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
  resolvePlan,
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
    { memoryAutoSave: true } as ReturnType<typeof settings.getSettings>
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

    expect(stats.fileCount).toBe(2);
    expect(stats.sessionNoteCount).toBe(1);
    expect(stats.fullFiles).toEqual(['conventions/naming.md']);
    expect(stats.unlistedFiles).toEqual([]);
    expect(stats.budgetBytes).toBe(16 * 1024);
    // The naming file in full (50), then an index line and its newline for the
    // others: "- repo/overview.md: Overview" (28 + 1) and
    // "- sessions/note.md: Note (updated YYYY-MM-DD)" (45 + 1).
    expect(stats.promptBytes).toBe(50 + 29 + 46);
  });

  it('adds nothing to the prompt for a project without memory files', () => {
    expect(memory.getMemoryForSystemPrompt(REPO)).toBe('');
  });

  it('loads conventions in subfolders in full too', () => {
    writeMemory('conventions/frontend/naming.md', 'Frontend naming', 'NESTED RULE');
    expect(memory.getMemoryForSystemPrompt(REPO)).toContain('NESTED RULE');
  });

  it('lists one folder on its own', () => {
    writeMemory('repo/overview.md', 'Overview', 'x');
    writeMemory('sessions/a.md', 'A', 'x');
    writeMemory('sessions/deep/b.md', 'B', 'x');
    expect(memory.listMemoryFiles(REPO, 'sessions').map(e => [e.relativePath, e.folder]).sort()).toEqual([
      ['sessions/a.md', 'sessions'], ['sessions/deep/b.md', 'sessions/deep'],
    ]);
    expect(memory.listMemoryFiles(REPO, 'missing')).toEqual([]);
  });

  it('reads the description from frontmatter for memory_list', () => {
    writeWithDescription('repo/overview.md', 'Overview', 'Tech stack and layout', 'x');
    expect(memory.listMemoryFiles(REPO)[0].description).toBe('Tech stack and layout');
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

  function age(relPath: string, days: number): void {
    const when = new Date(NOW - days * DAY);
    fs.utimesSync(path.join(memoryDir(), relPath), when, when);
  }

  it('archives thread notes older than 30 days and keeps newer ones', () => {
    writeMemory('sessions/old.md', 'Old', 'old work', new Date(NOW - 31 * DAY).toISOString());
    age('sessions/old.md', 31);
    writeMemory('sessions/recent.md', 'Recent', 'note', new Date(NOW - 29 * DAY).toISOString());
    age('sessions/recent.md', 29);
    writeMemory('architecture/old.md', 'Lasting', 'note', new Date(NOW - 400 * DAY).toISOString());
    age('architecture/old.md', 400);

    const expired = expireSessionNotes(REPO, NOW);

    expect(expired).toEqual(['sessions/old.md']);
    expect(memory.readMemoryFile(REPO, 'sessions/recent.md')).not.toBeNull();
    // Other folders never expire
    expect(memory.readMemoryFile(REPO, 'architecture/old.md')).not.toBeNull();
    const archived = fs.readdirSync(path.join(memoryDir(), '_pruned-sessions'));
    expect(archived.some(name => name.endsWith('old.md'))).toBe(true);
  });

  it('keeps a note just written with an old updatedAt', () => {
    writeMemory('sessions/fresh.md', 'Fresh', 'just saved', new Date(NOW - 90 * DAY).toISOString());
    age('sessions/fresh.md', 0);

    expect(expireSessionNotes(REPO, NOW)).toEqual([]);
    expect(memory.readMemoryFile(REPO, 'sessions/fresh.md')).not.toBeNull();
  });

  it('never trims the archive, and keeps same-named notes from different folders apart', () => {
    for (let i = 0; i < 55; i++) {
      writeMemory(`sessions/n-${i}.md`, `N${i}`, `note ${i}`, new Date(NOW - 60 * DAY).toISOString());
      age(`sessions/n-${i}.md`, 60);
    }
    writeMemory('sessions/a/plan.md', 'A plan', 'from a', new Date(NOW - 60 * DAY).toISOString());
    age('sessions/a/plan.md', 60);
    writeMemory('sessions/b/plan.md', 'B plan', 'from b', new Date(NOW - 60 * DAY).toISOString());
    age('sessions/b/plan.md', 60);

    expect(expireSessionNotes(REPO, NOW)).toHaveLength(57);

    const archived = fs.readdirSync(path.join(memoryDir(), '_pruned-sessions'));
    expect(archived).toHaveLength(57);
    expect(archived.filter(n => n.endsWith('plan.md'))).toHaveLength(2);
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

  it('rejects an update to an existing file it was not shown', () => {
    const result = { files: [{ action: 'update' as const, path: 'repo/other.md', content: 'overwritten', reason: '' }] };
    const elsewhere = new Set(['repo/other.md']);
    expect(validateCompactionResult(result, original, elsewhere)).toContain('not shown');
  });

  it('rejects other spellings of a file it was not shown', () => {
    const elsewhere = new Set(['repo/other.md']);
    for (const spelling of ['./repo/other.md', 'repo\\other.md', 'repo/Other.md', 'repo/x/../other.md']) {
      const result = { files: [{ action: 'update' as const, path: spelling, content: 'overwritten', reason: '' }] };
      expect(validateCompactionResult(result, original, elsewhere)).toContain('not shown');
    }
  });

  it('rejects a file too large to keep, rather than cutting it off', () => {
    const result = { files: [{ action: 'update' as const, path: 'repo/overview.md', content: 'z'.repeat(17 * 1024), reason: '' }] };
    expect(validateCompactionResult(result, original)).toContain('too large');
  });

  it('rejects an update with empty content', () => {
    const result = {
      files: [{ action: 'update' as const, path: 'repo/overview.md', content: '   ', reason: '' }],
    };
    expect(validateCompactionResult(result, original)).toContain('empty content');
  });
});

// ─── compactMemory ───

// ─── Plans ───

describe('resolvePlan', () => {
  const entry = (relativePath: string, description = '') =>
    ({ relativePath, title: relativePath, description, updatedAt: '', folder: relativePath.split('/')[0] });

  it('keeps known files, one group each, under 48 KB a group', () => {
    const contents = {
      'repo/a.md': 'a'.repeat(20 * 1024),
      'repo/b.md': 'b'.repeat(20 * 1024),
      'repo/c.md': 'c'.repeat(20 * 1024),
      'repo/d.md': 'd',
    };
    const entries = Object.keys(contents).map(p => entry(p));

    const { groups } = resolvePlan({
      groups: [
        { paths: ['repo/a.md', 'repo/b.md', 'repo/c.md', 'repo/d.md'], reason: 'one' },
        { paths: ['repo/a.md', 'repo/unknown.md'], reason: 'two' },
        { paths: ['repo/c.md'], reason: 'three' },
      ],
      descriptions: [],
    }, entries, contents);

    expect(groups).toEqual([
      { paths: ['repo/a.md', 'repo/b.md', 'repo/d.md'], reason: 'one' },
      { paths: ['repo/c.md'], reason: 'three' },
    ]);
  });

  it('puts files with auto-save sections first and ignores paths like constructor', () => {
    const contents = { 'repo/plain.md': 'Body', 'repo/appended.md': 'Body\n\n## Added 2026-10-12\n\n- fact\n' };
    const entries = [entry('repo/plain.md'), entry('repo/appended.md')];

    const { groups } = resolvePlan({
      groups: [{ paths: ['constructor', '__proto__', 'repo/plain.md'], reason: 'overlap' }],
      descriptions: [{ path: 'toString', description: 'x' }],
    }, entries, contents);

    expect(groups).toEqual([
      { paths: ['repo/appended.md'], reason: 'fold in sections added by auto-save' },
      { paths: ['repo/plain.md'], reason: 'overlap' },
    ]);
  });

  it('adds files with auto-save sections the plan left out, and descriptions only where missing', () => {
    const contents = {
      'repo/appended.md': 'Body\n\n## Added 2026-10-12\n\n- fact\n',
      'repo/plain.md': 'Body',
      'repo/described.md': 'Body',
    };
    const entries = [entry('repo/appended.md'), entry('repo/plain.md'), entry('repo/described.md', 'Has one')];

    const { groups, descriptions } = resolvePlan({
      groups: [],
      descriptions: [
        { path: 'repo/plain.md', description: '  What   plain covers ' },
        { path: 'repo/described.md', description: 'Replacement' },
        { path: 'repo/missing.md', description: 'Unknown' },
      ],
    }, entries, contents);

    expect(groups).toEqual([{ paths: ['repo/appended.md'], reason: 'fold in sections added by auto-save' }]);
    expect(descriptions).toEqual([{ path: 'repo/plain.md', description: 'What plain covers' }]);
  });
});

describe('withDescription', () => {
  it('adds the description after the title and changes nothing else', () => {
    const content = '---\r\ntitle: "Flow"\r\nupdatedAt: "2026-01-01"\r\n---\r\n\r\nBody\r\n';
    expect(memory.withDescription(content, 'Says "what" it covers', 'Flow'))
      .toBe('---\r\ntitle: "Flow"\r\ndescription: "Says \'what\' it covers"\r\nupdatedAt: "2026-01-01"\r\n---\r\n\r\nBody\r\n');
  });

  it('fills in an empty description', () => {
    expect(memory.withDescription('---\ntitle: "A"\ndescription: ""\n---\n\nBody\n', 'New', 'A'))
      .toBe('---\ntitle: "A"\ndescription: "New"\n---\n\nBody\n');
  });

  it('leaves a file that already has a description alone, and gives one without frontmatter a header', () => {
    const described = '---\ntitle: "A"\ndescription: "Old"\n---\n\nBody\n';
    expect(memory.withDescription(described, 'New', 'A')).toBe(described);
    expect(memory.withDescription('Body\n', 'New', 'Plain')).toBe('---\ntitle: "Plain"\ndescription: "New"\n---\n\nBody\n');
  });
});

// ─── compactMemory ───

/** The planning reply, then one reply per merge step, in order. */
function replies(plan: unknown, ...merges: unknown[]): void {
  mockAdapter.generateText.mockReset();
  mockAdapter.generateText.mockResolvedValueOnce(JSON.stringify(plan));
  for (const m of merges) {
    mockAdapter.generateText.mockResolvedValueOnce(typeof m === 'string' ? m : JSON.stringify(m));
  }
}

const groupOf = (...paths: string[]) => ({ groups: [{ paths, reason: 'overlap' }], descriptions: [] });

/** A generateText that hangs until its abort signal fires, like a slow model. */
function hang(_sys: string, _user: string, opts?: unknown): Promise<string> {
  const signal = (opts as { abortSignal: AbortSignal }).abortSignal;
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Operation aborted')));
  });
}

describe('compactMemory', () => {
  it('plans from each file\'s index line and opening, not its full text', async () => {
    writeMemory('architecture/flow.md', 'Flow', `${'opening '.repeat(10)}${'z'.repeat(5000)}THE END`);
    replies({ groups: [], descriptions: [] });

    const status = await compactMemory({ repoPath: REPO });

    const plan = mockAdapter.generateText.mock.calls[0][0];
    expect(plan).toContain('### architecture/flow.md (');
    expect(plan).toContain('title: Flow');
    expect(plan).toContain('description: (none)');
    expect(plan).toContain('opening: opening opening');
    expect(plan).not.toContain('THE END');
    expect(status.compacted).toBe(false);
    expect(status.skippedReason).toBe('nothing to merge or describe');
    expect(mockAdapter.generateText).toHaveBeenCalledTimes(1);
  });

  it('runs every time it is asked, however small memory is', async () => {
    writeMemory('repo/overview.md', 'Overview', 'small');
    replies({ groups: [], descriptions: [] });
    await compactMemory({ repoPath: REPO });
    replies({ groups: [], descriptions: [] });
    await compactMemory({ repoPath: REPO });
    expect(mockAdapter.generateText).toHaveBeenCalledTimes(1); // reset by the second replies()
  });

  it('merges duplicates, resolves contradictions, and backs up originals', async () => {
    writeMemory('repo/overview.md', 'Overview', 'The project uses Vite.\nThe project uses Webpack.', '2024-01-01T00:00:00Z');
    writeMemory('repo/build.md', 'Build', 'The project uses Vite.', '2026-01-01T00:00:00Z');

    replies(groupOf('repo/overview.md', 'repo/build.md'), {
      files: [
        {
          action: 'update',
          path: 'repo/overview.md',
          content: '---\ntitle: "Overview"\nupdatedAt: "2026-01-01T00:00:00Z"\n---\n\nThe project uses Vite.\n',
          reason: 'merged build info, dropped contradicted Webpack claim',
        },
        { action: 'delete', path: 'repo/build.md', content: '', reason: 'merged into overview' },
      ],
    });

    const status = await compactMemory({ repoPath: REPO });

    // The merge step got both files in full
    const merge = mockAdapter.generateText.mock.calls[1][0];
    expect(merge).toContain('### repo/overview.md');
    expect(merge).toContain('The project uses Webpack.');

    expect(status.compacted).toBe(true);
    expect(status.filesChanged).toEqual(expect.arrayContaining(['repo/overview.md', 'repo/build.md']));
    expect(status.remainingGroups).toBe(0);
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

  it('adds missing descriptions from the plan without rewriting the files', async () => {
    writeMemory('architecture/flow.md', 'Flow', 'BODY STAYS');
    replies({ groups: [], descriptions: [{ path: 'architecture/flow.md', description: 'How data moves' }] });

    const status = await compactMemory({ repoPath: REPO });

    expect(status.compacted).toBe(true);
    expect(status.descriptionsAdded).toBe(1);
    expect(status.backupId).toBeTruthy();
    const written = memory.readMemoryFile(REPO, 'architecture/flow.md')!;
    expect(written).toContain('description: "How data moves"');
    expect(written).toContain('BODY STAYS');
    expect(memory.listMemoryFiles(REPO)[0].description).toBe('How data moves');
  });

  it('tells each merge step the 16 KB file limit', async () => {
    writeMemory('repo/a.md', 'A', 'a');
    replies(groupOf('repo/a.md'), { files: [{ action: 'keep', path: 'repo/a.md', content: '', reason: '' }] });
    await compactMemory({ repoPath: REPO });
    expect(mockAdapter.generateText.mock.calls[1][0]).toContain('under 16 KB');
  });

  it('reads a plan with commentary after it', async () => {
    writeMemory('architecture/flow.md', 'Flow', 'BODY');
    mockAdapter.generateText.mockResolvedValueOnce(
      '{"groups":[],"descriptions":[{"path":"architecture/flow.md","description":"Data flow"}]}\nNote: kept {x} as is.',
    );

    const status = await compactMemory({ repoPath: REPO });

    expect(status.descriptionsAdded).toBe(1);
  });

  it('adds descriptions to the file as it is after planning, not before', async () => {
    writeMemory('architecture/flow.md', 'Flow', 'BEFORE');
    mockAdapter.generateText.mockImplementationOnce(async () => {
      // Another thread's auto-save writes while the plan is being made
      writeMemory('architecture/flow.md', 'Flow', 'WRITTEN DURING PLANNING');
      return JSON.stringify({ groups: [], descriptions: [{ path: 'architecture/flow.md', description: 'Data flow' }] });
    });

    await compactMemory({ repoPath: REPO });

    const written = memory.readMemoryFile(REPO, 'architecture/flow.md')!;
    expect(written).toContain('WRITTEN DURING PLANNING');
    expect(written).toContain('description: "Data flow"');
  });

  it('skips a merge step whose files changed while the model worked', async () => {
    writeMemory('repo/a.md', 'A', 'original');
    mockAdapter.generateText.mockResolvedValueOnce(JSON.stringify(groupOf('repo/a.md')));
    mockAdapter.generateText.mockImplementationOnce(async () => {
      writeMemory('repo/a.md', 'A', 'CHANGED BY AUTO-SAVE');
      return JSON.stringify({ files: [{ action: 'update', path: 'repo/a.md', content: 'merged from stale text', reason: '' }] });
    });

    const status = await compactMemory({ repoPath: REPO });

    expect(status.compacted).toBe(false);
    expect(status.skippedReason).toBe('1 merge result was rejected');
    expect(memory.readMemoryFile(REPO, 'repo/a.md')).toContain('CHANGED BY AUTO-SAVE');
  });

  it('keeps finished merge steps, the summary and Undo when a later step fails', async () => {
    writeMemory('repo/a.md', 'A', 'a body');
    writeMemory('repo/b.md', 'B', 'b body');
    replies(
      { groups: [{ paths: ['repo/a.md'], reason: '' }, { paths: ['repo/b.md'], reason: '' }], descriptions: [] },
      { files: [{ action: 'update', path: 'repo/a.md', content: 'a tidied', reason: 'tidied' }] },
    );
    mockAdapter.generateText.mockRejectedValueOnce(new Error('CLI exited with code 1'));

    const status = await compactMemory({ repoPath: REPO });

    expect(status.compacted).toBe(true);
    expect(status.error).toBe('merge step 2 failed: CLI exited with code 1');
    expect(status.changes).toEqual([{ action: 'update', path: 'repo/a.md', reason: 'tidied' }]);
    expect(status.backupId).toBeTruthy();
    expect(status.remainingGroups).toBe(1);
    expect(memory.readMemoryFile(REPO, 'repo/a.md')).toBe('a tidied');
  });

  it('merges at most 6 groups a run and reports the rest', async () => {
    const plan = { groups: [] as Array<{ paths: string[]; reason: string }>, descriptions: [] };
    const merges: unknown[] = [];
    for (let i = 0; i < 8; i++) {
      writeMemory(`architecture/n-${i}.md`, `N${i}`, `note ${i}`);
      plan.groups.push({ paths: [`architecture/n-${i}.md`], reason: 'stale' });
      merges.push({ files: [{ action: 'update', path: `architecture/n-${i}.md`, content: `tidied ${i}`, reason: '' }] });
    }
    replies(plan, ...merges);

    const status = await compactMemory({ repoPath: REPO });

    expect(mockAdapter.generateText).toHaveBeenCalledTimes(7); // the plan + 6 merges
    expect(status.remainingGroups).toBe(2);
    expect(memory.readMemoryFile(REPO, 'architecture/n-5.md')).toBe('tidied 5');
    expect(memory.readMemoryFile(REPO, 'architecture/n-6.md')).toContain('note 6');
  });

  it('never lets a merge write to a file outside its group', async () => {
    writeMemory('repo/a.md', 'A', 'a body');
    writeMemory('repo/b.md', 'B', 'b body KEEP');
    replies(groupOf('repo/a.md'), {
      files: [
        { action: 'update', path: 'repo/a.md', content: 'a merged', reason: '' },
        { action: 'update', path: 'repo/b.md', content: 'clobbered', reason: '' },
      ],
    });

    const status = await compactMemory({ repoPath: REPO });

    expect(status.compacted).toBe(false);
    expect(status.skippedReason).toBe('1 merge result was rejected');
    expect(memory.readMemoryFile(REPO, 'repo/a.md')).toContain('a body');
    expect(memory.readMemoryFile(REPO, 'repo/b.md')).toContain('b body KEEP');
  });

  it('tidies a file with auto-save sections even when the plan leaves it out', async () => {
    memory.writeMemoryFile(REPO, 'architecture/flow.md', '---\ntitle: "Flow"\n---\n\nOld\n\n## Added 2026-10-12\n\n- New\n');
    replies({ groups: [], descriptions: [] }, {
      files: [{ action: 'update', path: 'architecture/flow.md', content: '---\ntitle: "Flow"\n---\n\nNew\n', reason: 'folded in' }],
    });

    const status = await compactMemory({ repoPath: REPO });

    expect(mockAdapter.generateText.mock.calls[1][0]).toContain('## Added 2026-10-12');
    expect(status.compacted).toBe(true);
    expect(memory.readMemoryFile(REPO, 'architecture/flow.md')).not.toContain('## Added');
  });

  describe('background model', () => {
    const settingsWith = (backgroundModels: Record<string, string>) => ({
      memoryAutoSave: true, backgroundModels,
    }) as unknown as ReturnType<typeof settings.getSettings>;

    async function modelUsed(): Promise<unknown> {
      writeMemory('repo/overview.md', 'Overview', 'fact');
      replies({ groups: [], descriptions: [] });
      await compactMemory({ repoPath: REPO });
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

  it('leaves files untouched when the plan is not JSON', async () => {
    writeMemory('repo/overview.md', 'Overview', 'important fact');
    mockAdapter.generateText.mockResolvedValue('not json at all');

    const status = await compactMemory({ repoPath: REPO });

    expect(status.compacted).toBe(false);
    expect(status.skippedReason).toBe('unparseable plan');
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('important fact');
  });

  it('skips a merge step whose reply is not JSON and runs the next', async () => {
    writeMemory('repo/a.md', 'A', 'a body');
    writeMemory('repo/b.md', 'B', 'b body');
    replies(
      { groups: [{ paths: ['repo/a.md'], reason: '' }, { paths: ['repo/b.md'], reason: '' }], descriptions: [] },
      'Sorry, no.',
      { files: [{ action: 'update', path: 'repo/b.md', content: 'b tidied', reason: 'tidied' }] },
    );

    const status = await compactMemory({ repoPath: REPO });

    expect(status.compacted).toBe(true);
    expect(status.changes).toEqual([{ action: 'update', path: 'repo/b.md', reason: 'tidied' }]);
    expect(memory.readMemoryFile(REPO, 'repo/a.md')).toContain('a body');
  });

  it('rejects and does not apply a destructive result', async () => {
    writeMemory('repo/overview.md', 'Overview', 'x'.repeat(3000));
    writeMemory('repo/details.md', 'Details', 'y'.repeat(3000));

    replies(groupOf('repo/overview.md', 'repo/details.md'), {
      files: [
        { action: 'delete', path: 'repo/overview.md', content: '', reason: '' },
        { action: 'update', path: 'repo/details.md', content: 'gone', reason: '' },
      ],
    });

    const status = await compactMemory({ repoPath: REPO });

    expect(status.compacted).toBe(false);
    expect(status.skippedReason).toBe('1 merge result was rejected');
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).not.toBeNull();
  });

  it('rejects a merged file too large to keep instead of cutting it off', async () => {
    writeMemory('repo/overview.md', 'Overview', 'x'.repeat(3000));
    replies(groupOf('repo/overview.md'), {
      files: [{ action: 'update', path: 'repo/overview.md', content: 'z'.repeat(64 * 1024), reason: '' }],
    });

    const status = await compactMemory({ repoPath: REPO });

    expect(status.compacted).toBe(false);
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('x'.repeat(3000));
  });

  it('archives expired thread notes even when nothing is merged', async () => {
    for (let i = 0; i < 25; i++) {
      // Within the last day, so only the cap applies, not the age limit
      writeMemory(`sessions/s-${String(i).padStart(2, '0')}.md`, `S${i}`, 'note', new Date(Date.now() - (25 - i) * 60_000).toISOString());
    }
    writeMemory('repo/overview.md', 'Overview', 'small');
    replies({ groups: [], descriptions: [] });

    const status = await compactMemory({ repoPath: REPO });

    expect(status.compacted).toBe(false);
    expect(status.filesChanged).toHaveLength(5); // 25 - 20 kept
    const remaining = memory.listMemoryFiles(REPO).filter(e => e.folder.startsWith('sessions'));
    expect(remaining).toHaveLength(20);
  });

  it('restore round-trips a compaction, snapshotting the pre-restore state', async () => {
    writeMemory('repo/overview.md', 'Overview', 'Uses Webpack');
    replies(groupOf('repo/overview.md'), {
      files: [{ action: 'update', path: 'repo/overview.md', content: '---\ntitle: "Overview"\n---\n\nUses Vite\n', reason: 'corrected' }],
    });

    await compactMemory({ repoPath: REPO });
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
    replies(groupOf('repo/overview.md'), {
      files: [
        { action: 'update', path: 'repo/overview.md', content: 'rewritten', reason: '' },
        { action: 'update', path: 'repo/merged.md', content: 'new merged file', reason: '' },
      ],
    });

    await compactMemory({ repoPath: REPO });
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
    replies(groupOf('repo/overview.md'), {
      files: [{ action: 'update', path: 'repo/overview.md', content: 'Uses Vite', reason: 'kept the newer claim' }],
    });

    const status = await compactMemory({ repoPath: REPO });

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
    expect(info.lastFilesChanged).toBe(1);
  });

  it('previews snapshot contents and reads single files without touching live memory', async () => {
    writeMemory('repo/overview.md', 'Overview', 'original body');
    replies(groupOf('repo/overview.md'), {
      files: [{ action: 'update', path: 'repo/overview.md', content: 'rewritten', reason: '' }],
    });

    const status = await compactMemory({ repoPath: REPO });
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
      replies(groupOf('repo/overview.md'), {
        files: [{ action: 'update', path: 'repo/overview.md', content: `version ${i}`, reason: '' }],
      });
      await compactMemory({ repoPath: REPO });
    }

    expect(listBackups(REPO)).toHaveLength(5);
  });

  it('reports an adapter failure as an error, not a skip, and leaves memory untouched', async () => {
    writeMemory('repo/overview.md', 'Overview', 'important fact');
    mockAdapter.generateText.mockRejectedValue(new Error('Operation aborted'));

    const status = await compactMemory({ repoPath: REPO });

    expect(status.compacted).toBe(false);
    expect(status.error).toContain('Operation aborted');
    expect(status.skippedReason).toBeUndefined();
    expect(memory.readMemoryFile(REPO, 'repo/overview.md')).toContain('important fact');
  });

  it('aborts a hung planning step after the timeout and reports a timeout error', async () => {
    vi.useFakeTimers();
    try {
      writeMemory('repo/overview.md', 'Overview', 'important fact');
      mockAdapter.generateText.mockImplementation(hang);

      const pending = compactMemory({ repoPath: REPO });
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      const status = await pending;

      expect(status.compacted).toBe(false);
      expect(status.error).toBe('planning timed out after 300s');
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
      vi.mocked(settings.getSettings).mockReturnValue({
        memoryAutoSave: true, memoryCompactTimeoutSeconds: 10, // below floor → 30s
      } as ReturnType<typeof settings.getSettings>);
      mockAdapter.generateText.mockImplementation(hang);

      const pending = compactMemory({ repoPath: REPO });
      await vi.advanceTimersByTimeAsync(30 * 1000);
      const status = await pending;

      expect(status.compacted).toBe(false);
      expect(status.error).toContain('timed out after 30s');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps finished merge steps when a later one times out', async () => {
    vi.useFakeTimers();
    try {
      writeMemory('repo/a.md', 'A', 'a body');
      writeMemory('repo/b.md', 'B', 'b body');
      replies(
        { groups: [{ paths: ['repo/a.md'], reason: '' }, { paths: ['repo/b.md'], reason: '' }], descriptions: [] },
        { files: [{ action: 'update', path: 'repo/a.md', content: 'a tidied', reason: '' }] },
      );
      mockAdapter.generateText.mockImplementationOnce(hang);

      const pending = compactMemory({ repoPath: REPO });
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      const status = await pending;

      expect(status.compacted).toBe(true);
      expect(status.error).toBe('merge step 2 timed out after 300s');
      expect(status.remainingGroups).toBe(1);
      expect(status.backupId).toBeTruthy();
      expect(memory.readMemoryFile(REPO, 'repo/a.md')).toBe('a tidied');
      expect(memory.readMemoryFile(REPO, 'repo/b.md')).toContain('b body');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelCompaction aborts a running pass, reported as cancelled with memory untouched', async () => {
    writeMemory('repo/overview.md', 'Overview', 'important fact');
    mockAdapter.generateText.mockImplementation(hang);

    const pending = compactMemory({ repoPath: REPO });
    // Give the pass a beat to reach the planning step, then cancel
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

  it('keeps finished merge steps when cancelled during a later one', async () => {
    writeMemory('repo/a.md', 'A', 'a body');
    writeMemory('repo/b.md', 'B', 'b body');
    replies(
      { groups: [{ paths: ['repo/a.md'], reason: '' }, { paths: ['repo/b.md'], reason: '' }], descriptions: [] },
      { files: [{ action: 'update', path: 'repo/a.md', content: 'a tidied', reason: '' }] },
    );
    mockAdapter.generateText.mockImplementationOnce(hang);

    const pending = compactMemory({ repoPath: REPO });
    await vi.waitFor(() => expect(mockAdapter.generateText).toHaveBeenCalledTimes(3));
    cancelCompaction(REPO);
    const status = await pending;

    expect(status.compacted).toBe(true);
    expect(status.skippedReason).toBe('cancelled');
    expect(memory.readMemoryFile(REPO, 'repo/a.md')).toBe('a tidied');
    expect(memory.readMemoryFile(REPO, 'repo/b.md')).toContain('b body');
  });

  it('emits stage events with merge steps, then done', async () => {
    writeMemory('repo/overview.md', 'Overview', 'fact');
    replies(groupOf('repo/overview.md'), {
      files: [{ action: 'update', path: 'repo/overview.md', content: 'condensed fact', reason: '' }],
    });

    const events: CompactionEvent[] = [];
    const unsubscribe = onCompactionEvent(e => events.push(e));
    try {
      await compactMemory({ repoPath: REPO });
    } finally {
      unsubscribe();
    }

    const stages = events.filter(e => e.kind === 'stage');
    expect(stages).toEqual([
      { kind: 'stage', repoPath: REPO, stage: 'pruning' },
      { kind: 'stage', repoPath: REPO, stage: 'planning' },
      { kind: 'stage', repoPath: REPO, stage: 'merging', step: 1, total: 1 },
    ]);
    const done = events.find(e => e.kind === 'done') as Extract<CompactionEvent, { kind: 'done' }>;
    expect(done.status.compacted).toBe(true);
  });
});
