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
   */
  async capture(sessionId: string, cwd: string, uuid: string): Promise<void> {
    const s = this.getOrCreate(sessionId);
    // Queue captures to prevent concurrent git index corruption
    s.captureQueue = s.captureQueue.then(() =>
      this._doCapture(s, sessionId, cwd, uuid)
    ).catch(err => {
      logger.warn(`[checkpoints] capture failed session=${sessionId} uuid=${uuid}:`, err);
    });
    return s.captureQueue;
  }

  private async _doCapture(
    s: SessionCheckpoints, sessionId: string, cwd: string, uuid: string
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

      // Create a commit object pointing to this tree
      const commitMsg = `grove checkpoint turn=${turn} uuid=${uuid}`;
      const commitOid = (await git(
        ['commit-tree', treeOid, '-m', commitMsg], cwd
      )).trim();

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
   * Restore the working tree to the state at a specific checkpoint.
   */
  async restore(sessionId: string, cwd: string, uuid: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    const ref = s?.uuidToRef.get(uuid);
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
    const s = this.sessions.get(sessionId);
    const ref = s?.uuidToRef.get(uuid);
    if (!ref) return 'No checkpoint found for this message';

    const output = await git(['diff', ref, '--', '.'], cwd);
    return output || '(no changes)';
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
   * Check if a checkpoint exists for a given UUID.
   */
  has(sessionId: string, uuid: string): boolean {
    return this.sessions.get(sessionId)?.uuidToRef.has(uuid) ?? false;
  }
}
