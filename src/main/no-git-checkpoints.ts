import type { CheckpointManager } from './checkpoints.js';

/** The checkpoint operations a conversation uses. */
export type Checkpoints = Pick<CheckpointManager,
  | 'capture' | 'captureBaseline' | 'markCleared' | 'resume' | 'cleanup' | 'pruneAfter' | 'restore'
  | 'list' | 'history' | 'diff' | 'turnDiff' | 'fullThreadDiff' | 'files' | 'fileDiff' | 'fileLines'>;

const NO_GIT = 'This project isn\'t a git repository, so there are no checkpoints: files the agent changed can\'t be restored.';

/**
 * Checkpoints for a conversation in a folder that isn't a git repository.
 * Checkpoints are git commits under refs/grove, so there are none: captures
 * do nothing, lists are empty, and restoring files says why it can't.
 */
export const noGitCheckpoints: Checkpoints = {
  capture: async () => false,
  captureBaseline: async () => false,
  markCleared: async () => {},
  resume: async () => {},
  cleanup: async () => {},
  pruneAfter: async () => {},
  restore: async () => { throw new Error(NO_GIT); },
  list: async () => [],
  history: async () => ({ entries: [], total: { filesChanged: 0, additions: 0, deletions: 0 } }),
  diff: async () => '',
  turnDiff: async () => '',
  fullThreadDiff: async () => '',
  files: async () => ({ entries: [] }),
  fileDiff: async () => { throw new Error(NO_GIT); },
  fileLines: async () => null,
};
