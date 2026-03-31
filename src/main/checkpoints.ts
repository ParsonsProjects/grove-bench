import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { git, gitEnv } from './git.js';
import { logger } from './logger.js';

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
   */
  async diff(sessionId: string, cwd: string, uuid: string): Promise<string> {
    const ref = await this.resolveRef(sessionId, cwd, uuid);
    if (!ref) return 'No checkpoint found for this message';

    const output = await git(['diff', ref, '--', '.'], cwd);
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
   */
  async resume(sessionId: string, cwd: string): Promise<void> {
    const s = this.getOrCreate(sessionId);
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
      s.turnCount = maxTurn;
      logger.debug(`[checkpoints] resumed session=${sessionId} turns=${maxTurn} uuids=${s.uuidToRef.size}`);
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
      // Use a delimiter to separate fields since body can contain spaces
      const SEP = '@@GROVE_SEP@@';
      const output = await git(
        ['for-each-ref', `--format=%(refname)${SEP}%(subject)${SEP}%(body)`, `refs/grove/checkpoints/${sessionId}/`],
        cwd
      );
      const items: (CheckpointInfo & { text?: string })[] = [];
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

        // Extract display text from commit body (text=...)
        const textMatch = body.match(/^text=(.*)/);
        const text = textMatch?.[1] || undefined;

        items.push({ uuid: uuidMatch[1], turn, ref, text });
      }
      // Filter out internal baseline checkpoint
      const visible = items.filter(i => i.uuid !== '__baseline__');
      // Sort newest first (descending turn)
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
