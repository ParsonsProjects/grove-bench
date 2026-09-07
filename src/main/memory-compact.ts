import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logger } from './logger.js';
import * as memory from './memory.js';
import * as settings from './settings.js';
import { adapterRegistry } from './adapters/index.js';

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
}

export interface CompactionInfo {
  lastCompactedAt: string | null;
  /** Whether the last pass was triggered automatically (vs the panel button). */
  lastAuto?: boolean;
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
  /** Skip the threshold + cooldown checks and compact unconditionally. */
  force?: boolean;
  /** Marks this pass as automatically triggered (recorded for the panel's trace line). */
  auto?: boolean;
}

// ─── Constants ───

/** Start compacting when non-session memory exceeds this fraction of the system prompt budget. */
const COMPACT_THRESHOLD_RATIO = 0.75;

/** Or when this many non-session files have accumulated. */
const MAX_FILES_BEFORE_COMPACT = 15;

/** Session notes kept after pruning (newest first). */
const MAX_SESSION_NOTES = 20;

/** Minimum time between LLM compaction passes per repo. */
const COMPACT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Default safety timeout for the LLM compaction call, overridable via the
 *  memoryCompactTimeoutSeconds setting. Rewriting every memory file as JSON
 *  through a spawned CLI process is slow — 90s aborted real passes. */
const DEFAULT_COMPACT_TIMEOUT_SECONDS = 300;

/** Floor for the configurable timeout — below this no pass could ever finish. */
const MIN_COMPACT_TIMEOUT_SECONDS = 30;

/** The configured compaction timeout in seconds, clamped to the minimum. */
function compactTimeoutSeconds(): number {
  const configured = settings.getSettings().memoryCompactTimeoutSeconds;
  const seconds = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_COMPACT_TIMEOUT_SECONDS;
  return Math.max(MIN_COMPACT_TIMEOUT_SECONDS, seconds);
}

/** Defensive hard cap applied to any single compacted file. */
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

/** Last LLM compaction time per repo (also persisted to _compact.json). */
const lastCompacted = new Map<string, number>();

// ─── Cooldown persistence ───

function compactStatePath(repoPath: string): string {
  return path.join(memory.getMemoryDir(repoPath), '_compact.json');
}

function getLastCompactedAt(repoPath: string): number {
  const cached = lastCompacted.get(repoPath);
  if (cached !== undefined) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(compactStatePath(repoPath), 'utf-8'));
    const ts = Date.parse(raw.lastCompactedAt);
    if (!Number.isNaN(ts)) {
      lastCompacted.set(repoPath, ts);
      return ts;
    }
  } catch {
    // No state yet
  }
  return 0;
}

function setLastCompactedAt(repoPath: string, ts: number, auto: boolean, filesChanged: number): void {
  lastCompacted.set(repoPath, ts);
  try {
    fs.writeFileSync(compactStatePath(repoPath), JSON.stringify({
      lastCompactedAt: new Date(ts).toISOString(),
      lastAuto: auto,
      lastFilesChanged: filesChanged,
    }, null, 2));
  } catch (err) {
    logger.warn(`[memory-compact] Failed to persist compaction state: ${err}`);
  }
}

/** When and how the last compaction pass ran — the panel's trace line. */
export function getCompactionInfo(repoPath: string): CompactionInfo {
  try {
    const raw = JSON.parse(fs.readFileSync(compactStatePath(repoPath), 'utf-8'));
    if (typeof raw.lastCompactedAt === 'string' && !Number.isNaN(Date.parse(raw.lastCompactedAt))) {
      return {
        lastCompactedAt: raw.lastCompactedAt,
        lastAuto: raw.lastAuto === true,
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

// ─── Deterministic layer ───

/**
 * Decide whether the LLM compaction pass is worth running.
 */
export function needsCompaction(repoPath: string): { needed: boolean; totalBytes: number; fileCount: number } {
  const contents = readNonSessionContents(repoPath);
  const bytes = totalBytes(contents);
  const fileCount = Object.keys(contents).length;
  const needed =
    bytes > memory.MAX_SYSTEM_PROMPT_BYTES * COMPACT_THRESHOLD_RATIO ||
    fileCount > MAX_FILES_BEFORE_COMPACT;
  return { needed, totalBytes: bytes, fileCount };
}

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
export function pruneSessionNotes(repoPath: string, keep: number = MAX_SESSION_NOTES): string[] {
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

// ─── Compaction prompt ───

function buildCompactionPrompt(contents: Record<string, string>): string {
  const memorySection = Object.entries(contents)
    .map(([p, c]) => `### ${p}\n${c}`)
    .join('\n\n');

  return `You are a memory compaction assistant. The project memory files below have grown over many sessions and now contain duplicated, stale, and possibly contradictory information. Your job is to consolidate them into a smaller, coherent set.

## Current Memory Files
${memorySection}

## Instructions
Rewrite the memory files so that:
- Duplicated facts appear exactly once, in the single most appropriate file.
- Contradictions are resolved, never kept side by side. When two statements conflict, keep the one from the file with the newer \`updatedAt\` frontmatter; within one file, keep the later statement. Explicit user corrections (e.g. "the user clarified/corrected...") always win over inferred facts.
- Stale, ephemeral, or session-specific details (old debugging notes, temporary state, completed one-off tasks) are dropped.
- Files covering the same topic are merged; near-empty leftovers are deleted.
- Each file stays concise and factual, under roughly 4 KB.
- Nothing is invented: every retained statement must come from the files above. Prefer dropping a doubtful statement over rephrasing it into something new.
- File organization is preserved: repo/ (overview, tech stack), conventions/ (naming, patterns), architecture/ (data flow, modules). Do not touch other folders.
- Each kept file retains markdown with YAML frontmatter (title, updatedAt). Set updatedAt to the newest timestamp among its merged sources.

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

// ─── Result validation & application ───

/**
 * Sanity checks against a destructive or hallucinated compaction result.
 * Returns an error string, or null when the result is safe to apply.
 */
export function validateCompactionResult(
  result: CompactionResult,
  original: Record<string, string>,
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
        let content = file.content;
        if (Buffer.byteLength(content, 'utf-8') > MAX_COMPACTED_FILE_BYTES) {
          content = content.slice(0, MAX_COMPACTED_FILE_BYTES);
        }
        memory.writeMemoryFile(repoPath, file.path, content);
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

export type CompactionStage = 'pruning' | 'generating' | 'validating' | 'applying';

export type CompactionEvent =
  | { kind: 'stage'; repoPath: string; auto: boolean; stage: CompactionStage }
  | { kind: 'done'; repoPath: string; auto: boolean; status: CompactionStatus };

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

// ─── Public API ───

/**
 * Run a full compaction pass: prune old session notes, then (when over threshold
 * and past the cooldown, or forced) ask the adapter to dedupe, resolve
 * contradictions, and condense the non-session memory files.
 */
export async function compactMemory(opts: CompactOptions): Promise<CompactionStatus> {
  const { repoPath } = opts;
  const auto = opts.auto === true;

  if (inProgress.has(repoPath)) {
    return { compacted: false, skippedReason: 'already in progress', filesChanged: [] };
  }
  inProgress.add(repoPath);

  const abortController = new AbortController();
  activeControllers.set(repoPath, abortController);

  // Auto passes stay silent until real work starts (the LLM stage) — the
  // frequent below-threshold skips must not flash progress UI in the renderer.
  let emittedAny = false;
  const emitStage = (stage: CompactionStage) => {
    if (auto && stage === 'pruning') return;
    emittedAny = true;
    emitEvent({ kind: 'stage', repoPath, auto, stage });
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

  if (!auto || emittedAny) {
    emitEvent({ kind: 'done', repoPath, auto, status });
  }
  return status;
}

async function runCompaction(
  opts: CompactOptions,
  abortController: AbortController,
  emitStage: (stage: CompactionStage) => void,
): Promise<CompactionStatus> {
  const { repoPath, adapterType, force } = opts;

  emitStage('pruning');
  const filesChanged = pruneSessionNotes(repoPath);

  if (!force) {
    const { needed } = needsCompaction(repoPath);
    if (!needed) {
      return { compacted: false, skippedReason: 'below threshold', filesChanged };
    }
    if (Date.now() - getLastCompactedAt(repoPath) < COMPACT_COOLDOWN_MS) {
      return { compacted: false, skippedReason: 'cooldown', filesChanged };
    }
  }

  const adapter = adapterType
    ? (adapterRegistry.get(adapterType) ?? adapterRegistry.getDefault())
    : adapterRegistry.getDefault();

  if (!adapter.generateText) {
    logger.info(`[memory-compact] Adapter "${adapter.id}" does not support generateText — skipping LLM compaction`);
    return { compacted: false, skippedReason: 'adapter cannot generate text', filesChanged };
  }

  const contents = readNonSessionContents(repoPath);
  if (Object.keys(contents).length === 0) {
    return { compacted: false, skippedReason: 'no memory files', filesChanged };
  }

  logger.info(`[memory-compact] Running compaction for ${repoPath} (${Object.keys(contents).length} files, ${totalBytes(contents)} bytes)`);

  emitStage('generating');
  const timeoutSeconds = compactTimeoutSeconds();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutSeconds * 1000);

  let resultText: string;
  try {
    resultText = await adapter.generateText(
      buildCompactionPrompt(contents),
      'Compact the memory files above. Respond with JSON only.',
      {
        cwd: opts.cwd ?? repoPath,
        abortSignal: abortController.signal,
        model: settings.getSettings().memoryModel || undefined,
      },
    );
  } catch (err) {
    if (timedOut) {
      logger.warn(`[memory-compact] Compaction timed out after ${timeoutSeconds}s for ${repoPath}`);
      return { compacted: false, error: `compaction timed out after ${timeoutSeconds}s`, filesChanged };
    }
    if (abortController.signal.aborted) {
      logger.info(`[memory-compact] Compaction cancelled for ${repoPath}`);
      return { compacted: false, skippedReason: 'cancelled', filesChanged };
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  emitStage('validating');
  const cleaned = resultText
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  let result: CompactionResult;
  try {
    result = CompactionResultSchema.parse(JSON.parse(cleaned));
  } catch (err) {
    logger.warn(`[memory-compact] Could not parse compaction result: ${err}`);
    return { compacted: false, skippedReason: 'unparseable result', filesChanged };
  }

  const invalid = validateCompactionResult(result, contents);
  if (invalid) {
    logger.warn(`[memory-compact] Rejected compaction result: ${invalid}`);
    return { compacted: false, skippedReason: invalid, filesChanged };
  }

  emitStage('applying');
  const backupId = backupMemory(repoPath, contents) ?? undefined;
  const compactedFiles = applyCompaction(repoPath, result);
  setLastCompactedAt(repoPath, Date.now(), opts.auto === true, compactedFiles.length);

  const changes: CompactionChange[] = result.files
    .filter((f): f is typeof f & { action: 'update' | 'delete' } => f.action !== 'keep')
    .map(f => ({ action: f.action, path: f.path, reason: f.reason }));

  logger.info(`[memory-compact] Compacted ${repoPath}: ${compactedFiles.length} files changed`);
  return {
    compacted: compactedFiles.length > 0,
    filesChanged: [...filesChanged, ...compactedFiles],
    changes,
    backupId,
  };
}

/**
 * Fire-and-forget compaction hook for the auto-save pipeline. Respects the
 * memoryAutoCompact setting, thresholds, and cooldown; never throws.
 */
export function maybeCompact(opts: Omit<CompactOptions, 'force'>): void {
  const appSettings = settings.getSettings();
  if (appSettings.memoryAutoCompact === false) return;

  compactMemory({ ...opts, auto: true }).catch(err => {
    logger.error(`[memory-compact] Background compaction failed: ${err}`);
  });
}
