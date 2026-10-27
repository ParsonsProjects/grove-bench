import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { git, gitEnv, gitExit, gitPatch, dotGitDir, blobLines, detectBinaryDiff, imageExtFor, patchResult, patchOverLimit } from './git.js';
import { parseDiffRaw, parseNumstat as parseNumstatRows } from './git-status-parser.js';
import { logger } from './logger.js';
import type { CheckpointDiffScope, DiffHistoryEntry, DiffHistoryResult, DiffStats, FileDiffResult, FileLinesResult, GitStatusResult } from '../shared/types.js';

const BASELINE_UUID = '__baseline__';

/** The Rewind preview shows a diff up to this many characters. In headless
 *  Chromium, laying out a <pre> of 250 KB took about 0.1 s; of 1 MB, 0.5 s;
 *  of 4 MB, 3 s. */
const PREVIEW_MAX_CHARS = 250_000;
/** Past that, it lists up to this many of the files the rewind changes:
 *  about 80 characters each, at git's --stat width. */
const PREVIEW_MAX_FILES = 1000;

/** Sentinel checkpoint captured when the conversation is cleared. It marks
 *  the boundary between conversations so earlier turns can be listed as
 *  "before /clear" (files restorable, conversation not rewindable), and it
 *  snapshots the working tree at that moment so the last pre-clear turn's
 *  diff has a fixed end point. */
const CLEAR_UUID = '__clear__';

/** Internal checkpoints that never show in the list. */
const SENTINEL_UUIDS: ReadonlySet<string> = new Set([BASELINE_UUID, CLEAR_UUID]);

/** Identity for checkpoint commits. They live only under refs/grove and are
 *  never part of the user's branch history, so a fixed identity is fine and
 *  spares the capture from failing where git has no user.name/email. */
const CHECKPOINT_IDENTITY_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'Grove Bench',
  GIT_AUTHOR_EMAIL: 'checkpoints@grove-bench.local',
  GIT_COMMITTER_NAME: 'Grove Bench',
  GIT_COMMITTER_EMAIL: 'checkpoints@grove-bench.local',
};

/** Sum a `git diff --numstat` output into aggregate stats. Binary files count
 *  toward filesChanged but contribute no line counts (numstat prints `-`). */
function parseNumstat(output: string): DiffStats {
  const stats: DiffStats = { filesChanged: 0, additions: 0, deletions: 0 };
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    stats.filesChanged++;
    const adds = parseInt(parts[0], 10);
    const dels = parseInt(parts[1], 10);
    if (!Number.isNaN(adds)) stats.additions += adds;
    if (!Number.isNaN(dels)) stats.deletions += dels;
  }
  return stats;
}

/** The latest copy of the files a restore replaced; the copies before it are
 *  its ancestors. Under the thread's checkpoint refs, so cleanup() deletes
 *  it with them; pruneAfter only touches turn/N refs. */
function keptRef(sessionId: string): string {
  return `refs/grove/checkpoints/${sessionId}/kept`;
}

/** The files a thread's snapshots use (see snapshotTree). */
interface SnapshotPaths {
  /** The thread's snapshot index, kept between snapshots. */
  index: string;
  /** The worktree's own index: `.git/index` in a main checkout, or the
   *  `index` in the gitdir a linked worktree's `.git` file points to. */
  realIndex: string;
  /** The exclude rules `git add` follows besides .gitignore files: in the
   *  main repository's git dir, which a linked worktree's `commondir` names. */
  exclude: string;
}

/** Null when the worktree's git dir can't be found. */
async function snapshotPaths(cwd: string, sessionId: string): Promise<SnapshotPaths | null> {
  let gitDir: string | null;
  try {
    gitDir = await dotGitDir(cwd);
  } catch {
    return null;
  }
  if (!gitDir) return null;
  const dir = gitDir;
  const common = await fs.promises.readFile(path.join(dir, 'commondir'), 'utf8')
    .then((rel) => path.resolve(dir, rel.trim()), () => dir);
  return {
    index: path.join(dir, `grove-snapshot-${sessionId}.index`),
    realIndex: path.join(dir, 'index'),
    exclude: path.join(common, 'info', 'exclude'),
  };
}

/** A file's size and modified time, to tell whether it changed: 'none' when
 *  it isn't there. */
async function fileStamp(file: string): Promise<string> {
  const stat = await fs.promises.stat(file).catch(() => null);
  return stat ? `${stat.size}:${stat.mtimeMs}` : 'none';
}

/** A line of `git add --verbose` (untranslated) adding or removing a
 *  .gitignore. */
const IGNORE_FILE_CHANGED = /(^|[/'])\.gitignore'\r?$/m;

/** Delete `refs` in one git call, or one call each when that fails (a
 *  batch fails whole, on a ref deleted meanwhile, say). */
async function deleteRefs(cwd: string, refs: string[]): Promise<void> {
  if (refs.length === 0) return;
  try {
    await git(['update-ref', '--stdin'], cwd, { input: refs.map((ref) => `delete ${ref}\n`).join('') });
  } catch {
    for (const ref of refs) await git(['update-ref', '-d', ref], cwd).catch(() => {});
  }
}

/** Delete a file a snapshot made (a temp index, the snapshot index or its
 *  lock), if it's there. Off the main process: creating and deleting files,
 *  which an antivirus watches, can take hundreds of ms, and checkpoints are
 *  taken every turn. */
async function removeTemp(file: string): Promise<void> {
  try { await fs.promises.rm(file, { force: true }); } catch { /* ignore */ }
}

interface CheckpointRef {
  ref: string;
  turn: number;
  uuid: string;
  text?: string;
  /** Commit object id. Used to key the numstat cache by content rather than
   *  by ref name, since turn numbers are reused after a rewind. */
  oid?: string;
}

/** Bound on cached numstat results per session — one entry per (from, to)
 *  pair, so this is only reached after hundreds of turns. */
const NUMSTAT_CACHE_MAX = 500;

interface SessionCheckpoints {
  turnCount: number;
  uuidToRef: Map<string, string>;
  captureQueue: Promise<void>;
  /** `git diff --numstat` results keyed by `${fromOid}..${toOid}`. Both sides
   *  are content-addressed (checkpoint commits, working-tree tree objects), so
   *  an entry never goes stale; history() would otherwise re-run one git
   *  process per checkpoint on every refresh. */
  numstatCache: Map<string, DiffStats>;
  /** The files its snapshots use, once found. */
  snapshotPaths?: SnapshotPaths;
  /** The worktree's index and exclude rules (fileStamp) when the snapshot
   *  index was last started afresh from them; null when it must be again. */
  snapshotSeed: string | null;
  /** Snapshots run one at a time: they share the snapshot index. */
  snapshotQueue: Promise<unknown>;
}

export interface CheckpointInfo {
  uuid: string;
  turn: number;
  ref: string;
  text?: string;
  /** Captured before the most recent /clear (see CheckpointListItem). */
  beforeClear?: boolean;
}

export class CheckpointManager {
  private sessions = new Map<string, SessionCheckpoints>();

  private getOrCreate(sessionId: string): SessionCheckpoints {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = {
        turnCount: 0, uuidToRef: new Map(), captureQueue: Promise.resolve(), numstatCache: new Map(),
        snapshotSeed: null, snapshotQueue: Promise.resolve(),
      };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /**
   * Capture a checkpoint of the current working tree state.
   * Uses the thread's own snapshot index (see snapshotTree) so we don't
   * interfere with the user's real index.
   * Never throws: resolves true when the checkpoint ref was written, false
   * when the capture failed (the failure is logged) or was skipped.
   * @param text Optional user message text to store in the checkpoint for display.
   */
  async capture(sessionId: string, cwd: string, uuid: string, text?: string): Promise<boolean> {
    const s = this.getOrCreate(sessionId);
    // Queue captures to prevent concurrent git index corruption
    const result = s.captureQueue.then(() =>
      this._doCapture(s, sessionId, cwd, uuid, text)
    ).then((written) => written, (err: unknown) => {
      logger.warn(`[checkpoints] capture failed session=${sessionId} uuid=${uuid}:`, err);
      return false;
    });
    s.captureQueue = result.then(() => undefined);
    return result;
  }

  /**
   * Capture the session's starting point (a sentinel that never shows in the
   * list, but anchors the cumulative "all turns" diff). Existing refs are
   * scanned first, in the same queue slot, so a session that already has
   * checkpoints (a query restart after a rewind, or an app-restart resume
   * whose provider id was dropped) keeps its original baseline as the oldest
   * ref instead of getting a second one in the middle of its history.
   */
  async captureBaseline(sessionId: string, cwd: string): Promise<boolean> {
    const s = this.getOrCreate(sessionId);
    const result = s.captureQueue.then(async () => {
      await this._doResume(s, sessionId, cwd);
      return this._doCapture(s, sessionId, cwd, BASELINE_UUID);
    }).then((written) => written, (err: unknown) => {
      logger.warn(`[checkpoints] baseline capture failed session=${sessionId}:`, err);
      return false;
    });
    s.captureQueue = result.then(() => undefined);
    return result;
  }

  /**
   * Record a conversation clear. Checkpoint refs are kept — the user can
   * still restore files to any earlier turn — and a sentinel checkpoint is
   * captured so list() can tell pre-clear turns apart from the new
   * conversation's. Turn numbering continues across the boundary.
   */
  async markCleared(sessionId: string, cwd: string): Promise<void> {
    await this.capture(sessionId, cwd, CLEAR_UUID);
  }

  /**
   * Wait for any pending capture to complete.
   */
  async waitForPending(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) await s.captureQueue;
  }

  private async _doCapture(
    s: SessionCheckpoints, sessionId: string, cwd: string, uuid: string, text?: string
  ): Promise<boolean> {
    // The baseline must stay the oldest ref: once any turn exists (including
    // after a rewind reset the counter to a kept turn) a second baseline would
    // land in the middle of the history and swallow the previous turn's diff.
    if (uuid === BASELINE_UUID && s.turnCount > 0) {
      logger.debug(`[checkpoints] baseline skipped session=${sessionId} (already at turn ${s.turnCount})`);
      return false;
    }

    const turn = ++s.turnCount;
    const ref = `refs/grove/checkpoints/${sessionId}/turn/${turn}`;
    const treeOid = await this.snapshotTree(sessionId, cwd);

    // Encode message text into commit message so list() can display it
    // without depending on in-memory messages. Truncate to keep refs light.
    // Given on standard input rather than with -m, because Windows mangles
    // newlines in command-line arguments, which breaks the body (%(body)
    // returns empty), and rather than in a temp file (-F), which an
    // antivirus scans as it is made and deleted, every turn.
    const safeText = text ? text.replace(/[\r\n]+/g, ' ').slice(0, 200) : '';
    const commitMsg = `grove checkpoint turn=${turn} uuid=${uuid}${safeText ? `\n\ntext=${safeText}` : ''}`;
    // commit-tree refuses to run without an author identity. Checkpoint
    // commits are internal (never on a branch), so a fixed identity keeps
    // captures working on machines where user.name/email are not set.
    const commitOid = (await gitEnv(['commit-tree', treeOid], cwd, CHECKPOINT_IDENTITY_ENV, commitMsg)).trim();

    // Store the ref
    await git(['update-ref', ref, commitOid], cwd);

    s.uuidToRef.set(uuid, ref);
    logger.debug(`[checkpoints] captured session=${sessionId} turn=${turn} uuid=${uuid}`);
    return true;
  }

  /**
   * Write the working tree (tracked and untracked files, not ignored ones) as
   * a tree object and return its oid.
   *
   * Staged through the thread's snapshot index, kept between snapshots
   * beside the worktree's own index. Its file stat data lets `git add -A`
   * re-hash only what changed since the last snapshot. Each snapshot used to
   * stage through a temp copy of the worktree's index, which only knows the
   * files as they were at the last commit or `git add`: every file changed
   * since, and every untracked file, was hashed again each turn, a growing
   * number while the agent worked without committing. Starting from
   * `read-tree HEAD` (no stat data) hashes every file, about 10x slower on a
   * 20k-file repo.
   *
   * The snapshot index starts afresh from the worktree's index on the
   * thread's first snapshot this run, and again when that index or the
   * exclude rules changed (a commit, a checkout, an exclude Grove added), or
   * a .gitignore did (a file it took in while untracked may be ignored now).
   * So it always holds what a fresh copy would. Falls back to a temp index
   * from HEAD, then to an empty one on a branch with no commits yet.
   *
   * A copied index keeps skip-worktree and assume-unchanged bits: sparse
   * checkouts snapshot correctly, but a file the user marked
   * assume-unchanged is recorded as it is in the index.
   */
  private snapshotTree(sessionId: string, cwd: string): Promise<string> {
    const s = this.getOrCreate(sessionId);
    const result = s.snapshotQueue.then(() => this.snapshotNow(s, sessionId, cwd));
    s.snapshotQueue = result.catch(() => undefined);
    return result;
  }

  private async snapshotNow(s: SessionCheckpoints, sessionId: string, cwd: string): Promise<string> {
    s.snapshotPaths ??= (await snapshotPaths(cwd, sessionId)) ?? undefined;
    const paths = s.snapshotPaths;
    if (paths) {
      const env = { GIT_INDEX_FILE: paths.index };
      try {
        const seed = `${await fileStamp(paths.realIndex)}|${await fileStamp(paths.exclude)}`;
        const fresh = s.snapshotSeed !== seed;
        if (fresh) await this.seedSnapshotIndex(s, sessionId, cwd, paths, seed);
        // LC_ALL=C: git's own words for the paths it lists, in any language.
        const added = await gitEnv(['add', '-A', '--verbose'], cwd, { ...env, LC_ALL: 'C' });
        if (!fresh && IGNORE_FILE_CHANGED.test(added)) {
          await this.seedSnapshotIndex(s, sessionId, cwd, paths, seed);
          await gitEnv(['add', '-A'], cwd, env);
        }
        return (await gitEnv(['write-tree'], cwd, env)).trim();
      } catch (err) {
        s.snapshotSeed = null;
        logger.debug(`[checkpoints] snapshot from the thread's index failed session=${sessionId}, reading HEAD instead:`, err);
      }
    }
    const tmpIndex = path.join(os.tmpdir(), `grove-idx-${sessionId}-${Date.now()}`);
    try {
      await this.readHead(sessionId, cwd, tmpIndex);
      const env = { GIT_INDEX_FILE: tmpIndex };
      await gitEnv(['add', '-A'], cwd, env);
      return (await gitEnv(['write-tree'], cwd, env)).trim();
    } finally {
      await removeTemp(tmpIndex);
    }
  }

  /** Start the snapshot index afresh: a copy of the worktree's index, or
   *  HEAD when there is none. A lock left by a snapshot the app quit during
   *  goes first: snapshots run one at a time, so no git is using it. */
  private async seedSnapshotIndex(
    s: SessionCheckpoints, sessionId: string, cwd: string, paths: SnapshotPaths, seed: string,
  ): Promise<void> {
    s.snapshotSeed = null;
    await removeTemp(`${paths.index}.lock`);
    try {
      const { mtimeMs } = await fs.promises.stat(paths.realIndex);
      await fs.promises.copyFile(paths.realIndex, paths.index);
      // The copy keeps the index's time, a second early so rounding can only
      // make git check more files. Git re-reads a file changed in the same
      // second as its index was written ("racily clean") rather than trust
      // its size and time; timed now, as copyFile leaves it on Linux, the
      // copy hid those, and an edit of the same size made in the second of a
      // commit was snapshotted as the committed file.
      const earlier = new Date(mtimeMs - 1000);
      await fs.promises.utimes(paths.index, earlier, earlier);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      await this.readHead(sessionId, cwd, paths.index);
    }
    s.snapshotSeed = seed;
  }

  /** Fill `index` from HEAD, or leave it empty on a branch with no commits yet. */
  private async readHead(sessionId: string, cwd: string, index: string): Promise<void> {
    const env = { GIT_INDEX_FILE: index };
    try {
      await gitEnv(['read-tree', 'HEAD'], cwd, env);
    } catch (err) {
      logger.debug(`[checkpoints] read-tree HEAD failed session=${sessionId}, using empty index:`, err);
      await gitEnv(['read-tree', '--empty'], cwd, env);
    }
  }

  /**
   * Resolve the git ref for a uuid, falling back to git refs if the in-memory map misses.
   */
  private async resolveRef(sessionId: string, cwd: string, uuid: string): Promise<string | null> {
    const s = this.sessions.get(sessionId);
    const cached = s?.uuidToRef.get(uuid);
    if (cached) return cached;

    // Fallback: scan git refs
    try {
      const output = await git(
        ['for-each-ref', '--format=%(refname) %(subject)', `refs/grove/checkpoints/${sessionId}/`],
        cwd
      );
      logger.debug(`[checkpoints] resolveRef fallback session=${sessionId} uuid=${uuid} refs=${output.split('\n').filter(Boolean).length}`);
      for (const line of output.split('\n')) {
        if (!line.trim()) continue;
        const spaceIdx = line.indexOf(' ');
        if (spaceIdx === -1) continue;
        const ref = line.slice(0, spaceIdx);
        const subject = line.slice(spaceIdx + 1);
        const uuidMatch = subject.match(/uuid=(\S+)/);
        if (uuidMatch?.[1] === uuid) {
          // Cache for future lookups
          if (s) s.uuidToRef.set(uuid, ref);
          return ref;
        }
      }
      logger.debug(`[checkpoints] resolveRef fallback: uuid=${uuid} not found in refs`);
    } catch (err) {
      logger.debug(`[checkpoints] resolveRef fallback failed:`, err);
    }
    return null;
  }

  /**
   * Restore the working tree to the state at a specific checkpoint, keeping
   * a copy of the files it replaces; returns the copy (restoreKept brings
   * it back).
   */
  async restore(sessionId: string, cwd: string, uuid: string): Promise<string> {
    const ref = await this.resolveRef(sessionId, cwd, uuid);
    if (!ref) throw new Error(`No checkpoint found for uuid=${uuid}`);

    const oid = (await git(['rev-parse', ref], cwd)).trim();
    const copy = await this.queued(sessionId, () => this.keepThenRestore(sessionId, cwd, oid));
    logger.debug(`[checkpoints] restored session=${sessionId} uuid=${uuid}`);
    return copy;
  }

  /**
   * Bring back a kept copy of the files (one restore returned). The ones it
   * replaces are kept in turn; returns that copy.
   */
  async restoreKept(sessionId: string, cwd: string, copy: string): Promise<string> {
    const kept = await this.queued(sessionId, async () => {
      await this.checkKept(sessionId, cwd, copy);
      return this.keepThenRestore(sessionId, cwd, copy);
    });
    logger.debug(`[checkpoints] brought back kept files session=${sessionId}`);
    return kept;
  }

  /** Run `work` in the thread's capture queue, so a restore never overlaps
   *  a capture (a checkpoint of half-restored files) or another restore. */
  private queued<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const s = this.getOrCreate(sessionId);
    const result = s.captureQueue.then(work);
    s.captureQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Throw unless `copy` is one of this thread's kept copies: the latest,
   *  or one before it (each copy's parent is the one before). */
  private async checkKept(sessionId: string, cwd: string, copy: string): Promise<void> {
    const kept = (await git(['for-each-ref', '--format=%(objectname)', keptRef(sessionId)], cwd)).trim();
    if (!kept) throw new Error('There are no kept files to bring back.');
    if (!/^[0-9a-f]{40,64}$/.test(copy)) throw new Error('That copy of the files is no longer kept.');
    const check = await gitExit(['merge-base', '--is-ancestor', copy, kept], cwd);
    if (check.exitCode === 0) return;
    // 1: not in the chain. 128: an object git doesn't have.
    if (check.exitCode === 1 || check.exitCode === 128) throw new Error('That copy of the files is no longer kept.');
    throw new Error(`Couldn't check the kept copy of the files: ${check.stderr.trim() || `git exited with ${check.exitCode}`}`);
  }

  /** Copy the files as they are now (the only copy there would be), then
   *  set the working tree to `oid`: tracked files restored, files it doesn't
   *  have removed, ignored files left alone, nothing staged. Returns the copy;
   *  a restore that fails partway throws with it (`copy`) as the way back. */
  private async keepThenRestore(sessionId: string, cwd: string, oid: string): Promise<string> {
    let copy: string;
    try {
      copy = await this.keepFiles(sessionId, cwd);
    } catch (err) {
      throw new Error(`Couldn't keep a copy of the files as they are, so none were restored: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    try {
      await git(['restore', '--source', oid, '--worktree', '--staged', '--', '.'], cwd);
      await git(['clean', '-fd', '--', '.'], cwd);
      await git(['reset', '--quiet', '--', '.'], cwd);
    } catch (err) {
      throw Object.assign(
        new Error(`Couldn't finish restoring the files, so some may have changed: ${err instanceof Error ? err.message : String(err)}`),
        { copy },
      );
    }
    return copy;
  }

  /** Write the working tree as a commit at keptRef and return it. Its parent
   *  is the copy before, so every copy stays reachable, and can be brought
   *  back, for as long as the thread has its refs. */
  private async keepFiles(sessionId: string, cwd: string): Promise<string> {
    const treeOid = await this.snapshotTree(sessionId, cwd);
    const before = (await git(['for-each-ref', '--format=%(objectname)', keptRef(sessionId)], cwd)).trim();
    // No uuid= in the message: the checkpoint list, history and resume
    // read only commits that have one.
    const commitOid = (await gitEnv(
      ['commit-tree', treeOid, ...(before ? ['-p', before] : []), '-m', 'grove kept files'], cwd, CHECKPOINT_IDENTITY_ENV,
    )).trim();
    await git(['update-ref', keptRef(sessionId), commitOid], cwd);
    return commitOid;
  }

  /**
   * The Rewind preview: a unified diff between a checkpoint and the current
   * working tree, or, when that is over PREVIEW_MAX_CHARS, a note and git's
   * --stat list of the files it changes.
   *
   * Builds a tree object from the current working tree (incl. untracked files,
   * excl. ignored; see snapshotTree), then diffs the checkpoint ref against it.
   * A bare `git diff <ref> -- .` omits untracked files, so files the agent
   * created since the checkpoint wouldn't appear — even though rewind deletes
   * them — making the preview understate what a rewind removes.
   */
  async diff(sessionId: string, cwd: string, uuid: string): Promise<string> {
    const ref = await this.resolveRef(sessionId, cwd, uuid);
    if (!ref) return 'No checkpoint found for this message';

    const currentTree = await this.writeWorkingTree(sessionId, cwd);
    // --no-color: the preview is plain text, whatever color.ui says.
    const range = ['--no-color', ref, currentTree, '--', '.'];
    const patch = await gitPatch(['diff', ...range], cwd, PREVIEW_MAX_CHARS);
    if (patch !== null) return patch || '(no changes)';
    // Too long to show: the files it changes and by how much. Git lists the
    // first PREVIEW_MAX_FILES, then "...", and always the totals.
    const stat = await git(['diff', '--stat', `--stat-count=${PREVIEW_MAX_FILES}`, ...range], cwd);
    return `The full diff is too long to show here. The files it changes:\n\n${stat}`;
  }

  /** Recent working-tree snapshots. The review UI asks for the file list and
   *  then several per-file diffs within a few hundred ms; those calls opt in
   *  to reusing one tree object so they stay consistent with each other and
   *  don't re-add the whole tree each time. Everything else (history stats,
   *  the Rewind preview) always snapshots fresh. */
  private workingTreeMemo = new Map<string, { oid: string; at: number }>();
  private static WORKING_TREE_REUSE_MS = 1000;

  /**
   * Build a tree object for the current working tree (incl. untracked files,
   * excl. ignored; see snapshotTree) and return its oid. With `reuseRecent`,
   * a snapshot taken within the last second is returned as is.
   */
  private async writeWorkingTree(sessionId: string, cwd: string, reuseRecent = false): Promise<string> {
    const memo = this.workingTreeMemo.get(sessionId);
    if (reuseRecent && memo && Date.now() - memo.at < CheckpointManager.WORKING_TREE_REUSE_MS) return memo.oid;
    const oid = await this.snapshotTree(sessionId, cwd);
    this.workingTreeMemo.set(sessionId, { oid, at: Date.now() });
    return oid;
  }

  /**
   * The two trees a checkpoint comparison spans. `turn` = this checkpoint to
   * the next one (or the working tree for the latest turn); `since` = this
   * checkpoint to the working tree; `full` = the session's oldest checkpoint
   * to the working tree. Null when the checkpoint cannot be found.
   */
  async range(sessionId: string, cwd: string, uuid: string, scope: CheckpointDiffScope): Promise<{ from: string; to: string } | null> {
    if (scope === 'full') {
      await this.waitForPending(sessionId);
      let refs: CheckpointRef[] = [];
      try { refs = await this.listRefs(sessionId, cwd); } catch { /* no refs */ }
      if (refs.length === 0) return null;
      return { from: refs[0].ref, to: await this.writeWorkingTree(sessionId, cwd, true) };
    }
    const ref = await this.resolveRef(sessionId, cwd, uuid);
    if (!ref) return null;
    if (scope === 'since') return { from: ref, to: await this.writeWorkingTree(sessionId, cwd, true) };
    let refs: CheckpointRef[] = [];
    try { refs = await this.listRefs(sessionId, cwd); } catch { /* fall through */ }
    const idx = refs.findIndex(r => r.ref === ref);
    const next = idx >= 0 ? refs[idx + 1] : undefined;
    return { from: ref, to: next ? next.ref : await this.writeWorkingTree(sessionId, cwd, true) };
  }

  /** Files changed across a checkpoint comparison, with line counts and the
   *  new-side blob id as content hash. */
  async files(sessionId: string, cwd: string, uuid: string, scope: CheckpointDiffScope): Promise<GitStatusResult> {
    const range = await this.range(sessionId, cwd, uuid, scope);
    if (!range) return { entries: [], scopeError: scope === 'full' ? 'No checkpoints found for this thread' : 'No checkpoint found for this message' };
    const entries = parseDiffRaw(await git(['diff', '--raw', '-z', '--no-abbrev', range.from, range.to, '--', '.'], cwd));
    if (entries.length === 0) return { entries };
    try {
      const stats = new Map(parseNumstatRows(await git(['diff', '--numstat', '-z', range.from, range.to, '--', '.'], cwd)).map(s => [s.path, s]));
      for (const e of entries) {
        const st = stats.get(e.filePath);
        if (st && !st.binary) { e.additions = st.additions; e.deletions = st.deletions; }
      }
    } catch { /* best-effort */ }
    return { entries };
  }

  /** Unified diff of one file across a checkpoint comparison. */
  async fileDiff(sessionId: string, cwd: string, uuid: string, scope: CheckpointDiffScope, relPath: string): Promise<FileDiffResult> {
    const imgExt = imageExtFor(relPath);
    if (imgExt) return { kind: 'image', ext: imgExt };
    const range = await this.range(sessionId, cwd, uuid, scope);
    if (!range) return { kind: 'text', patch: '' };
    const diff = await gitPatch(['diff', range.from, range.to, '--', relPath], cwd);
    if (diff === null) return patchOverLimit();
    if (detectBinaryDiff(diff)) return { kind: 'binary' };
    return patchResult(diff);
  }

  /** New-side content of one file across a checkpoint comparison, as lines. */
  async fileLines(sessionId: string, cwd: string, uuid: string, scope: CheckpointDiffScope, relPath: string): Promise<FileLinesResult> {
    const range = await this.range(sessionId, cwd, uuid, scope);
    if (!range) return null;
    try {
      const lines = await blobLines(cwd, range.to, relPath);
      return lines ? { lines } : null;
    } catch {
      return null;
    }
  }

  /**
   * List all checkpoint refs for a session (including the internal baseline),
   * sorted oldest-first. Throws if for-each-ref fails.
   */
  private async listRefs(sessionId: string, cwd: string): Promise<CheckpointRef[]> {
    const SEP = '@@GROVE_SEP@@';
    const output = await git(
      ['for-each-ref', `--format=%(refname)${SEP}%(subject)${SEP}%(body)${SEP}%(objectname)`, `refs/grove/checkpoints/${sessionId}/`],
      cwd
    );
    const items: CheckpointRef[] = [];
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split(SEP);
      if (parts.length < 2) continue;
      const ref = parts[0].trim();
      const subject = parts[1].trim();
      const body = (parts[2] ?? '').trim();
      const oid = parts[3]?.trim() || undefined;

      const turnMatch = ref.match(/\/turn\/(\d+)$/);
      const turn = turnMatch ? parseInt(turnMatch[1], 10) : 0;

      const uuidMatch = subject.match(/uuid=(\S+)/);
      if (!uuidMatch) continue;

      const textMatch = body.match(/^text=(.*)/);
      const text = textMatch?.[1] || undefined;

      items.push({ ref, turn, uuid: uuidMatch[1], text, oid });
    }
    items.sort((a, b) => a.turn - b.turn);
    return items;
  }

  /**
   * Per-turn diff history: for each checkpoint, the changes made between it
   * and the next checkpoint (or the current working tree for the latest one).
   * Since each checkpoint is captured when a user message is sent — before the
   * agent acts on it — an entry describes what that turn changed on disk.
   * Also returns cumulative stats from the session baseline to now.
   */
  async history(sessionId: string, cwd: string): Promise<DiffHistoryResult> {
    await this.waitForPending(sessionId);
    const empty: DiffHistoryResult = {
      entries: [],
      total: { filesChanged: 0, additions: 0, deletions: 0 },
    };

    let refs: CheckpointRef[];
    try {
      refs = await this.listRefs(sessionId, cwd);
    } catch {
      return empty;
    }
    if (refs.length === 0) return empty;

    try {
      const currentTree = await this.writeWorkingTree(sessionId, cwd);
      const cache = this.getOrCreate(sessionId).numstatCache;

      // Cached by content ids: a (checkpoint, checkpoint) pair never changes,
      // and the working tree's tree oid only matches while nothing on disk moved.
      const numstat = async (from: CheckpointRef, to: CheckpointRef | string): Promise<DiffStats> => {
        const toRef = typeof to === 'string' ? to : to.ref;
        const key = `${from.oid ?? from.ref}..${typeof to === 'string' ? to : (to.oid ?? to.ref)}`;
        const hit = cache.get(key);
        if (hit) return hit;
        const out = await git(['diff', '--numstat', from.ref, toRef, '--', '.'], cwd);
        const stats = parseNumstat(out);
        if (cache.size >= NUMSTAT_CACHE_MAX) cache.clear();
        cache.set(key, stats);
        return stats;
      };

      const entries: DiffHistoryEntry[] = [];
      for (let i = 0; i < refs.length; i++) {
        const r = refs[i];
        if (SENTINEL_UUIDS.has(r.uuid)) continue;
        let stats: DiffStats = { filesChanged: 0, additions: 0, deletions: 0 };
        try {
          stats = await numstat(r, refs[i + 1] ?? currentTree);
        } catch (err) {
          logger.debug(`[checkpoints] history numstat failed turn=${r.turn}:`, err);
        }
        entries.push({ uuid: r.uuid, turn: r.turn, text: r.text, ...stats });
      }

      // Cumulative stats: oldest ref (the baseline for new sessions) → now
      let total: DiffStats = { filesChanged: 0, additions: 0, deletions: 0 };
      try {
        total = await numstat(refs[0], currentTree);
      } catch (err) {
        logger.debug(`[checkpoints] history total numstat failed:`, err);
      }

      // Newest first, matching list()
      entries.sort((a, b) => b.turn - a.turn);
      return { entries, total };
    } catch (err) {
      logger.warn(`[checkpoints] history failed session=${sessionId}:`, err);
      return empty;
    }
  }

  /**
   * Remove all checkpoint refs with turns strictly after the given uuid's turn.
   * Called on rewind to prevent orphaned future checkpoints from lingering.
   */
  async pruneAfter(sessionId: string, cwd: string, uuid: string): Promise<void> {
    // Wait for any in-flight capture to finish before pruning,
    // otherwise it could complete after we prune and create an orphaned ref.
    await this.waitForPending(sessionId);

    const ref = await this.resolveRef(sessionId, cwd, uuid);
    if (!ref) return;

    const turnMatch = ref.match(/\/turn\/(\d+)$/);
    if (!turnMatch) return;
    const rewindTurn = parseInt(turnMatch[1], 10);

    try {
      const output = await git(
        ['for-each-ref', '--format=%(refname)', `refs/grove/checkpoints/${sessionId}/`],
        cwd
      );
      const s = this.sessions.get(sessionId);
      const later = output.split('\n').map((line) => line.trim()).filter((r) => {
        const m = r.match(/\/turn\/(\d+)$/);
        return m !== null && parseInt(m[1], 10) > rewindTurn;
      });
      await deleteRefs(cwd, later);
      // Remove from in-memory map
      if (s) {
        for (const r of later) {
          for (const [u, cachedRef] of s.uuidToRef) {
            if (cachedRef === r) { s.uuidToRef.delete(u); break; }
          }
        }
      }
      // Reset turnCount so next capture continues from the rewind point
      if (s) s.turnCount = rewindTurn;
      logger.debug(`[checkpoints] pruned turns after ${rewindTurn} for session=${sessionId}`);
    } catch (err) {
      logger.warn(`[checkpoints] pruneAfter failed:`, err);
    }
  }

  /**
   * Delete all checkpoint refs for a session.
   */
  async cleanup(sessionId: string, cwd: string): Promise<void> {
    try {
      const output = await git(
        ['for-each-ref', '--format=%(refname)', `refs/grove/checkpoints/${sessionId}/`],
        cwd
      );
      await deleteRefs(cwd, output.split('\n').map(l => l.trim()).filter(Boolean));
    } catch {
      // No refs to clean up
    }
    // And its snapshot index, once a snapshot under way is done with it.
    const s = this.sessions.get(sessionId);
    if (s) await s.snapshotQueue;
    const paths = s?.snapshotPaths ?? await snapshotPaths(cwd, sessionId);
    if (paths) await removeTemp(paths.index);
    this.sessions.delete(sessionId);
    logger.debug(`[checkpoints] cleaned up session=${sessionId}`);
  }

  /**
   * Rebuild checkpoint state from existing refs (for session resumption).
   * Serialized through the captureQueue to prevent races with concurrent captures.
   */
  async resume(sessionId: string, cwd: string): Promise<void> {
    const s = this.getOrCreate(sessionId);
    s.captureQueue = s.captureQueue.then(() =>
      this._doResume(s, sessionId, cwd)
    ).catch(err => {
      logger.warn(`[checkpoints] resume failed session=${sessionId}:`, err);
    });
    return s.captureQueue;
  }

  private async _doResume(
    s: SessionCheckpoints, sessionId: string, cwd: string
  ): Promise<void> {
    try {
      const output = await git(
        ['for-each-ref', '--format=%(refname) %(subject)', `refs/grove/checkpoints/${sessionId}/`],
        cwd
      );
      let maxTurn = 0;
      for (const line of output.split('\n')) {
        if (!line.trim()) continue;
        const spaceIdx = line.indexOf(' ');
        if (spaceIdx === -1) continue;
        const ref = line.slice(0, spaceIdx);
        const subject = line.slice(spaceIdx + 1);

        // Extract turn number from ref path
        const turnMatch = ref.match(/\/turn\/(\d+)$/);
        const turn = turnMatch ? parseInt(turnMatch[1], 10) : 0;
        if (turn > maxTurn) maxTurn = turn;

        // Extract uuid from commit message
        const uuidMatch = subject.match(/uuid=(\S+)/);
        if (uuidMatch) {
          s.uuidToRef.set(uuidMatch[1], ref);
        }
      }
      // Only advance turnCount — never reset it below what captures have already used
      if (maxTurn > s.turnCount) {
        s.turnCount = maxTurn;
      }
      logger.debug(`[checkpoints] resumed session=${sessionId} turns=${s.turnCount} uuids=${s.uuidToRef.size}`);
    } catch {
      // No existing refs — fresh session
    }
  }

  /**
   * List all checkpoints for a session, sorted newest-first. Turns captured
   * before the most recent /clear are flagged `beforeClear`.
   */
  async list(sessionId: string, cwd: string): Promise<CheckpointInfo[]> {
    // Wait for any in-flight capture so the latest checkpoint is included
    await this.waitForPending(sessionId);

    try {
      const items = await this.listRefs(sessionId, cwd);
      let lastClearTurn = -1;
      for (const i of items) {
        if (i.uuid === CLEAR_UUID && i.turn > lastClearTurn) lastClearTurn = i.turn;
      }
      // Filter out internal sentinel checkpoints; sort newest first
      const visible: CheckpointInfo[] = items
        .filter(i => !SENTINEL_UUIDS.has(i.uuid))
        .map(({ uuid, turn, ref, text }) => ({
          uuid, turn, ref, text,
          ...(turn < lastClearTurn ? { beforeClear: true } : {}),
        }));
      visible.sort((a, b) => b.turn - a.turn);
      return visible;
    } catch {
      return [];
    }
  }

  /**
   * Check if a checkpoint exists for a given UUID.
   */
  has(sessionId: string, uuid: string): boolean {
    return this.sessions.get(sessionId)?.uuidToRef.has(uuid) ?? false;
  }
}
