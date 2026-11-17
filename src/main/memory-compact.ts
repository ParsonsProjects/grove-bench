import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logger } from './logger.js';
import { perfLine } from './perf-log.js';
import * as memory from './memory.js';
import * as settings from './settings.js';
import { backgroundAgentFor, backgroundModelFor } from './background-tasks.js';
import { effectiveCompactTimeoutSeconds } from '../shared/compact-timeout.js';
import { extractJsonObject } from './extract-json.js';
import { isRecord } from './persisted-state.js';
import type { MemoryCompactionPreview, MemoryCompactionStep, MemoryEntry } from '../shared/types.js';
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
  /** A model for this run only, instead of the agent's background model. */
  model?: string;
}

// ─── Constants ───

/** Most merge groups one run works through; the rest wait for the next run,
 *  so a run takes minutes, not an hour, and Undo covers one run. */
const MAX_GROUPS_PER_RUN = 6;

/** Merge steps that run at once. Their groups never share a file, so they
 *  can't overwrite each other; more at once would mostly add agent processes
 *  and rate-limit risk. */
const MAX_PARALLEL_MERGES = 3;

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

/** Hidden folder where expired and pruned session notes are archived
 *  instead of destroyed. Nothing is ever deleted from it automatically. */
const PRUNED_ARCHIVE_DIR = '_pruned-sessions';

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
    const raw: unknown = JSON.parse(fs.readFileSync(compactStatePath(repoPath), 'utf-8'));
    if (isRecord(raw) && typeof raw.lastCompactedAt === 'string' && !Number.isNaN(Date.parse(raw.lastCompactedAt))) {
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

/** The files compaction may change, in index order, with their contents. */
function readCompactable(repoPath: string): { planned: MemoryEntry[]; contents: Record<string, string> } {
  const entries = memory.listMemoryFiles(repoPath)
    .filter(e => isAllowedCompactionPath(e.relativePath))
    .sort(memory.byIndexOrder);
  const contents: Record<string, string> = {};
  for (const e of entries) {
    const content = memory.readMemoryFile(repoPath, e.relativePath);
    if (content) contents[e.relativePath] = content;
  }
  return { planned: entries.filter(e => e.relativePath in contents), contents };
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
 * When a note was last touched: the later of its frontmatter `updatedAt` and
 * the file's mtime, so a note just rewritten with an old or copied date never
 * looks expired.
 */
function lastTouched(repoPath: string, entry: { relativePath: string; updatedAt: string }): number {
  const parsed = Date.parse(entry.updatedAt);
  let mtime = 0;
  try {
    mtime = fs.statSync(path.join(memory.getMemoryDir(repoPath), entry.relativePath)).mtimeMs;
  } catch {
    // Gone already
  }
  return Math.max(Number.isNaN(parsed) ? 0 : parsed, mtime);
}

/**
 * Move a pruned note into the hidden archive folder (a safety net: automatic
 * pruning must never destroy the only copy). The archive is never trimmed.
 */
function archivePrunedNote(repoPath: string, relativePath: string, content: string): void {
  const archiveDir = path.join(memory.getMemoryDir(repoPath), PRUNED_ARCHIVE_DIR);
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
    // Timestamp plus the note's whole path, so same-named notes in different
    // folders, or re-pruned ones, never overwrite each other.
    const base = `${Date.now()}-${relativePath.replace(/[\\/]/g, '__')}`;
    let name = base;
    for (let n = 2; fs.existsSync(path.join(archiveDir, name)); n++) name = `${base}-${n}`;
    fs.writeFileSync(path.join(archiveDir, name), content);
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
  const sessionEntries = memory.listMemoryFiles(repoPath, 'sessions');

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
  for (const entry of memory.listMemoryFiles(repoPath, 'sessions')) {
    if (lastTouched(repoPath, entry) >= cutoff) continue;
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
    const body = memory.stripFrontmatter(content).replace(/\s+/g, ' ');
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
- Each file stays concise and factual, and under ${MAX_COMPACTED_FILE_BYTES / 1024} KB: a larger file is rejected. Split a big topic across files rather than going over.
- Nothing is invented: every retained statement must come from the files above. Prefer dropping a doubtful statement over rephrasing it into something new.
- Only these files change: update or delete them, or create new files in repo/, conventions/ or architecture/ for merged content. Never write to any other existing file.
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

const PLAN_USER_MESSAGE = 'Plan the clean-up. Respond with JSON only.';
const MERGE_USER_MESSAGE = 'Compact the memory files above. Respond with JSON only.';

/** The JSON object in a model reply, tolerating fences and text around it. */
function parseJson(text: string): unknown {
  const json = extractJsonObject(text);
  if (json === null) throw new Error('no JSON object');
  return JSON.parse(json);
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
 * sections auto-save appended come first, as one-file groups, unless the plan
 * already put them in a group. Descriptions are kept only for files that have
 * none.
 */
export function resolvePlan(
  plan: z.infer<typeof CompactionPlanSchema>,
  entries: MemoryEntry[],
  contents: Record<string, string>,
): { groups: CompactionGroup[]; descriptions: Array<{ path: string; description: string }> } {
  // The plan's paths come from the model: 'constructor' must not count as known.
  const known = (p: string) => Object.hasOwn(contents, p);
  const sizeOf = (p: string) => Buffer.byteLength(contents[p], 'utf-8');
  const used = new Set<string>();
  const groups: CompactionGroup[] = [];

  for (const g of plan.groups) {
    const paths: string[] = [];
    let bytes = 0;
    for (const p of g.paths) {
      if (!known(p) || used.has(p) || paths.includes(p)) continue;
      if (bytes + sizeOf(p) > MAX_GROUP_BYTES) continue;
      paths.push(p);
      bytes += sizeOf(p);
    }
    if (paths.length === 0) continue;
    for (const p of paths) used.add(p);
    groups.push({ paths, reason: g.reason });
  }

  const foldIns: CompactionGroup[] = [];
  for (const e of entries) {
    const p = e.relativePath;
    if (!known(p) || used.has(p) || !APPENDED_SECTION.test(contents[p]) || sizeOf(p) > MAX_GROUP_BYTES) continue;
    used.add(p);
    foldIns.push({ paths: [p], reason: 'fold in sections added by auto-save' });
  }
  groups.unshift(...foldIns);

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
 * in memory, which the model never saw and so must not overwrite. Paths are
 * compared by memoryPathKey, so "./a.md" or "A.md" still means a.md.
 * Returns an error string, or null when the result is safe to apply.
 */
export function validateCompactionResult(
  result: CompactionResult,
  original: Record<string, string>,
  elsewhere: ReadonlySet<string> = new Set(),
): string | null {
  if (result.files.length === 0) return 'empty result';

  const key = memory.memoryPathKey;
  const originalByKey = new Map(Object.entries(original).map(([p, c]) => [key(p), c]));
  const elsewhereKeys = new Set([...elsewhere].map(key));
  let survivingBytes = 0;
  let touchesExisting = false;

  for (const file of result.files) {
    const k = key(file.path);
    if (!isAllowedCompactionPath(file.path)) {
      return `disallowed path: ${file.path}`;
    }
    if ((file.action === 'delete' || file.action === 'keep') && !originalByKey.has(k)) {
      return `${file.action} of unknown file: ${file.path}`;
    }
    if (file.action === 'update' && !file.content.trim()) {
      return `update with empty content: ${file.path}`;
    }
    if (file.action === 'update' && !originalByKey.has(k) && elsewhereKeys.has(k)) {
      return `update of a file it was not shown: ${file.path}`;
    }
    if (file.action === 'update' && Buffer.byteLength(file.content, 'utf-8') > MAX_COMPACTED_FILE_BYTES) {
      return `file too large: ${file.path}`;
    }
    if (originalByKey.has(k)) touchesExisting = true;

    if (file.action === 'update') survivingBytes += Buffer.byteLength(file.content, 'utf-8');
    if (file.action === 'keep') survivingBytes += Buffer.byteLength(originalByKey.get(k) ?? '', 'utf-8');
  }

  // Untouched original files survive as-is
  const mentioned = new Set(result.files.map(f => key(f.path)));
  for (const [k, c] of originalByKey) {
    if (!mentioned.has(k)) survivingBytes += Buffer.byteLength(c, 'utf-8');
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
  | { kind: 'stage'; repoPath: string; stage: CompactionStage; done?: number; total?: number }
  | { kind: 'step'; repoPath: string; step: MemoryCompactionStep }
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

type CallOutcome = { text: string } | { timedOut: true } | { cancelled: true } | { failed: string };

/** What every model call of one run shares. */
interface RunContext {
  repoPath: string;
  cwd: string;
  adapter: AgentAdapter;
  /** The model asked for, or null for the agent's own default. */
  model: string | null;
  run: AbortController;
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** Tell the panel a step's state; once it has ended, also write its timing
 *  to the performance log. */
function reportStep(ctx: RunContext, step: MemoryCompactionStep): void {
  emitEvent({ kind: 'step', repoPath: ctx.repoPath, step: { ...step } });
  if (step.state === 'running') return;
  const name = step.index === 0 ? 'planning' : `merge step ${step.index}`;
  const parts = [
    ...(step.startupMs !== undefined ? [`agent up after ${step.startupMs} ms`] : []),
    `${kb(step.inputBytes)} in`,
    ...(step.outputBytes !== undefined ? [`${kb(step.outputBytes)} out`] : []),
    step.model ?? "the agent's default model",
  ];
  const detail = step.detail ? `: ${step.detail}` : '';
  perfLine('steps', `memory compact ${path.basename(ctx.repoPath)} ${name}: ${step.state} after ${step.durationMs ?? 0} ms (${parts.join(', ')})${detail}`);
}

/** A model call about to start, reported as running. */
function startStep(ctx: RunContext, index: number, label: string, systemPrompt: string, userMessage: string): MemoryCompactionStep {
  const step: MemoryCompactionStep = {
    index,
    label,
    state: 'running',
    model: ctx.model,
    systemPrompt,
    userMessage,
    startedAt: Date.now(),
    inputBytes: Buffer.byteLength(systemPrompt, 'utf-8') + Buffer.byteLength(userMessage, 'utf-8'),
  };
  reportStep(ctx, step);
  return step;
}

function endStep(ctx: RunContext, step: MemoryCompactionStep, state: MemoryCompactionStep['state'], detail?: string): void {
  step.state = state;
  if (detail) step.detail = detail;
  reportStep(ctx, step);
}

/** One model call with its own timeout, which the run's Cancel also aborts.
 *  Fills in the step's timings and reply size. */
async function callModel(ctx: RunContext, step: MemoryCompactionStep): Promise<CallOutcome> {
  if (ctx.run.signal.aborted) return { cancelled: true };
  const call = new AbortController();
  const onCancel = () => call.abort();
  ctx.run.signal.addEventListener('abort', onCancel);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    call.abort();
  }, compactTimeoutSeconds() * 1000);
  const start = performance.now();

  try {
    // runCompaction checks generateText before any call
    const text = await ctx.adapter.generateText!(step.systemPrompt, step.userMessage, {
      cwd: ctx.cwd,
      abortSignal: call.signal,
      ...(ctx.model ? { model: ctx.model } : {}),
      onStarted: () => { step.startupMs ??= Math.round(performance.now() - start); },
    });
    step.outputBytes = Buffer.byteLength(text, 'utf-8');
    if (ctx.run.signal.aborted) return { cancelled: true };
    return { text };
  } catch (err) {
    if (timedOut) return { timedOut: true };
    if (ctx.run.signal.aborted) return { cancelled: true };
    return { failed: err instanceof Error ? err.message : String(err) };
  } finally {
    step.durationMs = Math.round(performance.now() - start);
    clearTimeout(timeout);
    ctx.run.signal.removeEventListener('abort', onCancel);
  }
}

// ─── Public API ───

/**
 * What a run would use, for the dialog shown before it starts: the agent,
 * the model and the planning prompt as it would be sent now. The merge
 * prompts are built from the plan's reply, so they show while the run goes.
 */
export function previewCompaction(opts: { repoPath: string; adapterType?: string }): MemoryCompactionPreview {
  const adapter = backgroundAgentFor(opts.adapterType);
  const { planned, contents } = readCompactable(opts.repoPath);
  const preview: MemoryCompactionPreview = {
    agentId: adapter?.id ?? opts.adapterType ?? '',
    agentName: adapter?.displayName ?? opts.adapterType ?? '',
    model: adapter ? (backgroundModelFor(adapter) ?? null) : null,
    fileCount: planned.length,
    totalBytes: totalBytes(contents),
    maxGroups: MAX_GROUPS_PER_RUN,
    parallelMerges: MAX_PARALLEL_MERGES,
    plan: planned.length > 0 ? { systemPrompt: buildPlanPrompt(planned, contents), userMessage: PLAN_USER_MESSAGE } : null,
  };
  if (!adapter) preview.unavailable = `The agent "${opts.adapterType}" isn't available any more.`;
  else if (!adapter.generateText) preview.unavailable = `${adapter.displayName} can't run compaction.`;
  return preview;
}

/**
 * Compact one project's memory: archive expired thread notes, plan from every
 * file's index line and opening text, add missing descriptions, then merge up
 * to MAX_GROUPS_PER_RUN groups of overlapping files, one model call each,
 * MAX_PARALLEL_MERGES at a time. Runs only when asked (the Memory panel's
 * Compact button).
 */
export async function compactMemory(opts: CompactOptions): Promise<CompactionStatus> {
  const { repoPath } = opts;

  if (inProgress.has(repoPath)) {
    return { compacted: false, skippedReason: 'already in progress', filesChanged: [] };
  }
  inProgress.add(repoPath);

  const abortController = new AbortController();
  activeControllers.set(repoPath, abortController);

  const emitStage = (stage: CompactionStage, done?: number, total?: number) => {
    emitEvent({ kind: 'stage', repoPath, stage, ...(done !== undefined ? { done, total } : {}) });
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
  emitStage: (stage: CompactionStage, done?: number, total?: number) => void,
): Promise<CompactionStatus> {
  const { repoPath, adapterType } = opts;
  const cwd = opts.cwd ?? repoPath;
  const runStart = performance.now();

  emitStage('pruning');
  const filesChanged = expireSessionNotes(repoPath);

  const adapter = backgroundAgentFor(adapterType);
  if (!adapter) {
    logger.info(`[memory-compact] The agent "${adapterType}" is gone, so LLM compaction is skipped`);
    return { compacted: false, skippedReason: 'agent gone', filesChanged };
  }

  if (!adapter.generateText) {
    logger.info(`[memory-compact] Adapter "${adapter.id}" does not support generateText — skipping LLM compaction`);
    return { compacted: false, skippedReason: 'adapter cannot generate text', filesChanged };
  }

  const { planned, contents } = readCompactable(repoPath);
  if (planned.length === 0) {
    return { compacted: false, skippedReason: 'no memory files', filesChanged };
  }

  const ctx: RunContext = { repoPath, cwd, adapter, model: opts.model || backgroundModelFor(adapter) || null, run };
  const timeoutSeconds = compactTimeoutSeconds();
  logger.info(`[memory-compact] Planning compaction for ${repoPath} (${planned.length} files, ${totalBytes(contents)} bytes, model ${ctx.model ?? "the agent's default"})`);

  emitStage('planning');
  const planStep = startStep(ctx, 0, 'Planning', buildPlanPrompt(planned, contents), PLAN_USER_MESSAGE);
  const planReply = await callModel(ctx, planStep);
  if ('cancelled' in planReply) {
    endStep(ctx, planStep, 'cancelled');
    return { compacted: false, skippedReason: 'cancelled', filesChanged };
  }
  if ('timedOut' in planReply) {
    logger.warn(`[memory-compact] Planning timed out after ${timeoutSeconds}s for ${repoPath}`);
    endStep(ctx, planStep, 'timed out', `no reply within ${timeoutSeconds}s`);
    return { compacted: false, error: `planning timed out after ${timeoutSeconds}s`, filesChanged };
  }
  if ('failed' in planReply) {
    logger.error(`[memory-compact] Planning failed for ${repoPath}: ${planReply.failed}`);
    endStep(ctx, planStep, 'failed', planReply.failed);
    return { compacted: false, error: planReply.failed, filesChanged };
  }

  let plan: z.infer<typeof CompactionPlanSchema>;
  try {
    plan = CompactionPlanSchema.parse(parseJson(planReply.text));
  } catch (err) {
    logger.warn(`[memory-compact] Could not parse compaction plan: ${err}`);
    endStep(ctx, planStep, 'rejected', 'the reply was not a plan Grove could read');
    return { compacted: false, skippedReason: 'unparseable plan', filesChanged };
  }
  const { groups, descriptions } = resolvePlan(plan, planned, contents);
  endStep(ctx, planStep, 'done', `${groups.length} ${groups.length === 1 ? 'group' : 'groups'} to merge, ${descriptions.length} ${descriptions.length === 1 ? 'description' : 'descriptions'} to add`);
  if (groups.length === 0 && descriptions.length === 0) {
    return { compacted: false, skippedReason: 'nothing to merge or describe', filesChanged };
  }

  // The model calls take minutes, and other threads' auto-saves keep writing
  // meanwhile, so every write starts from the file as it is on disk now, and
  // the snapshot Undo restores is taken just before the first write.
  const read = (p: string) => memory.readMemoryFile(repoPath, p);
  let backupId: string | undefined;
  let backedUp = false;
  const backUp = () => {
    if (backedUp) return;
    backedUp = true;
    const current: Record<string, string> = {};
    for (const e of memory.listMemoryFiles(repoPath)) {
      if (!isAllowedCompactionPath(e.relativePath)) continue;
      const content = read(e.relativePath);
      if (content) current[e.relativePath] = content;
    }
    backupId = backupMemory(repoPath, current) ?? undefined;
  };

  const changed = new Set<string>();
  const changes: CompactionChange[] = [];

  let descriptionsAdded = 0;
  const titles = new Map(planned.map(e => [e.relativePath, e.title]));
  for (const { path: p, description } of descriptions) {
    const current = read(p);
    if (current === null) continue;
    const next = memory.withDescription(current, description, titles.get(p) ?? p);
    if (next === current) continue;
    backUp();
    try {
      memory.writeMemoryFile(repoPath, p, next);
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
  /** Set when a step fails or times out: steps already running finish, but
   *  no new one starts, as the next would most likely fail the same way. */
  let stopped = false;

  // Groups never share a file, so their steps run side by side. Each one's
  // reply is checked and written in one go, against memory as it is then:
  // a file another step just created counts as one this step wasn't shown.
  async function mergeStep(i: number, group: CompactionGroup): Promise<void> {
    const shown: Record<string, string> = {};
    for (const p of group.paths) {
      const content = read(p);
      if (content !== null) shown[p] = content;
    }
    if (Object.keys(shown).length === 0) {
      finished++;
      return;
    }
    const step = startStep(ctx, i + 1, `Merge ${i + 1}: ${Object.keys(shown).join(', ')}`, buildMergePrompt(shown, group.reason), MERGE_USER_MESSAGE);
    const reply = await callModel(ctx, step);
    if ('cancelled' in reply) {
      cancelled = true;
      endStep(ctx, step, 'cancelled');
      return;
    }
    if ('timedOut' in reply) {
      logger.warn(`[memory-compact] Merge step ${i + 1} timed out after ${timeoutSeconds}s for ${repoPath}`);
      error ??= `merge step ${i + 1} timed out after ${timeoutSeconds}s`;
      stopped = true;
      endStep(ctx, step, 'timed out', `no reply within ${timeoutSeconds}s`);
      return;
    }
    if ('failed' in reply) {
      logger.error(`[memory-compact] Merge step ${i + 1} failed for ${repoPath}: ${reply.failed}`);
      error ??= `merge step ${i + 1} failed: ${reply.failed}`;
      stopped = true;
      endStep(ctx, step, 'failed', reply.failed);
      return;
    }
    finished++;

    let result: CompactionResult;
    try {
      result = CompactionResultSchema.parse(parseJson(reply.text));
    } catch (err) {
      logger.warn(`[memory-compact] Could not parse merge step ${i + 1}: ${err}`);
      rejected++;
      endStep(ctx, step, 'rejected', 'the reply was not JSON Grove could read');
      return;
    }
    const elsewhere = new Set(
      memory.listMemoryFiles(repoPath).map(e => e.relativePath).filter(p => !(p in shown)),
    );
    // A file changed while the model worked: its merge would undo that change.
    const moved = Object.keys(shown).find(p => read(p) !== shown[p]);
    const invalid = moved ? `${moved} changed during the step` : validateCompactionResult(result, shown, elsewhere);
    if (invalid) {
      logger.warn(`[memory-compact] Rejected merge step ${i + 1}: ${invalid}`);
      rejected++;
      endStep(ctx, step, 'rejected', invalid);
      return;
    }

    backUp();
    const written = applyCompaction(repoPath, result);
    for (const p of written) changed.add(p);
    for (const f of result.files) {
      if (f.action === 'keep') continue;
      changes.push({ action: f.action, path: f.path, reason: f.reason });
    }
    endStep(ctx, step, 'done', `${written.length} ${written.length === 1 ? 'file' : 'files'} changed`);
  }

  let next = 0;
  let ended = 0;
  emitStage('merging', 0, toRun.length);
  async function worker(): Promise<void> {
    while (next < toRun.length && !stopped && !cancelled && !run.signal.aborted) {
      const i = next++;
      try {
        await mergeStep(i, toRun[i]);
      } catch (err) {
        logger.error(`[memory-compact] Merge step ${i + 1} failed for ${repoPath}: ${err}`);
        error ??= `merge step ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`;
        stopped = true;
      }
      emitStage('merging', ++ended, toRun.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_MERGES, toRun.length) }, worker));

  const remainingGroups = groups.length - finished;
  if (changed.size > 0) setLastCompactedAt(repoPath, Date.now(), changed.size);
  const runMs = Math.round(performance.now() - runStart);
  logger.info(`[memory-compact] Compacted ${repoPath} in ${(runMs / 1000).toFixed(1)}s: ${changed.size} files changed, ${descriptionsAdded} descriptions added, ${finished} of ${groups.length} groups merged, ${rejected} rejected`);
  perfLine('steps', `memory compact ${path.basename(repoPath)}: finished after ${runMs} ms (${finished} of ${groups.length} groups merged, up to ${MAX_PARALLEL_MERGES} at once)`);

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
