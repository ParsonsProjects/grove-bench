import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { execa } from 'execa';
import { IPC } from '../shared/types.js';
import type { CreateSessionOpts, PrerequisiteStatus, PermissionDecision, SessionInfo } from '../shared/types.js';
import { sessionManager } from './agent-session.js';
import { worktreeManager } from './worktree-manager.js';
import { checkAllPrerequisites } from './prerequisites.js';
import { validateBranchName, branchExists, listBranches, git } from './git.js';
import { logger } from './logger.js';
import { killProcessOnPort } from './port-killer.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';

export function registerHandlers() {
  // ─── Repo ───

  ipcMain.handle(IPC.REPO_SELECT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Git Repository',
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    const repoPath = result.filePaths[0];

    const valid = await worktreeManager.validateRepo(repoPath);
    if (!valid) return null;

    // Clean up any orphan worktrees from previous crashes
    const orphans = await worktreeManager.cleanupOrphans(repoPath);
    if (orphans > 0) {
      logger.info(`Cleaned up ${orphans} orphan worktree(s) in ${repoPath}`);
    }

    return repoPath;
  });

  ipcMain.handle(IPC.REPO_VALIDATE, async (_event, repoPath: string) => {
    return worktreeManager.validateRepo(repoPath);
  });

  ipcMain.handle(IPC.REPO_REMOVE, async (_event, repoPath: string) => {
    const activeSessions = sessionManager.getSessionsByRepo(repoPath);
    if (activeSessions.length > 0) {
      throw new Error('Cannot remove repo while it has active sessions');
    }

    const orphans = await worktreeManager.cleanupOrphans(repoPath);
    if (orphans > 0) {
      logger.info(`Cleaned up ${orphans} orphan worktree(s) on repo remove for ${repoPath}`);
    }
  });

  // ─── Sessions ───

  ipcMain.handle(IPC.SESSION_CREATE, async (event, opts: CreateSessionOpts) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window found');

    const exists = await branchExists(opts.repoPath, opts.branchName);

    if (opts.useExisting) {
      if (!exists) {
        throw new Error(`Branch "${opts.branchName}" does not exist`);
      }
    } else {
      const validName = await validateBranchName(opts.branchName);
      if (!validName) {
        throw new Error(`Invalid branch name: "${opts.branchName}"`);
      }
      if (exists) {
        throw new Error(`Branch "${opts.branchName}" already exists`);
      }
    }

    logger.info(`Creating session: branch=${opts.branchName}, repo=${opts.repoPath}, useExisting=${!!opts.useExisting}`);

    // Create worktree
    const worktree = await worktreeManager.create({
      repoPath: opts.repoPath,
      branchName: opts.branchName,
      baseBranch: opts.baseBranch,
      useExisting: opts.useExisting,
    });

    // Auto-copy untracked files (.env, etc.)
    try {
      const config = await worktreeManager.getRepoConfig(opts.repoPath);
      if (config.copyFiles.length > 0) {
        await worktreeManager.copyUntrackedFiles(worktree.id, config.copyFiles);
        logger.info(`Copied ${config.copyFiles.length} config file(s) to worktree`);
      }
    } catch (e) {
      logger.warn('Failed to copy untracked files:', e);
    }

    // Start Claude agent in the worktree
    const session = await sessionManager.createSession({
      id: worktree.id,
      branch: worktree.branch,
      cwd: worktree.path,
      repoPath: opts.repoPath,
      window: win,
    });

    logger.info(`Session created: id=${session.id}`);
    return { id: session.id, branch: session.branch };
  });

  ipcMain.handle(IPC.SESSION_RESUME, async (event, id: string, repoPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window found');

    const worktree = worktreeManager.getWorktree(id);
    if (!worktree) {
      throw new Error(`Worktree ${id} not found`);
    }

    // If already running, just reattach the window so events flow to new webContents
    if (sessionManager.getSession(id)) {
      const s = sessionManager.getSession(id)!;
      sessionManager.reattachWindow(id, win);
      return { id: s.id, branch: s.branch };
    }

    // Look up saved Claude session ID for conversation resumption
    const claudeSessionId = await worktreeManager.getClaudeSessionId(id);
    logger.info(`Resuming session: id=${id}, branch=${worktree.branch}, claudeSession=${claudeSessionId ?? 'none'}`);

    const session = await sessionManager.createSession({
      id: worktree.id,
      branch: worktree.branch,
      cwd: worktree.path,
      repoPath,
      window: win,
      resumeClaudeSessionId: claudeSessionId,
    });

    logger.info(`Session resumed: id=${session.id}`);
    return { id: session.id, branch: session.branch };
  });

  ipcMain.handle(IPC.SESSION_STOP, async (_event, id: string) => {
    logger.info(`Stopping session (keeping worktree): id=${id}`);
    await sessionManager.destroySession(id);
    logger.info(`Session stopped: id=${id}`);
  });

  ipcMain.handle(IPC.SESSION_DESTROY, async (_event, id: string, deleteBranch = false) => {
    logger.info(`Destroying session: id=${id}, deleteBranch=${deleteBranch}`);
    await sessionManager.destroySession(id); // includes 500ms Windows handle-release delay
    await worktreeManager.remove(id, deleteBranch);
    logger.info(`Session destroyed: id=${id}`);
  });

  ipcMain.handle(IPC.SESSION_LIST, async (): Promise<SessionInfo[]> => {
    return sessionManager.listSessions();
  });

  // ─── Branches ───

  ipcMain.handle(IPC.BRANCH_LIST, async (_event, repoPath: string) => {
    return listBranches(repoPath);
  });

  // ─── Worktrees ───

  ipcMain.handle(IPC.WORKTREE_LIST, async (_event, repoPath: string) => {
    const worktrees = await worktreeManager.list(repoPath);
    for (const wt of worktrees) {
      worktreeManager.register(wt);
    }
    return worktrees;
  });

  // ─── Prerequisites ───

  ipcMain.handle(IPC.PREREQUISITES_CHECK, async (): Promise<PrerequisiteStatus> => {
    return checkAllPrerequisites();
  });

  // ─── Agent I/O ───

  ipcMain.on(IPC.AGENT_SEND, (_event, sessionId: string, content: string, images?: import('../shared/types.js').ImageAttachment[]) => {
    sessionManager.sendMessage(sessionId, content, images);
  });

  ipcMain.handle(IPC.AGENT_SET_MODE, (_event, sessionId: string, mode: string) => {
    sessionManager.setMode(sessionId, mode);
  });

  ipcMain.handle(IPC.AGENT_SET_MODEL, (_event, sessionId: string, model?: string) => {
    return sessionManager.setModel(sessionId, model);
  });

  ipcMain.on(IPC.AGENT_PERMISSION, (_event, sessionId: string, decision: PermissionDecision) => {
    sessionManager.respondToPermission(sessionId, decision);
  });

  ipcMain.handle(IPC.AGENT_HISTORY, (_event, sessionId: string) => {
    return sessionManager.getEventHistory(sessionId);
  });

  // ─── File operations (for @ file picker) ───

  ipcMain.handle(IPC.FILE_LIST, async (_event, sessionId: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const output = await git(['ls-files'], worktree.path);
    const files = output.split('\n').map(l => l.trim()).filter(Boolean);

    // Extract unique directories from file paths
    const dirs = new Set<string>();
    for (const f of files) {
      const parts = f.split('/');
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/') + '/');
      }
    }

    // Return dirs first (sorted), then files
    const sortedDirs = [...dirs].sort();
    return [...sortedDirs, ...files];
  });

  ipcMain.handle(IPC.FILE_OPEN_IN_EDITOR, async (_event, sessionId: string, filePath: string, line?: number) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const resolved = path.resolve(worktree.path, filePath);
    const normalizedResolved = path.normalize(resolved);
    const normalizedWorktree = path.normalize(worktree.path) + path.sep;
    if (!normalizedResolved.startsWith(normalizedWorktree)) {
      throw new Error('Path traversal not allowed');
    }

    // Try VS Code first, then fall back to system default
    const gotoArg = line ? `${resolved}:${line}` : resolved;

    return new Promise<void>((resolve, reject) => {
      // VS Code supports file:line syntax via -g flag
      const codeArgs = line ? ['-g', gotoArg] : [resolved];
      execFile('code', codeArgs, (err) => {
        if (!err) {
          resolve();
          return;
        }
        // Fallback: try cursor, then system open
        const cursorArgs = line ? ['-g', gotoArg] : [resolved];
        execFile('cursor', cursorArgs, (err2) => {
          if (!err2) {
            resolve();
            return;
          }
          // Final fallback: system default
          if (process.platform === 'win32') {
            execFile('cmd', ['/c', 'start', '""', resolved], (err3) => {
              err3 ? reject(new Error('Could not open file. Install VS Code or Cursor CLI.')) : resolve();
            });
          } else {
            const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
            execFile(opener, [resolved], (err3) => {
              err3 ? reject(new Error('Could not open file. Install VS Code or Cursor CLI.')) : resolve();
            });
          }
        });
      });
    });
  });

  // ─── External links & process cleanup ───

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
    // Only allow http/https URLs for security
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Only http/https URLs are allowed');
    }
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC.KILL_PORT, async (_event, port: number) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Invalid port number');
    }
    return killProcessOnPort(port);
  });

  // ─── File revert & diff (for changes review panel) ───

  ipcMain.handle(IPC.FILE_REVERT, async (_event, sessionId: string, filePath: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const resolved = path.resolve(worktree.path, filePath);
    if (!path.normalize(resolved).startsWith(path.normalize(worktree.path) + path.sep)) {
      throw new Error('Path traversal not allowed');
    }
    await git(['checkout', '--', filePath], worktree.path);
  });

  ipcMain.handle(IPC.FILE_DIFF, async (_event, sessionId: string, filePath: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const resolved = path.resolve(worktree.path, filePath);
    if (!path.normalize(resolved).startsWith(path.normalize(worktree.path) + path.sep)) {
      throw new Error('Path traversal not allowed');
    }
    // Get unified diff of this file vs HEAD
    try {
      return await git(['diff', 'HEAD', '--', filePath], worktree.path);
    } catch {
      // File may be untracked (new file) — show entire content as added
      return '';
    }
  });

  // ─── PR info ───

  ipcMain.handle(IPC.PR_INFO, async (_event, sessionId: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) return null;
    try {
      const { stdout } = await execa('gh', ['pr', 'view', worktree.branch, '--json', 'number,url'], {
        cwd: worktree.repoPath,
      });
      const data = JSON.parse(stdout);
      if (data.number && data.url) {
        return { number: data.number, url: data.url };
      }
      return null;
    } catch {
      return null;
    }
  });

  // ─── Plugins ───

  ipcMain.handle(IPC.PLUGIN_LIST, async () => {
    try {
      const { stdout } = await execa('claude', ['plugin', 'list', '--json', '--available']);
      return JSON.parse(stdout);
    } catch (e: any) {
      logger.warn('Failed to list plugins:', e.message);
      return { installed: [], available: [] };
    }
  });

  ipcMain.handle(IPC.PLUGIN_INSTALL, async (_event, pluginId: string, scope = 'user') => {
    await execa('claude', ['plugin', 'install', pluginId, '--scope', scope]);
  });

  ipcMain.handle(IPC.PLUGIN_UNINSTALL, async (_event, pluginId: string) => {
    await execa('claude', ['plugin', 'uninstall', pluginId]);
  });

  ipcMain.handle(IPC.PLUGIN_ENABLE, async (_event, pluginId: string) => {
    await execa('claude', ['plugin', 'enable', pluginId]);
  });

  ipcMain.handle(IPC.PLUGIN_DISABLE, async (_event, pluginId: string) => {
    await execa('claude', ['plugin', 'disable', pluginId]);
  });

  ipcMain.handle(IPC.FILE_READ, async (_event, sessionId: string, filePath: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const resolved = path.resolve(worktree.path, filePath.replace(/\/$/, ''));
    // Security: ensure resolved path is within the worktree
    if (!path.normalize(resolved).startsWith(path.normalize(worktree.path) + path.sep)) {
      throw new Error('Path traversal not allowed');
    }
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      // Return a listing of tracked files under this directory
      const output = await git(['ls-files'], worktree.path);
      const prefix = path.relative(worktree.path, resolved).replace(/\\/g, '/');
      const entries = output.split('\n').map(l => l.trim()).filter(Boolean)
        .filter(f => f.startsWith(prefix ? prefix + '/' : ''));
      return entries.join('\n');
    }
    const buf = await fs.readFile(resolved);
    // Cap at 100KB
    const maxBytes = 100 * 1024;
    if (buf.length > maxBytes) {
      return buf.subarray(0, maxBytes).toString('utf-8') + '\n... (truncated at 100KB)';
    }
    return buf.toString('utf-8');
  });
}
