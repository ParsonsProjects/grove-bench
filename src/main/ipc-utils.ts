/**
 * Pure/testable logic extracted from ipc.ts handlers.
 */
import * as path from 'node:path';
import type { AgentEvent } from '../shared/types.js';

// ─── File path sanitization ───

/**
 * Sanitize and resolve a file path relative to a worktree directory.
 * Strips Docker `/workspace/` prefix and worktree absolute prefix.
 * Throws if the resolved path escapes the worktree.
 */
export function sanitizeFilePath(worktreePath: string, filePath: string): string {
  // Strip trailing slashes from file path
  let relPath = filePath.replace(/\/$/, '');
  // Strip Docker container paths (/workspace/...)
  relPath = relPath.replace(/^\/workspace\//, '');
  // Strip the host worktree prefix if it's an absolute path
  const normalWt = path.normalize(worktreePath) + path.sep;
  if (path.normalize(relPath).startsWith(normalWt)) {
    relPath = path.relative(worktreePath, relPath);
  }
  const resolved = path.resolve(worktreePath, relPath);
  if (!path.normalize(resolved).startsWith(normalWt)) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

// ─── Directory extraction ───

/**
 * Extract unique directory prefixes from a list of file paths (e.g. from `git ls-files`).
 * Returns sorted directory paths with trailing slashes.
 */
export function extractDirsFromFiles(files: string[]): string[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/') + '/');
    }
  }
  return [...dirs].sort();
}

// ─── Diff synthesis ───

/**
 * Synthesize a unified diff for an untracked/new file (all lines are additions).
 */
export function synthesizeNewFileDiff(relPath: string, content: string): string {
  const normalizedPath = relPath.replace(/\\/g, '/');
  const lines = content.split('\n');
  const header = `--- /dev/null\n+++ b/${normalizedPath}\n@@ -0,0 +1,${lines.length} @@\n`;
  return header + lines.map(l => `+${l}`).join('\n');
}

// ─── Validation ───

/** Validate a port number (integer, 1–65535). Throws on invalid. */
export function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port number');
  }
}

/** Validate a URL for external opening (http/https only). Throws on invalid. */
export function validateExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Only http/https URLs are allowed');
  }
}

// ─── Prelaunch event buffer ───

/**
 * Manages events emitted before a session object exists (worktree creation, npm install).
 * These are sent live via IPC but not persisted — the history handlers prepend them
 * so the renderer's history replay can show them.
 */
export class PrelaunchBuffer {
  private buffers = new Map<string, AgentEvent[]>();

  create(id: string): void {
    this.buffers.set(id, []);
  }

  push(id: string, event: AgentEvent): void {
    this.buffers.get(id)?.push(event);
  }

  get(id: string): AgentEvent[] {
    return this.buffers.get(id) ?? [];
  }

  delete(id: string): void {
    this.buffers.delete(id);
  }

  count(id: string): number {
    return this.get(id).length;
  }

  /** Prepend prelaunch events to a session's full event history. */
  prependToHistory(id: string, history: AgentEvent[]): AgentEvent[] {
    const prelaunch = this.get(id);
    if (prelaunch.length === 0) return history;
    return [...prelaunch, ...history];
  }

  /** Adjust a paginated history response to account for prelaunch events. */
  adjustPage(
    id: string,
    page: { events: AgentEvent[]; totalCount: number; startIndex: number },
  ): { events: AgentEvent[]; totalCount: number; startIndex: number } {
    const prelaunch = this.get(id);
    if (prelaunch.length === 0) return page;

    if (page.startIndex === 0) {
      // First page — prepend prelaunch events
      return {
        events: [...prelaunch, ...page.events],
        totalCount: page.totalCount + prelaunch.length,
        startIndex: 0,
      };
    }
    // Non-first page — adjust indices
    return {
      events: page.events,
      totalCount: page.totalCount + prelaunch.length,
      startIndex: page.startIndex + prelaunch.length,
    };
  }
}
