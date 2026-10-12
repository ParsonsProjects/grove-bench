import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logger } from './logger.js';
import * as memory from './memory.js';
import * as settings from './settings.js';
import { backgroundAgentFor, backgroundModelFor } from './background-tasks.js';
import { effectiveCompactTimeoutSeconds } from '../shared/compact-timeout.js';
import type { MemoryEntry } from '../shared/types.js';
import type { AgentAdapter } from './adapters/types.js';

// ─── Types ───

const CompactionFileSchema = z.object({
  action: z.enum(['update', 'delete', 'keep']),
  path: z.string(),
  content: z.string().optional().default(''),
  reason: z.string().optional().default(''),
});

const CompactionResultSchema = z.object({
  files: z.array(CompactionFileSchema),
});

const CompactionPlanSchema = z.object({
  groups: z.array(z.object({
    paths: z.array(z.string()),
    reason: z.string().optional().default(''),
  })).optional().default([]),
  descriptions: z.array(z.object({
    path: z.string(),
    description: z.string(),
  })).optional().default([]),
});

export type CompactionResult = z.infer<typeof CompactionResultSchema>;

export interface CompactionChange {
  action: 'update' | 'delete';
  path: string;
  /** The model's stated reason: what was merged, dropped, or resolved. */
  reason: string;
}

export interface CompactionStatus {
  compacted: boolean;
  /** Why compaction was skipped, when it was. */
  skippedReason?: string;
  /** The pass was attempted but failed (timeout, adapter error) — not a no-op. */
  error?: string;
  /** Paths written, rewritten, or deleted. */
  filesChanged: string[];
  /** Per-file summary of what the compaction pass did. */
  changes?: CompactionChange[];
  /** Snapshot taken before applying — pass to restoreBackup to undo. */
  backupId?: string;
  /** Files that got a description from the planning step. */
  descriptionsAdded?: number;
  /** Merge groups planned but left for the next run. */
  remainingGroups?: number;
}

export interface CompactionInfo {
  lastCompactedAt: string | null;
  lastFilesChanged?: number;
}

export interface BackupInfo {
  /** Directory name under _compact-backup, sortable newest-last. */
  id: string;
  /** ISO timestamp of when the backup was taken. */
  createdAt: string;
  fileCount: number;
}

export interface RestoreStatus {
  restored: boolean;
  error?: string;
  /** Paths written or deleted by the restore. */
  filesChanged: string[];
}

export interface CompactOptions {
  repoPath: string;
  /** Working directory for the text-generation adapter. Defaults to repoPath. */
  cwd?: string;
  /** Which adapter to use for text generation (defaults to registry default). */
  adapterType?: string;
}

// ─── Constants ───

/** Most merge groups one run works through; the rest wait for the next run,
 *  so a run takes minutes, not an hour, and Undo covers one run. */
const MAX_GROUPS_PER_RUN = 6;

/** Full text one merge step reads, at most. */
const MAX_GROUP_BYTES = 48 * 1024;

/** Opening text the planning step reads of each file, at most. */
const PLAN_PREVIEW_CHARS = 300;

/** Rough cap on the planning step's input: previews shrink for large memory. */
const PLAN_INPUT_BYTES = 64 * 1024;

/** Descriptions one run adds, at most. */
const MAX_DESCRIPTIONS_PER_RUN = 200;

/** The safety timeout for each model call (planning, then each merge step),
 *  from the memoryCompactTimeoutSeconds setting (default 5 minutes). */
function compactTimeoutSeconds(): number {
  return effectiveCompactTimeoutSeconds(settings.getSettings().memoryCompactTimeoutSeconds);
}

/** Largest file a merge may write; a bigger one rejects the step rather
 *  than being cut off mid-sentence. */
const MAX_COMPACTED_FILE_BYTES = 16 * 1024;

/** Folders the compaction pass is allowed to touch. Session notes are pruned deterministically instead. */
const COMPACTABLE_FOLDERS = ['repo', 'conventions', 'architecture'];

const BACKUP_DIR = '_compact-backup';

/** Timestamped backup snapshots kept before rotation. */
const MAX_BACKUPS = 5;

/** Hidden folder where auto-pruned session notes are archived instead of destroyed. */
const PRUNED_ARCHIVE_DIR = '_pruned-sessions';

/** Archived pruned notes kept before the oldest are dropped for real. */
const MAX_ARCHIVED_NOTES = 50;

/** Compaction currently running, keyed by repo path. */
const inProgress = new Set<string>();

// ─── Last run ───

function compactStatePath(repoPath: string): string {
  return path.join(memory.getMemoryDir(repoPath), '_compact.json');
}

function setLastCompactedAt(repoPath: string, ts: number, filesChanged: number): void {
  try {
    fs.writeFileSync(compactStatePath(repoPath), JSON.stringify({
      lastCompactedAt: new Date(ts).toISOString(),
      lastFilesChanged: filesChanged,
    }, null, 2));
  } catch (err) {
    logger.warn(`[memory-compact] Failed to persist compaction state: ${err}`);
  }
}

/** When the last compaction run changed something — the panel's trace line. */
export function getCompactionInfo(repoPath: string): CompactionInfo {
  try {
    const raw = JSON.parse(fs.readFileSync(compactStatePath(repoPath), 'utf-8'));
    if (typeof raw.lastCompactedAt === 'string' && !Number.isNaN(Date.parse(raw.lastCompactedAt))) {
      return {
        lastCompactedAt: raw.lastCompactedAt,
        lastFilesChanged: typeof raw.lastFilesChanged === 'number' ? raw.lastFilesChanged : undefined,
      };
    }
  } catch {
    // No state yet
  }
  return { lastCompactedAt: null };
}

// ─── Helpers ───

/** Read all non-session memory files as path → content. */
function readNonSessionContents(repoPath: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of memory.listMemoryFiles(repoPath)) {
    if (entry.folder.startsWith('sessions')) continue;
    const content = memory.readMemoryFile(repoPath, entry.relativePath);
    if (content) result[entry.relativePath] = content;
  }
  return result;
}

function totalBytes(contents: Record<string, string>): number {
  return Object.values(contents).reduce((sum, c) => sum + Buffer.byteLength(c, 'utf-8'), 0);
}

/** A compaction result may only touch existing repo/conventions/architecture files, or create new ones there. */
function isAllowedCompactionPath(relativePath: string): boolean {
  const normalized = path.normalize(relativePath).replace(/\\/g, '/');
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) return false;
  return COMPACTABLE_FOLDERS.some(folder => normalized.startsWith(`${folder}/`)) && normalized.endsWith('.md');
}

// ─── Thread notes ───

/**
 * A note's effective age: frontmatter `updatedAt` when parseable, else the
 * file's mtime — an actively-written note with stale or missing frontmatter
 * must never look old enough to prune.
 */
function noteTimestamp(repoPath: string, entry: { relativePath: string; updatedAt: string }): number {
  const parsed = Date.parse(entry.updatedAt);
  if (!Number.isNaN(parsed)) return parsed;
  try {
    return fs.statSync(path.join(memory.getMemoryDir(repoPath), entry.relativePath)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Move a pruned note into the hidden archive folder (a safety net — automatic
 * pruning must never be the only copy's destruction). Oldest archived notes
 * beyond the cap are dropped for real.
 */
function archivePrunedNote(repoPath: string, relativePath: string, content: string): void {
  const archiveDir = path.join(memory.getMemoryDir(repoPath), PRUNED_ARCHIVE_DIR);
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
    // Prefix with a timestamp so re-pruned same-named notes never overwrite each other
    const name = `${Date.now()}-${path.basename(relativePath)}`;
    fs.writeFileSync(path.join(archiveDir, name), content);

    const archived = fs.readdirSync(archiveDir).sort(); // timestamp prefix → chronological
    for (const stale of archived.slice(0, Math.max(0, archived.length - MAX_ARCHIVED_NOTES))) {
      fs.rmSync(path.join(archiveDir, stale), { force: true });
    }
  } catch (err) {
    logger.warn(`[memory-compact] Failed to archive pruned note ${relativePath}: ${err}`);
  }
}

/**
 * Prune the oldest session notes beyond the cap. Runs without an LLM.
 * Ordering: frontmatter `updatedAt` descending, falling back to file mtime for
 * notes without a parseable timestamp. Pruned notes are archived to the hidden
 * _pruned-sessions folder before removal. Returns the paths of pruned notes.
 */
export function pruneSessionNotes(repoPath: string, keep: number = memory.MAX_SESSION_NOTES): string[] {
  const sessionEntries = memory
    .listMemoryFiles(repoPath)
    .filter(e => e.folder.startsWith('sessions'));

  if (sessionEntries.length <= keep) return [];

  const sorted = sessionEntries
    .map(e => ({ entry: e, ts: noteTimestamp(repoPath, e) }))
    .sort((a, b) => b.ts - a.ts);

  const deleted: string[] = [];
  for (const { entry } of sorted.slice(keep)) {
    const content = memory.readMemoryFile(repoPath, entry.relativePath);
    if (content) archivePrunedNote(repoPath, entry.relativePath, content);
    if (memory.deleteMemoryFile(repoPath, entry.relativePath)) {
      deleted.push(entry.relativePath);
    }
  }

  if (deleted.length > 0) {
    logger.info(`[memory-compact] Pruned ${deleted.length} old session notes (archived): ${deleted.join(', ')}`);
  }
  return deleted;
}

/**
 * Archive thread notes not updated for SESSION_NOTE_MAX_AGE_DAYS, then keep at
 * most MAX_SESSION_NOTES of the rest. Thread notes hold one piece of work, so
 * they expire; lasting knowledge belongs in the other folders. Runs without an
 * LLM after every memory auto-save and when a thread starts. Returns the paths
 * of archived notes.
 */
export function expireSessionNotes(repoPath: string, now: number = Date.now()): string[] {
  const cutoff = now - memory.SESSION_NOTE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const expired: string[] = [];
  for (const entry of memory.listMemoryFiles(repoPath)) {
    if (!entry.folder.startsWith('sessions')) continue;
    if (noteTimestamp(repoPath, entry) >= cutoff) continue;
    const content = memory.readMemoryFile(repoPath, entry.relativePath);
    if (content) archivePrunedNote(repoPath, entry.relativePath, content);
    if (memory.deleteMemoryFile(repoPath, entry.relativePath)) {
      expired.push(entry.relativePath);
    }
  }

  if (expired.length > 0) {
    logger.info(`[memory-compact] Archived ${expired.length} thread notes older than ${memory.SESSION_NOTE_MAX_AGE_DAYS} days: ${expired.join(', ')}`);
  }
  return [...expired, ...pruneSessionNotes(repoPath)];
}

// ─── Backups ───

function backupRoot(repoPath: string): string {
  return path.join(memory.getMemoryDir(repoPath), BACKUP_DIR);
}

/** Filesystem-safe, lexicographically sortable id, e.g. "2026-08-29T16-25-30-123Z". */
function newBackupId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Copy the given memory contents into a timestamped snapshot folder under
 * _compact-backup (underscore-prefixed, so it is invisible to memory listing
 * and the system prompt). The oldest snapshots beyond MAX_BACKUPS are removed.
 * Returns the snapshot id, or null when the backup could not be written.
 */
function backupMemory(repoPath: string, contents: Record<string, string>): string | null {
  const root = backupRoot(repoPath);
  let id = newBackupId();
  // Same-millisecond collisions get a numeric suffix, which still sorts newest-last
  for (let n = 2; fs.existsSync(path.join(root, id)); n++) {
    id = `${newBackupId()}-${n}`;
  }

  try {
    for (const [relPath, content] of Object.entries(contents)) {
      const target = path.join(root, id, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }

    // Rotate: ids sort chronologically, oldest first
    const snapshots = fs
      .readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
    for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - MAX_BACKUPS))) {
      fs.rmSync(path.join(root, stale), { recursive: true, force: true });
    }

    return id;
  } catch (err) {
    logger.warn(`[memory-compact] Failed to back up memory: ${err}`);
    return null;
  }
}

/** Resolve and validate a backup id, guarding against path traversal. */
function resolveBackupDir(repoPath: string, backupId: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(backupId)) return null;
  const dir = path.join(backupRoot(repoPath), backupId);
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : null;
}

/** Read a snapshot's files as relative path → content. Ignores anything outside the compactable folders. */
function readBackupContents(dir: string): Record<string, string> {
  const contents: Record<string, string> = {};

  function walk(current: string, prefix: string) {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const relPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        walk(path.join(current, item.name), relPath);
      } else if (isAllowedCompactionPath(relPath)) {
        contents[relPath] = fs.readFileSync(path.join(current, item.name), 'utf-8');
      }
    }
  }

  walk(dir, '');
  return contents;
}

/** The files inside one snapshot, for previewing before a restore. */
export function previewBackup(repoPath: string, backupId: string): Array<{ path: string; bytes: number }> {
  const dir = resolveBackupDir(repoPath, backupId);
  if (!dir) return [];
  return Object.entries(readBackupContents(dir))
    .map(([p, content]) => ({ path: p, bytes: Buffer.byteLength(content, 'utf-8') }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Read one file from a snapshot (read-only peek — never touches live memory). */
export function readBackupFile(repoPath: string, backupId: string, relativePath: string): string | null {
  const dir = resolveBackupDir(repoPath, backupId);
  if (!dir || !isAllowedCompactionPath(relativePath)) return null;
  return readBackupContents(dir)[path.normalize(relativePath).replace(/\\/g, '/')] ?? null;
}

/** List available backup snapshots, newest first. */
export function listBackups(repoPath: string): BackupInfo[] {
  const root = backupRoot(repoPath);
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return dirs
    .filter(d => d.isDirectory())
    .map(d => {
      const dir = path.join(root, d.name);
      let createdAt = '';
      try {
        createdAt = fs.statSync(dir).mtime.toISOString();
      } catch {
        // Leave createdAt empty
      }
      return {
        id: d.name,
        createdAt,
        fileCount: Object.keys(readBackupContents(dir)).length,
      };
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

/**
 * Restore the non-session memory files from a backup snapshot, replacing the
 * current repo/, conventions/ and architecture/ contents. The pre-restore
 * state is snapshotted first, so a restore is itself undoable.
 */
export function restoreBackup(repoPath: string, backupId: string): RestoreStatus {
  const dir = resolveBackupDir(repoPath, backupId);
  if (!dir) {
    return { restored: false, error: `Unknown backup: ${backupId}`, filesChanged: [] };
  }

  const backupContents = readBackupContents(dir);
  if (Object.keys(backupContents).length === 0) {
    return { restored: false, error: 'Backup is empty', filesChanged: [] };
  }

  // Snapshot current state AFTER reading the backup — rotation may prune the
  // very snapshot being restored when it is the oldest one.
  const current = readNonSessionContents(repoPath);
  backupMemory(repoPath, current);

  const filesChanged: string[] = [];

  // Remove files the backup doesn't have (e.g. merged files a compaction created)
  for (const relPath of Object.keys(current)) {
    if (!(relPath in backupContents) && isAllowedCompactionPath(relPath)) {
      if (memory.deleteMemoryFile(repoPath, relPath)) filesChanged.push(relPath);
    }
  }

  for (const [relPath, content] of Object.entries(backupContents)) {
    try {
      memory.writeMemoryFile(repoPath, relPath, content);
      filesChanged.push(relPath);
    } catch (err) {
      logger.warn(`[memory-compact] Failed to restore ${relPath}: ${err}`);
    }
  }

  logger.info(`[memory-compact] Restored backup ${backupId} for ${repoPath}: ${filesChanged.length} files`);
  return { restored: true, filesChanged };
}

// ─── Prompts ───

const FILE_RULES = `- Each kept file retains markdown with YAML frontmatter (title, description, updatedAt). The description is one line, under 100 characters, saying what the file covers: agents see only the title and description until they read the file, so keep it accurate when the content changes. Set updatedAt to the newest timestamp among its merged sources.`;

/**
 * The planning step: every file's path, size, title, description and opening
 * text, so the model can find overlaps across all of memory without reading
 * it in full, and describe files that have no description.
 */
function buildPlanPrompt(entries: MemoryEntry[], contents: Record<string, string>): string {
  const perFile = Math.floor(PLAN_INPUT_BYTES / Math.max(1, entries.length)) - 200;
  const previewChars = Math.max(0, Math.min(PLAN_PREVIEW_CHARS, perFile));
  const files = entries.map((e) => {
    const content = contents[e.relativePath];
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '').replace(/\s+/g, ' ').trim();
    const kb = (Buffer.byteLength(content, 'utf-8') / 1024).toFixed(1);
    const lines = [
      `### ${e.relativePath} (${kb} KB${e.updatedAt ? `, updated ${e.updatedAt.slice(0, 10)}` : ''})`,
      `title: ${e.title}`,
      `description: ${e.description || '(none)'}`,
    ];
    if (previewChars > 0 && body) lines.push(`opening: ${body.slice(0, previewChars)}`);
    return lines.join('\n');
  });

  return `You are planning a clean-up of a project's memory files. Each file below is shown by its path, size, title, description and opening text, not in full.

## Files
${files.join('\n\n')}

## Instructions
1. Find groups of files that overlap: the same topic, the same facts repeated, or one topic split across files. Each group is merged later by someone who reads its files in full. List the groups with the most overlap first. A file goes in at most one group, and a group's files add up to under ${MAX_GROUP_BYTES / 1024} KB. A group may be a single file whose content looks stale or contradictory. Leave out files that look fine.
2. Write a description for every file whose description is "(none)": one line, under 100 characters, saying what the file covers, based only on its title and opening text.

Respond with ONLY valid JSON matching this schema (no markdown fences):
{
  "groups": [{ "paths": ["folder/a.md", "folder/b.md"], "reason": "what they share" }],
  "descriptions": [{ "path": "folder/a.md", "description": "one line" }]
}`;
}

/** One merge step: a group of files in full, rewritten into fewer, coherent files. */
function buildMergePrompt(contents: Record<string, string>, reason: string): string {
  const memorySection = Object.entries(contents)
    .map(([p, c]) => `### ${p}\n${c}`)
    .join('\n\n');

  return `You are a memory compaction assistant. The project memory files below were picked for clean-up${reason ? ` (${reason})` : ''}. They may contain duplicated, stale, and contradictory information. Your job is to consolidate them into a smaller, coherent set.

## Files
${memorySection}

## Instructions
Rewrite these files so that:
- Duplicated facts appear exactly once, in the single most appropriate file.
- Contradictions are resolved, never kept side by side. When two statements conflict, keep the one from the file with the newer \`updatedAt\` frontmatter; within one file, keep the later statement. Explicit user corrections (e.g. "the user clarified/corrected...") always win over inferred facts.
- Sections headed "## Added <date>" were appended after the rest of the file: fold them into the body where they belong, and let them win over older statements they contradict.
- Stale, ephemeral, or session-specific details (old debugging notes, temporary state, completed one-off tasks) are dropped.
- Files covering the same topic are merged; near-empty leftovers are deleted.
- Each file stays concise and factual.
- Nothing is invented: every retained statement must come from the files above. Prefer dropping a doubtful statement over rephrasing it into something new.
- Only these files change: update or delete them, or create one new file in repo/, conventions/ or architecture/ for merged content. Never write to any other existing file.
${FILE_RULES}

Actions:
- "update": replace the file's content with the compacted version (also used for a new merged file).
- "delete": remove the file (its surviving content was merged elsewhere or is stale).
- "keep": file is already fine, leave untouched (content may be empty for "keep").

Respond with ONLY valid JSON matching this schema (no markdown fences):
{
  "files": [
    {
      "action": "update" | "delete" | "keep",
      "path": "folder/filename.md",
      "content": "full markdown content including YAML frontmatter (empty for delete/keep)",
      "reason": "what was merged, dropped, or resolved"
    }
  ]
}`;
}

/** The JSON object in a model reply, tolerating fences and text around it. */
function parseJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

// ─── Plan ───

export interface CompactionGroup {
  paths: string[];
  reason: string;
}

const APPENDED_SECTION = /^## Added \d{4}-\d{2}-\d{2}[ \t]*$/m;

/**
 * Turn the planning step's reply into groups Grove can run: known files only,
 * each file in one group, each group under MAX_GROUP_BYTES. Files with
 * sections auto-save appended are tidied even when the plan leaves them out.
 * Descriptions are kept only for files that have none.
 */
export function resolvePlan(
  plan: z.infer<typeof CompactionPlanSchema>,
  entries: MemoryEntry[],
  contents: Record<string, string>,
): { groups: CompactionGroup[]; descriptions: Array<{ path: string; description: string }> } {
  const sizeOf = (p: string) => Buffer.byteLength(contents[p], 'utf-8');
  const used = new Set<string>();
  const groups: CompactionGroup[] = [];

  for (const g of plan.groups) {
    const paths: string[] = [];
    let bytes = 0;
    for (const p of g.paths) {
      if (!(p in contents) || used.has(p) || paths.includes(p)) continue;
      if (bytes + sizeOf(p) > MAX_GROUP_BYTES) continue;
      paths.push(p);
      bytes += sizeOf(p);
    }
    if (paths.length === 0) continue;
    for (const p of paths) used.add(p);
    groups.push({ paths, reason: g.reason });
  }

  for (const e of entries) {
    const p = e.relativePath;
    if (used.has(p) || !APPENDED_SECTION.test(contents[p]) || sizeOf(p) > MAX_GROUP_BYTES) continue;
    used.add(p);
    groups.push({ paths: [p], reason: 'fold in sections added by auto-save' });
  }

  const lacking = new Set(entries.filter(e => !e.description).map(e => e.relativePath));
  const descriptions: Array<{ path: string; description: string }> = [];
  for (const d of plan.descriptions) {
    const description = d.description.replace(/\s+/g, ' ').trim();
    if (!description || !lacking.has(d.path)) continue;
    lacking.delete(d.path);
    descriptions.push({ path: d.path, description });
    if (descriptions.length >= MAX_DESCRIPTIONS_PER_RUN) break;
  }

  return { groups, descriptions };
}

// ─── Result validation & application ───

/**
 * Sanity checks against a destructive or hallucinated compaction result.
 * `original` is what the model was shown; `elsewhere` holds the other files
 * in memory, which the model never saw and so must not overwrite.
 * Returns an error string, or null when the result is safe to apply.
 */
export function validateCompactionResult(
  result: CompactionResult,
  original: Record<string, string>,
  elsewhere: ReadonlySet<string> = new Set(),
): string | null {
  if (result.files.length === 0) return 'empty result';

  const originalPaths = new Set(Object.keys(original));
  let survivingBytes = 0;
  let touchesExisting = false;

  for (const file of result.files) {
    if (!isAllowedCompactionPath(file.path)) {
      return `disallowed path: ${file.path}`;
    }
    if ((file.action === 'delete' || file.action === 'keep') && !originalPaths.has(file.path)) {
      return `${file.action} of unknown file: ${file.path}`;
    }
    if (file.action === 'update' && !file.content.trim()) {
      return `update with empty content: ${file.path}`;
    }
    if (file.action === 'update' && !originalPaths.has(file.path) && elsewhere.has(file.path)) {
      return `update of a file it was not shown: ${file.path}`;
    }
    if (file.action === 'update' && Buffer.byteLength(file.content, 'utf-8') > MAX_COMPACTED_FILE_BYTES) {
      return `file too large: ${file.path}`;
    }
    if (originalPaths.has(file.path)) touchesExisting = true;

    if (file.action === 'update') survivingBytes += Buffer.byteLength(file.content, 'utf-8');
    if (file.action === 'keep') survivingBytes += Buffer.byteLength(original[file.path] ?? '', 'utf-8');
  }

  // Untouched original files survive as-is
  const mentioned = new Set(result.files.map(f => f.path));
  for (const [p, c] of Object.entries(original)) {
    if (!mentioned.has(p)) survivingBytes += Buffer.byteLength(c, 'utf-8');
  }

  if (!touchesExisting) return 'result does not reference any existing file';

  // Compaction should shrink memory, but a result that nukes almost everything is
  // more likely a bad generation than a good clean-up.
  const originalBytes = totalBytes(original);
  if (originalBytes > 2048 && survivingBytes < originalBytes * 0.1) {
    return `result too destructive (${survivingBytes} of ${originalBytes} bytes would survive)`;
  }

  return null;
}

function applyCompaction(repoPath: string, result: CompactionResult): string[] {
  const changed: string[] = [];

  for (const file of result.files) {
    if (file.action === 'keep') continue;
    try {
      if (file.action === 'delete') {
        if (memory.deleteMemoryFile(repoPath, file.path)) changed.push(file.path);
      } else {
        memory.writeMemoryFile(repoPath, file.path, file.content);
        changed.push(file.path);
      }
      logger.info(`[memory-compact] ${file.action}: ${file.path} — ${file.reason}`);
    } catch (err) {
      logger.warn(`[memory-compact] Failed to ${file.action} ${file.path}: ${err}`);
    }
  }

  return changed;
}

// ─── Progress events & cancellation ───

export type CompactionStage = 'pruning' | 'planning' | 'merging';

export type CompactionEvent =
  | { kind: 'stage'; repoPath: string; stage: CompactionStage; step?: number; total?: number }
  | { kind: 'done'; repoPath: string; status: CompactionStatus };

const eventListeners = new Set<(event: CompactionEvent) => void>();

/** Subscribe to compaction progress (stage transitions and completion). Returns an unsubscribe. */
export function onCompactionEvent(listener: (event: CompactionEvent) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

function emitEvent(event: CompactionEvent): void {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch (err) {
      logger.warn(`[memory-compact] Compaction event listener failed: ${err}`);
    }
  }
}

/** Abort controllers for running passes, keyed by repo path — the Cancel button's handle. */
const activeControllers = new Map<string, AbortController>();

/** Cancel the compaction pass running for a repo. Returns false when none is running. */
export function cancelCompaction(repoPath: string): boolean {
  const controller = activeControllers.get(repoPath);
  if (!controller) return false;
  controller.abort();
  return true;
}

// ─── Model calls ───

type CallOutcome = { text: string } | { timedOut: true } | { cancelled: true };

/** One model call with its own timeout, which the run's Cancel also aborts. */
async function callModel(
  adapter: AgentAdapter,
  systemPrompt: string,
  userMessage: string,
  cwd: string,
  run: AbortController,
): Promise<CallOutcome> {
  if (run.signal.aborted) return { cancelled: true };
  const call = new AbortController();
  const onCancel = () => call.abort();
  run.signal.addEventListener('abort', onCancel);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    call.abort();
  }, compactTimeoutSeconds() * 1000);

  try {
    // runCompaction checks generateText before any call
    const text = await adapter.generateText!(systemPrompt, userMessage, {
      cwd,
      abortSignal: call.signal,
      model: backgroundModelFor(adapter),
    });
    if (run.signal.aborted) return { cancelled: true };
    return { text };
  } catch (err) {
    if (timedOut) return { timedOut: true };
    if (run.signal.aborted) return { cancelled: true };
    throw err;
  } finally {
    clearTimeout(timeout);
    run.signal.removeEventListener('abort', onCancel);
  }
}

// ─── Public API ───

/**
 * Compact one project's memory: archive expired thread notes, plan from every
 * file's index line and opening text, add missing descriptions, then merge up
 * to MAX_GROUPS_PER_RUN groups of overlapping files, one model call each.
 * Runs only when asked (the Memory panel's Compact button).
 */
export async function compactMemory(opts: CompactOptions): Promise<CompactionStatus> {
  const { repoPath } = opts;

  if (inProgress.has(repoPath)) {
    return { compacted: false, skippedReason: 'already in progress', filesChanged: [] };
  }
  inProgress.add(repoPath);

  const abortController = new AbortController();
  activeControllers.set(repoPath, abortController);

  const emitStage = (stage: CompactionStage, step?: number, total?: number) => {
    emitEvent({ kind: 'stage', repoPath, stage, ...(step !== undefined ? { step, total } : {}) });
  };

  let status: CompactionStatus;
  try {
    status = await runCompaction(opts, abortController, emitStage);
  } catch (err) {
    logger.error(`[memory-compact] Compaction failed for ${repoPath}: ${err}`);
    status = { compacted: false, error: String(err), filesChanged: [] };
  } finally {
    inProgress.delete(repoPath);
    activeControllers.delete(repoPath);
  }

  emitEvent({ kind: 'done', repoPath, status });
  return status;
}

async function runCompaction(
  opts: CompactOptions,
  run: AbortController,
  emitStage: (stage: CompactionStage, step?: number, total?: number) => void,
): Promise<CompactionStatus> {
  const { repoPath, adapterType } = opts;
  const cwd = opts.cwd ?? repoPath;

  emitStage('pruning');
  const filesChanged = expireSessionNotes(repoPath);

  const adapter = backgroundAgentFor(adapterType);
  if (!adapter) {
    logger.info(`[memory-compact] The Claude account "${adapterType}" was removed, so LLM compaction is skipped`);
    return { compacted: false, skippedReason: 'account removed', filesChanged };
  }

  if (!adapter.generateText) {
    logger.info(`[memory-compact] Adapter "${adapter.id}" does not support generateText — skipping LLM compaction`);
    return { compacted: false, skippedReason: 'adapter cannot generate text', filesChanged };
  }

  const entries = memory.listMemoryFiles(repoPath)
    .filter(e => isAllowedCompactionPath(e.relativePath))
    .sort(memory.byIndexOrder);
  const contents: Record<string, string> = {};
  for (const e of entries) {
    const content = memory.readMemoryFile(repoPath, e.relativePath);
    if (content) contents[e.relativePath] = content;
  }
  const planned = entries.filter(e => e.relativePath in contents);
  if (planned.length === 0) {
    return { compacted: false, skippedReason: 'no memory files', filesChanged };
  }

  const timeoutSeconds = compactTimeoutSeconds();
  logger.info(`[memory-compact] Planning compaction for ${repoPath} (${planned.length} files, ${totalBytes(contents)} bytes)`);

  emitStage('planning');
  const planReply = await callModel(adapter, buildPlanPrompt(planned, contents), 'Plan the clean-up. Respond with JSON only.', cwd, run);
  if ('cancelled' in planReply) return { compacted: false, skippedReason: 'cancelled', filesChanged };
  if ('timedOut' in planReply) {
    logger.warn(`[memory-compact] Planning timed out after ${timeoutSeconds}s for ${repoPath}`);
    return { compacted: false, error: `planning timed out after ${timeoutSeconds}s`, filesChanged };
  }

  let plan: z.infer<typeof CompactionPlanSchema>;
  try {
    plan = CompactionPlanSchema.parse(parseJson(planReply.text));
  } catch (err) {
    logger.warn(`[memory-compact] Could not parse compaction plan: ${err}`);
    return { compacted: false, skippedReason: 'unparseable plan', filesChanged };
  }
  const { groups, descriptions } = resolvePlan(plan, planned, contents);
  if (groups.length === 0 && descriptions.length === 0) {
    return { compacted: false, skippedReason: 'nothing to merge or describe', filesChanged };
  }

  // One snapshot before the first write, so Undo reverts the whole run.
  let backupId: string | undefined;
  let backedUp = false;
  const backUp = () => {
    if (backedUp) return;
    backedUp = true;
    backupId = backupMemory(repoPath, contents) ?? undefined;
  };

  const changed = new Set<string>();
  const changes: CompactionChange[] = [];

  let descriptionsAdded = 0;
  const titles = new Map(planned.map(e => [e.relativePath, e.title]));
  for (const { path: p, description } of descriptions) {
    const next = memory.withDescription(contents[p], description, titles.get(p) ?? p);
    if (next === contents[p]) continue;
    backUp();
    try {
      memory.writeMemoryFile(repoPath, p, next);
      contents[p] = next;
      changed.add(p);
      descriptionsAdded++;
    } catch (err) {
      logger.warn(`[memory-compact] Failed to add a description to ${p}: ${err}`);
    }
  }

  const toRun = groups.slice(0, MAX_GROUPS_PER_RUN);
  let finished = 0;
  let rejected = 0;
  let error: string | undefined;
  let cancelled = false;

  for (const [i, group] of toRun.entries()) {
    emitStage('merging', i + 1, toRun.length);
    const shown = Object.fromEntries(group.paths.map(p => [p, contents[p]]));
    const reply = await callModel(adapter, buildMergePrompt(shown, group.reason), 'Compact the memory files above. Respond with JSON only.', cwd, run);
    if ('cancelled' in reply) {
      cancelled = true;
      break;
    }
    if ('timedOut' in reply) {
      logger.warn(`[memory-compact] Merge step ${i + 1} timed out after ${timeoutSeconds}s for ${repoPath}`);
      error = `merge step ${i + 1} timed out after ${timeoutSeconds}s`;
      break;
    }
    finished++;

    let result: CompactionResult;
    try {
      result = CompactionResultSchema.parse(parseJson(reply.text));
    } catch (err) {
      logger.warn(`[memory-compact] Could not parse merge step ${i + 1}: ${err}`);
      rejected++;
      continue;
    }
    const elsewhere = new Set(
      memory.listMemoryFiles(repoPath).map(e => e.relativePath).filter(p => !(p in shown)),
    );
    const invalid = validateCompactionResult(result, shown, elsewhere);
    if (invalid) {
      logger.warn(`[memory-compact] Rejected merge step ${i + 1}: ${invalid}`);
      rejected++;
      continue;
    }

    backUp();
    for (const p of applyCompaction(repoPath, result)) changed.add(p);
    for (const f of result.files) {
      if (f.action === 'keep') continue;
      changes.push({ action: f.action, path: f.path, reason: f.reason });
    }
  }

  const remainingGroups = groups.length - finished;
  if (changed.size > 0) setLastCompactedAt(repoPath, Date.now(), changed.size);
  logger.info(`[memory-compact] Compacted ${repoPath}: ${changed.size} files changed, ${descriptionsAdded} descriptions added, ${finished} of ${groups.length} groups merged, ${rejected} rejected`);

  const status: CompactionStatus = {
    compacted: changed.size > 0,
    filesChanged: [...filesChanged, ...changed],
    changes,
    descriptionsAdded,
    remainingGroups,
    backupId: changed.size > 0 ? backupId : undefined,
  };
  if (error) status.error = error;
  if (cancelled) status.skippedReason = 'cancelled';
  else if (changed.size === 0 && rejected > 0) status.skippedReason = `${rejected} merge ${rejected === 1 ? 'result was' : 'results were'} rejected`;
  return status;
}
