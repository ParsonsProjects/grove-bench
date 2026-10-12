import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { AgentEvent } from '../shared/types.js';

// What an auto-save shows the model of existing memory, and what it may
// write back. Uses real memory files in a temp folder.

const adapter = vi.hoisted(() => ({
  id: 'mock',
  generateText: vi.fn<(system: string, user: string, opts?: unknown) => Promise<string>>(),
}));

vi.mock('./settings.js', () => ({
  getSettings: () => ({ memoryAutoSave: true, backgroundModels: {} }),
}));
vi.mock('./memory-compact.js', () => ({ expireSessionNotes: vi.fn(() => []) }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./adapters/index.js', () => ({
  adapterRegistry: { get: () => adapter, getDefault: () => adapter },
}));

import * as memory from './memory.js';
import {
  memoryFilesTouched,
  selectExtractionContext,
  appendSection,
  triggerAutoSaveImmediate,
  _resetForTests,
  EXTRACTION_FULL_BYTES,
} from './memory-autosave.js';

let tmpDir: string;
let REPO: string;

function write(relPath: string, title: string, body: string, description = '', updatedAt = '2026-10-01T00:00:00Z'): void {
  memory.writeMemoryFile(REPO, relPath,
    `---\ntitle: "${title}"\n${description ? `description: "${description}"\n` : ''}updatedAt: "${updatedAt}"\n---\n\n${body}\n`);
}

function toolUse(toolUseId: string, toolName: string, toolInput: unknown): AgentEvent {
  return { type: 'assistant_tool_use', toolName, toolInput, toolUseId, uuid: toolUseId };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-autosave-context-'));
  REPO = path.join(tmpDir, 'repo');
  vi.mocked(app.getPath).mockReturnValue(tmpDir);
  adapter.generateText.mockReset();
  _resetForTests();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('memoryFilesTouched', () => {
  it('finds memory files read or written, most recent first, from Claude Code and ACP calls', () => {
    const events: AgentEvent[] = [
      toolUse('1', 'mcp__grove-memory__memory_read', { path: 'repo/overview.md' }),
      toolUse('2', 'Read', { file_path: 'src/app.ts' }),
      toolUse('3', 'grove-memory_memory_write', { path: 'conventions\\naming.md' }),
      // ACP: the input arrives after the call
      toolUse('4', 'memory_read', {}),
      { type: 'tool_update', toolUseId: '4', toolInput: { path: 'architecture/flow.md' } },
      toolUse('5', 'mcp__grove-memory__memory_list', {}),
    ];

    expect(memoryFilesTouched(events)).toEqual(['architecture/flow.md', 'conventions/naming.md', 'repo/overview.md']);
  });
});

describe('selectExtractionContext', () => {
  it('shows touched files, the thread note, conventions and topic matches in full; the rest as index lines', () => {
    write('architecture/touched.md', 'Touched', 'TOUCHED');
    write('sessions/feat.md', 'Feat', 'OWN NOTE');
    write('sessions/other.md', 'Other thread', 'OTHER NOTE');
    write('conventions/naming.md', 'Naming', 'NAMING');
    write('architecture/asset-library.md', 'Asset Library Multi-select', 'ASSETS');
    write('architecture/credits.md', 'AI Credits Usage Page', 'CREDITS', 'Where credit usage is shown');

    const context = selectExtractionContext(
      REPO,
      '[User]: the assetLibrary picker loses its selection',
      ['architecture/touched.md'],
      'sessions/feat.md',
    );

    expect(Object.keys(context.full).sort()).toEqual([
      'architecture/asset-library.md', 'architecture/touched.md', 'conventions/naming.md', 'sessions/feat.md',
    ]);
    expect(context.indexLines).toEqual(['- architecture/credits.md: AI Credits Usage Page. Where credit usage is shown']);
    // Other threads' notes are neither shown nor listed
    expect(JSON.stringify(context)).not.toContain('sessions/other.md');
  });

  it('shows the thread\'s own note before the files it touched', () => {
    write('sessions/feat.md', 'Feat', 'n'.repeat(6 * 1024));
    for (let i = 0; i < 5; i++) write(`architecture/t-${i}.md`, `T${i}`, 't'.repeat(4 * 1024));

    const context = selectExtractionContext(
      REPO, '', [0, 1, 2, 3, 4].map(i => `architecture/t-${i}.md`), 'sessions/feat.md',
    );

    expect(Object.keys(context.full)).toContain('sessions/feat.md');
    expect(context.sessionNoteExists).toBe(true);
  });

  it('loads conventions in subfolders', () => {
    write('conventions/frontend/naming.md', 'Frontend naming', 'RULE');
    const context = selectExtractionContext(REPO, '', [], 'sessions/feat.md');
    expect(Object.keys(context.full)).toEqual(['conventions/frontend/naming.md']);
  });

  it('keeps the full text within its budget however large memory is', () => {
    for (let i = 0; i < 100; i++) {
      write(`architecture/topic-${i}.md`, `Upload topic ${i}`, 'x'.repeat(4 * 1024));
    }

    const context = selectExtractionContext(REPO, '[User]: fix the upload', [], 'sessions/feat.md');

    const shownBytes = Object.values(context.full).reduce((sum, c) => sum + Buffer.byteLength(c), 0);
    expect(shownBytes).toBeLessThanOrEqual(EXTRACTION_FULL_BYTES);
    expect(Object.keys(context.full).length).toBeGreaterThan(0);
    expect(Object.keys(context.full).length + context.indexLines.length + context.unlisted).toBe(100);
  });
});

describe('appendSection', () => {
  it('adds a dated section and moves updatedAt, dropping frontmatter from the addition', () => {
    const existing = '---\ntitle: "Flow"\nupdatedAt: "2025-01-01T00:00:00Z"\n---\n\nOld body\n';
    const now = new Date('2026-10-12T10:00:00Z');

    const result = appendSection(existing, '---\ntitle: "x"\n---\n- New fact', now);

    expect(result).toBe(
      '---\ntitle: "Flow"\nupdatedAt: "2026-10-12T10:00:00.000Z"\n---\n\nOld body\n\n## Added 2026-10-12\n\n- New fact\n',
    );
  });

  it('stamps only the frontmatter, with Windows line endings or unquoted dates', () => {
    const existing = '---\r\ntitle: Flow\r\nupdatedAt: 2025-01-01\r\n---\r\n\r\nupdatedAt: in the body\r\n';
    const result = appendSection(existing, 'fact', new Date('2026-10-12T10:00:00Z'));

    expect(result.startsWith('---\r\ntitle: Flow\r\nupdatedAt: 2026-10-12T10:00:00.000Z\r\n---')).toBe(true);
    expect(result).toContain('updatedAt: in the body');
  });

  it('leaves a file without frontmatter as it was, plus the section', () => {
    expect(appendSection('Body', 'fact', new Date('2026-10-12T10:00:00Z'))).toBe('Body\n\n## Added 2026-10-12\n\nfact\n');
  });

  it('caps a long addition', () => {
    const result = appendSection('Body', 'y'.repeat(10_000));
    expect(result.length).toBeLessThan(4200);
  });
});

describe('applying an extraction', () => {
  function events(): AgentEvent[] {
    const list: AgentEvent[] = [];
    for (let i = 0; i < 3; i++) {
      list.push({ type: 'user_message', text: `work on the payments page ${i}` } as AgentEvent);
      list.push({ type: 'assistant_text', text: 'done', uuid: `a${i}` } as AgentEvent);
    }
    return list;
  }

  async function save(files: unknown[]): Promise<string> {
    adapter.generateText.mockResolvedValue(JSON.stringify({ files, sessionNote: { shouldSave: false, content: '' } }));
    await triggerAutoSaveImmediate({ sessionId: 's1', repoPath: REPO, cwd: REPO, events: events(), branchName: 'feat' });
    return adapter.generateText.mock.calls[0][0];
  }

  it('never rewrites a file the model saw only in the index, but lets it append there', async () => {
    write('architecture/payments.md', 'Payments page', 'PAYMENTS');
    write('architecture/unrelated.md', 'Search indexing', 'KEEP ME');
    write('architecture/also-unrelated.md', 'Render queue', 'APPEND HERE');

    const prompt = await save([
      { action: 'update', path: 'architecture/payments.md', content: 'PAYMENTS v2', reason: '' },
      { action: 'update', path: 'architecture/unrelated.md', content: 'partial rewrite', reason: '' },
      { action: 'append', path: 'architecture/also-unrelated.md', content: '- one more fact', reason: '' },
      { action: 'create', path: 'architecture/new-topic.md', content: 'NEW', reason: '' },
    ]);

    // Shown in full because it matches the conversation; the others are index lines
    expect(prompt).toContain('### architecture/payments.md');
    expect(prompt).toContain('- architecture/unrelated.md: Search indexing');
    expect(prompt).not.toContain('KEEP ME');

    expect(memory.readMemoryFile(REPO, 'architecture/payments.md')).toBe('PAYMENTS v2');
    expect(memory.readMemoryFile(REPO, 'architecture/unrelated.md')).toContain('KEEP ME');
    const appended = memory.readMemoryFile(REPO, 'architecture/also-unrelated.md')!;
    expect(appended).toContain('APPEND HERE');
    expect(appended).toMatch(/## Added \d{4}-\d{2}-\d{2}\n\n- one more fact\n$/);
    expect(memory.readMemoryFile(REPO, 'architecture/new-topic.md')).toBe('NEW');
  });

  it('adds to a thread note too long to show instead of replacing it', async () => {
    write('sessions/feat.md', 'Feat', `EARLY DECISIONS ${'n'.repeat(30 * 1024)}`);
    adapter.generateText.mockResolvedValue(JSON.stringify({
      files: [], sessionNote: { shouldSave: true, content: '---\ntitle: "Feat"\n---\n\n- latest step' },
    }));

    await triggerAutoSaveImmediate({ sessionId: 's1', repoPath: REPO, cwd: REPO, events: events(), branchName: 'feat' });

    expect(adapter.generateText.mock.calls[0][0]).toContain('It exists but is too long to show here');
    const note = memory.readMemoryFile(REPO, 'sessions/feat.md')!;
    expect(note).toContain('EARLY DECISIONS');
    expect(note).toMatch(/## Added \d{4}-\d{2}-\d{2}\n\n- latest step\n$/);
  });

  it('tells the model today\'s date for updatedAt', async () => {
    const prompt = await save([]);
    expect(prompt).toContain(`Today is ${new Date().toISOString().slice(0, 10)}.`);
  });

  it('accepts another spelling of a file it was shown', async () => {
    write('architecture/payments.md', 'Payments page', 'PAYMENTS');
    await save([{ action: 'update', path: './architecture/payments.md', content: 'PAYMENTS v2', reason: '' }]);
    expect(memory.readMemoryFile(REPO, 'architecture/payments.md')).toBe('PAYMENTS v2');
  });

  it('sends a fraction of a large memory', async () => {
    // Every file matches the conversation, so the full-text budget fills up
    for (let i = 0; i < 90; i++) {
      write(`architecture/payments-${i}.md`, `Payments topic ${i}`, 'x'.repeat(4 * 1024));
    }

    const prompt = await save([]);

    // About 370 KB of memory; the prompt holds what fits the budget plus the index
    const bytes = Buffer.byteLength(prompt);
    expect(bytes).toBeGreaterThan(EXTRACTION_FULL_BYTES - 5 * 1024);
    expect(bytes).toBeLessThan(EXTRACTION_FULL_BYTES + 16 * 1024 + 8 * 1024);
    expect(prompt.match(/^- architecture\/payments-\d+\.md: /gm)?.length).toBeGreaterThan(80);
  });
});
