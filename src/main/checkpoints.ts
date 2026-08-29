import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { git, gitEnv } from './git.js';
import { logger } from './logger.js';
import type { DiffHistoryEntry, DiffHistoryResult, DiffStats } from '../shared/types.js';

const BASELINE_UUID = '__baseline__';

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

interface CheckpointRef {
  ref: string;
  turn: number;
  uuid: string;
  text?: string;
}

interface SessionCheckpoints {
  turnCount: number;
  uuidToRef: Map<string, string>;
  captureQueue: Promise<void>;
}

export interface CheckpointInfo {
  uuid: string;
  turn: number;
  ref: string;
}

export class CheckpointManager {
  private sessions = new Map<string, SessionCheckpoints>();

  private getOrCreate(sessionId: string): SessionCheckpoints {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { turnCount: 0, uuidToRef: new Map(), captureQueue: Promise.resolve() };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /**
   * Capture a checkpoint of the current working tree state.
   * Uses a temporary git index so we don't interfere with the user's real index.
   * @param text Optional user message text to store in the checkpoint for display.
   */
  async capture(sessionId: string, cwd: string, uuid: string, text?: string): Promise<void> {
    const s = this.getOrCreate(sessionId);
    // Queue captures to prevent concurrent git index corruption
    s.captureQueue = s.captureQueue.then(() =>
      this._doCapture(s, sessionId, cwd, uuid, text)
    ).catch(err => {
      logger.warn(`[checkpoints] capture failed session=${sessionId} uuid=${uuid}:`, err);
    });
    return s.captureQueue;
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
  ): Promise<void> {
    const turn = ++s.turnCount;
    const ref = `refs/grove/checkpoints/${sessionId}/turn/${turn}`;
    const tmpIndex = path.join(os.tmpdir(), `grove-idx-${sessionId}-${turn}-${Date.now()}`);

    try {
      const env = { GIT_INDEX_FILE: tmpIndex };

      // Seed temp index from HEAD
      await gitEnv(['read-tree', 'HEAD'], cwd, env);

      // Stage all working tree changes (including untracked files)
      await gitEnv(['add', '-A'], cwd, env);

      // Write the tree object
      const treeOid = (await gitEnv(['write-tree'], cwd, env)).trim();

      // Encode message text into commit message so list() can display it
      // without depending on in-memory messages. Truncate to keep refs light.
      // Use a temp file (-F) instead of -m because Windows mangles newlines
      // in command-line arguments, which breaks the body (%(body) returns empty).
      const safeText = text ? text.replace(/[\r\n]+/g, ' ').slice(0, 200) : '';
      const commitMsg = `grove checkpoint turn=${turn} uuid=${uuid}${safeText ? `\n\ntext=${safeText}` : ''}`;
      const msgFile = path.join(os.tmpdir(), `grove-msg-${sessionId}-${turn}-${Date.now()}`);
      let commitOid: string;
      try {
        fs.writeFileSync(msgFile, commitMsg);
        commitOid = (await git(
          ['commit-tree', treeOid, '-F', msgFile], cwd
        )).trim();
      } finally {
        try { fs.rmSync(msgFile, { force: true }); } catch { /* ignore */ }
      }

      // Store the ref
      await git(['update-ref', ref, commitOid], cwd);

      s.uuidToRef.set(uuid, ref);
      logger.debug(`[checkpoints] captured session=${sessionId} turn=${turn} uuid=${uuid}`);
    } finally {
      // Always clean up temp index
      try { fs.rmSync(tmpIndex, { force: true }); } catch { /* ignore */ }
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
   * Restore the working tree to the state at a specific checkpoint.
   */
  async restore(sessionId: string, cwd: string, uuid: string): Promise<void> {
    const ref = await this.resolveRef(sessionId, cwd, uuid);
    if (!ref) throw new Error(`No checkpoint found for uuid=${uuid}`);

    const oid = (await git(['rev-parse', ref], cwd)).trim();

    // Restore all files from the checkpoint
    await git(['restore', '--source', oid, '--worktree', '--staged', '--', '.'], cwd);

    // Remove files not in the checkpoint
    await git(['clean', '-fd', '--', '.'], cwd);

    // Unstage everything so the working tree is clean but not committed
    await git(['reset', '--quiet', '--', '.'], cwd);

    logger.debug(`[checkpoints] restored session=${sessionId} uuid=${uuid}`);
  }

  /**
   * Get a unified diff between a checkpoint and the current working tree.
   *
   * Builds a tree object from the current working tree (incl. untracked files,
   * excl. ignored) in a temp index, then diffs the checkpoint ref against it.
   * A bare `git diff <ref> -- .` omits untracked files, so files the agent
   * created since the checkpoint wouldn't appear — even though rewind deletes
   * them — making the preview understate what a rewind removes.
   */
  async diff(sessionId: string, cwd: string, uuid: string): Promise<string> {
    const ref = await this.resolveRef(sessionId, cwd, uuid);
    if (!ref) return 'No checkpoint found for this message';

    const currentTree = await this.writeWorkingTree(sessionId, cwd);
    const output = await git(['diff', ref, currentTree, '--', '.'], cwd);
    return output || '(no changes)';
  }

  /**
   * Build a tree object for the current working tree (incl. untracked files,
   * excl. ignored) using a temporary index, and return its oid.
   */
  private async writeWorkingTree(sessionId: string, cwd: string): Promise<string> {
    const tmpIndex = path.join(os.tmpdir(), `grove-diff-${sessionId}-${Date.now()}`);
    try {
      const env = { GIT_INDEX_FILE: tmpIndex };
      await gitEnv(['read-tree', 'HEAD'], cwd, env);
      await gitEnv(['add', '-A'], cwd, env);
      return (await gitEnv(['write-tree'], cwd, env)).trim();
    } finally {
      try { fs.rmSync(tmpIndex, { force: true }); } catch { /* ignore */ }
    }
  }

  /**
   * List all checkpoint refs for a session (including the internal baseline),
   * sorted oldest-first. Throws if for-each-ref fails.
   */
  private async listRefs(sessionId: string, cwd: string): Promise<CheckpointRef[]> {
    const SEP = '@@GROVE_SEP@@';
    const output = await git(
      ['for-each-ref', `--format=%(refname)${SEP}%(subject)${SEP}%(body)`, `refs/grove/checkpoints/${sessionId}/`],
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

      const turnMatch = ref.match(/\/turn\/(\d+)$/);
      const turn = turnMatch ? parseInt(turnMatch[1], 10) : 0;

      const uuidMatch = subject.match(/uuid=(\S+)/);
      if (!uuidMatch) continue;

      const textMatch = body.match(/^text=(.*)/);
      const text = textMatch?.[1] || undefined;

      items.push({ ref, turn, uuid: uuidMatch[1], text });
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

      const entries: DiffHistoryEntry[] = [];
      for (let i = 0; i < refs.length; i++) {
        const r = refs[i];
        if (r.uuid === BASELINE_UUID) continue;
        const to = refs[i + 1]?.ref ?? currentTree;
        let stats: DiffStats = { filesChanged: 0, additions: 0, deletions: 0 };
        try {
          const out = await git(['diff', '--numstat', r.ref, to, '--', '.'], cwd);
          stats = parseNumstat(out);
        } catch (err) {
          logger.debug(`[checkpoints] history numstat failed turn=${r.turn}:`, err);
        }
        entries.push({ uuid: r.uuid, turn: r.turn, text: r.text, ...stats });
      }

      // Cumulative stats: oldest ref (the baseline for new sessions) → now
      let total: DiffStats = { filesChanged: 0, additions: 0, deletions: 0 };
      try {
        const out = await git(['diff', '--numstat', refs[0].ref, currentTree, '--', '.'], cwd);
        total = parseNumstat(out);
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
   * Unified diff of what a single turn changed: the checkpoint captured for
   * this user message vs the next checkpoint, or vs the current working tree
   * when it's the latest turn.
   */
  async turnDiff(sessionId: string, cwd: string, uuid: string): Promise<string> {
    const ref = await this.resolveRef(sessionId, cwd, uuid);
    if (!ref) return 'No checkpoint found for this message';

    let refs: CheckpointRef[] = [];
    try {
      refs = await this.listRefs(sessionId, cwd);
    } catch { /* fall through to working-tree diff */ }

    const idx = refs.findIndex(r => r.ref === ref);
    const next = idx >= 0 ? refs[idx + 1] : undefined;
    const to = next ? next.ref : await this.writeWorkingTree(sessionId, cwd);

    const output = await git(['diff', ref, to, '--', '.'], cwd);
    return output || '(no changes)';
  }

  /**
   * Cumulative full-thread diff: everything that changed from the session's
   * oldest checkpoint (the baseline for new sessions) to the current working
   * tree, across all turns.
   */
  async fullThreadDiff(sessionId: string, cwd: string): Promise<string> {
    await this.waitForPending(sessionId);

    let refs: CheckpointRef[] = [];
    try {
      refs = await this.listRefs(sessionId, cwd);
    } catch { /* no refs */ }
    if (refs.length === 0) return 'No checkpoints found for this session';

    const currentTree = await this.writeWorkingTree(sessionId, cwd);
    const output = await git(['diff', refs[0].ref, currentTree, '--', '.'], cwd);
    return output || '(no changes)';
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
      for (const line of output.split('\n')) {
        const r = line.trim();
        if (!r) continue;
        const m = r.match(/\/turn\/(\d+)$/);
        if (!m) continue;
        const turn = parseInt(m[1], 10);
        if (turn > rewindTurn) {
          await git(['update-ref', '-d', r], cwd).catch(() => {});
          // Remove from in-memory map
          if (s) {
            for (const [u, cachedRef] of s.uuidToRef) {
              if (cachedRef === r) { s.uuidToRef.delete(u); break; }
            }
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
      const refs = output.split('\n').map(l => l.trim()).filter(Boolean);
      for (const ref of refs) {
        await git(['update-ref', '-d', ref], cwd).catch(() => {});
      }
    } catch {
      // No refs to clean up
    }
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
   * List all checkpoints for a session, sorted newest-first.
   */
  async list(sessionId: string, cwd: string): Promise<(CheckpointInfo & { text?: string })[]> {
    // Wait for any in-flight capture so the latest checkpoint is included
    await this.waitForPending(sessionId);

    try {
      const items = await this.listRefs(sessionId, cwd);
      // Filter out internal baseline checkpoint; sort newest first
      const visible: (CheckpointInfo & { text?: string })[] = items
        .filter(i => i.uuid !== BASELINE_UUID)
        .map(({ uuid, turn, ref, text }) => ({ uuid, turn, ref, text }));
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
