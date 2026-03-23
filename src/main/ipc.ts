import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { execa } from 'execa';
import { IPC } from '../shared/types.js';
import type { CreateSessionOpts, PrerequisiteStatus, PermissionDecision, SessionInfo } from '../shared/types.js';
import { sessionManager } from './agent-session.js';
import { worktreeManager } from './worktree-manager.js';
import { checkAllPrerequisites } from './prerequisites.js';
import { adapterRegistry } from './adapters/index.js';
import { validateBranchName, branchExists, branchExistsAnywhere, listBranches, git } from './git.js';
import { parseGitStatusPorcelain } from './git-status-parser.js';
import { logger } from './logger.js';
import { killProcessOnPort } from './port-killer.js';
import { terminalManager } from './terminal.js';
import { checkForUpdate, downloadUpdate, installUpdate } from './auto-updater.js';
import * as settings from './settings.js';
import * as memory from './memory.js';
import { loadAppState, saveActiveTab, saveOpenTabs } from './app-state.js';
import crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';

/** Buffer for events emitted before the session object exists (worktree creation, npm install).
 *  These are sent live via IPC but not persisted — the AGENT_HISTORY handler
 *  prepends them so the renderer's history replay can show them. */
const prelaunchEvents = new Map<string, import('../shared/types.js').AgentEvent[]>();

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

    if (opts.direct) {
      // Direct mode — run on the repo checkout, no worktree
      const branch = opts.branchName || (await git(['rev-parse', '--abbrev-ref', 'HEAD'], opts.repoPath)).trim();
      logger.info(`Creating direct session: branch=${branch}, repo=${opts.repoPath}`);

      const entry = await worktreeManager.registerDirect(opts.repoPath, branch);

      const session = await sessionManager.createSession({
        id: entry.id,
        branch: entry.branch,
        cwd: opts.repoPath,
        repoPath: opts.repoPath,
        window: win,
        adapterType: opts.adapterType,
      });

      logger.info(`Direct session created: id=${session.id}`);
      return { id: session.id, branch: session.branch };
    }

    // ── Validation (synchronous — errors shown in dialog) ──

    if (opts.useExisting) {
      const exists = await branchExistsAnywhere(opts.repoPath, opts.branchName);
      if (!exists) {
        throw new Error(`Branch "${opts.branchName}" does not exist`);
      }
    } else {
      const exists = await branchExists(opts.repoPath, opts.branchName);
      const validName = await validateBranchName(opts.branchName);
      if (!validName) {
        throw new Error(`Invalid branch name: "${opts.branchName}"`);
      }
      if (exists) {
        throw new Error(`Branch "${opts.branchName}" already exists`);
      }
    }

    logger.info(`Creating session: branch=${opts.branchName}, repo=${opts.repoPath}, useExisting=${!!opts.useExisting}`);

    // Generate a stable ID up front so the renderer can open a tab immediately
    const id = crypto.randomUUID().slice(0, 8);
    const branch = opts.branchName;

    // Helper to emit agent events before the session object exists.
    // Events are buffered so history replay can show them even if the
    // renderer subscribes after they were sent.
    prelaunchEvents.set(id, []);
    const emitPrelaunch = (evt: import('../shared/types.js').AgentEvent) => {
      prelaunchEvents.get(id)?.push(evt);
      if (!win.isDestroyed()) {
        win.webContents.send(`${IPC.AGENT_EVENT}:${id}`, evt);
      }
    };

    // Return fast — the dialog can close and a tab can open
    // Run the heavy work (worktree, npm install, agent start) in the background
    const setupPromise = (async () => {
      try {
        emitPrelaunch({ type: 'status', message: 'Creating worktree…' });

        const worktree = await worktreeManager.create({
          repoPath: opts.repoPath,
          branchName: opts.branchName,
          baseBranch: opts.baseBranch,
          useExisting: opts.useExisting,
          id,
          adapterType: opts.adapterType,
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

        // Install npm dependencies if enabled and the project has a package.json
        if (settings.getSettings().autoInstallDeps) {
          try {
            await fs.access(path.join(worktree.path, 'package.json'));
            if (!win.isDestroyed()) {
              win.webContents.send(IPC.SESSION_STATUS, worktree.id, 'installing');
            }

            // Run npm install with shared cache
            const npmCache = await worktreeManager.getNpmCachePath(opts.repoPath);
            emitPrelaunch({ type: 'status', message: 'Installing dependencies…' });
            logger.info(`Running npm install in worktree ${worktree.id} (cache: ${npmCache})`);
            await execa('npm', ['install', '--prefer-offline', '--cache', npmCache], { cwd: worktree.path });
            logger.info(`npm install completed for worktree ${worktree.id}`);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
              const stderr = (e as any).stderr || (e as any).message || String(e);
              logger.warn(`npm install failed for worktree ${worktree.id}:`, e);
              emitPrelaunch({ type: 'error', message: `npm install failed:\n${stderr}` });
            }
          }
        }

        // Start agent in the worktree
        emitPrelaunch({ type: 'status', message: 'Starting agent…' });
        await sessionManager.createSession({
          id: worktree.id,
          branch: worktree.branch,
          cwd: worktree.path,
          repoPath: opts.repoPath,
          window: win,
          adapterType: opts.adapterType,
        });

        logger.info(`Session created: id=${worktree.id}`);
      } catch (err: any) {
        const msg = err.message || String(err);
        logger.error(`Session setup failed for ${id}:`, msg);
        emitPrelaunch({ type: 'error', message: msg });
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.SESSION_STATUS, id, 'error');
        }
      } finally {
        // Clean up prelaunch buffer — events are now in the session's
        // own eventHistory or no longer needed.
        prelaunchEvents.delete(id);
      }
    })();

    // Don't await — let it run in the background
    setupPromise.catch(() => {}); // prevent unhandled rejection

    return { id, branch };
  });

  ipcMain.handle(IPC.SESSION_RESUME, async (event, id: string, repoPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window found');

    // If already running, just reattach the window so events flow to new webContents
    if (sessionManager.getSession(id)) {
      const s = sessionManager.getSession(id)!;
      sessionManager.reattachWindow(id, win);
      return { id: s.id, branch: s.branch };
    }

    const worktree = await worktreeManager.getWorktreeOrManifest(id);
    if (!worktree) {
      throw new Error(`Worktree ${id} not found`);
    }

    // Look up saved provider session ID for conversation resumption
    const providerSessionId = await worktreeManager.getProviderSessionId(id);
    logger.info(`Resuming session: id=${id}, branch=${worktree.branch}, providerSession=${providerSessionId ?? 'none'}`);

    const session = await sessionManager.createSession({
      id: worktree.id,
      branch: worktree.branch,
      cwd: worktree.path,
      repoPath,
      window: win,
      resumeSessionId: providerSessionId,
    });

    logger.info(`Session resumed: id=${session.id}`);
    return { id: session.id, branch: session.branch };
  });

  ipcMain.handle(IPC.SESSION_STOP, async (_event, id: string) => {
    logger.info(`Stopping session query (keeping session alive): id=${id}`);
    await sessionManager.stopQuery(id);
    logger.info(`Session query stopped, ready for follow-up: id=${id}`);
  });

  ipcMain.handle(IPC.SESSION_DESTROY, async (_event, id: string, deleteBranch = false) => {
    logger.info(`Destroying session: id=${id}, deleteBranch=${deleteBranch}`);
    await terminalManager.killAllForSession(id);
    await sessionManager.destroySession(id); // includes 500ms Windows handle-release delay
    await worktreeManager.remove(id, deleteBranch);
    logger.info(`Session destroyed: id=${id}`);
  });

  ipcMain.handle(IPC.SESSION_LIST, async (): Promise<SessionInfo[]> => {
    return sessionManager.listSessions();
  });

  // ─── Session rename ───

  ipcMain.handle(IPC.SESSION_RENAME, async (_event, sessionId: string, displayName: string) => {
    sessionManager.renameSession(sessionId, displayName);
  });

  // ─── Branches ───

  ipcMain.handle(IPC.BRANCH_LIST, async (_event, repoPath: string) => {
    return listBranches(repoPath);
  });

  ipcMain.handle(IPC.BRANCH_RENAME, async (_event, sessionId: string, newBranchName: string) => {
    const newName = await worktreeManager.renameBranch(sessionId, newBranchName);
    sessionManager.renameBranch(sessionId, newName);
    return { branch: newName };
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

  ipcMain.on(IPC.AGENT_SEND, (event, sessionId: string, content: string, images?: import('../shared/types.js').ImageAttachment[]) => {
    const ok = sessionManager.sendMessage(sessionId, content, images);
    if (!ok) {
      // Session is dead — notify renderer so it doesn't stay stuck in "Writing message"
      const channel = `${IPC.AGENT_EVENT}:${sessionId}`;
      event.sender.send(channel, { type: 'process_exit' } as import('../shared/types.js').AgentEvent);
    }
  });

  ipcMain.handle(IPC.AGENT_SET_MODE, (_event, sessionId: string, mode: string) => {
    sessionManager.setMode(sessionId, mode);
  });

  ipcMain.handle(IPC.AGENT_SET_MODEL, (_event, sessionId: string, model?: string) => {
    return sessionManager.setModel(sessionId, model);
  });

  ipcMain.handle(IPC.AGENT_SET_THINKING, (_event, sessionId: string, enabled: boolean) => {
    return sessionManager.setThinking(sessionId, enabled);
  });

  ipcMain.handle(IPC.AGENT_PERMISSION, (_event, sessionId: string, decision: PermissionDecision) => {
    return sessionManager.respondToPermission(sessionId, decision);
  });

  ipcMain.handle(IPC.AGENT_HISTORY, (_event, sessionId: string) => {
    const prelaunch = prelaunchEvents.get(sessionId) ?? [];
    const history = sessionManager.getEventHistory(sessionId);
    // Prepend prelaunch events (worktree/install status) that aren't in the
    // session's own history — they were emitted before the session existed.
    return prelaunch.length > 0 ? [...prelaunch, ...history] : history;
  });

  ipcMain.handle(IPC.AGENT_CLEAR_HISTORY, (_event, sessionId: string) => {
    sessionManager.clearEventHistory(sessionId);
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

  ipcMain.handle(IPC.OPEN_SESSION_FOLDER, async (_event, sessionId: string) => {
    const session = sessionManager.getSession(sessionId);
    if (session) {
      await shell.openPath(session.worktreePath);
      return;
    }
    const wt = await worktreeManager.getWorktreeOrManifest(sessionId);
    if (wt) {
      await shell.openPath(wt.path);
      return;
    }
    throw new Error('Session not found');
  });

  ipcMain.handle(IPC.KILL_PORT, async (_event, port: number) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Invalid port number');
    }
    return killProcessOnPort(port);
  });

  // ─── Dev Server ───

  ipcMain.handle(IPC.DEV_SERVER_START, async (_event, sessionId: string, command?: string) => {
    return sessionManager.startDevServer(sessionId, command || undefined);
  });

  ipcMain.handle(IPC.DEV_SERVER_STOP, async (_event, sessionId: string) => {
    return sessionManager.stopDevServer(sessionId);
  });

  // ─── File revert & diff (for changes review panel) ───

  ipcMain.handle(IPC.FILE_REVERT, async (_event, sessionId: string, filePath: string, staged?: boolean) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    // Sanitize: strip Docker container paths (/workspace/...) and make relative
    let relPath = filePath.replace(/^\/workspace\//, '');
    const normalWt = path.normalize(worktree.path) + path.sep;
    if (path.normalize(relPath).startsWith(normalWt)) {
      relPath = path.relative(worktree.path, relPath);
    }
    const resolved = path.resolve(worktree.path, relPath);
    if (!path.normalize(resolved).startsWith(normalWt)) {
      throw new Error('Path traversal not allowed');
    }
    // Check if the file is untracked (git checkout won't work for untracked files)
    const statusRaw = await git(['status', '--porcelain', '--', relPath], worktree.path);
    const isUntracked = statusRaw.trimStart().startsWith('??');

    if (isUntracked) {
      // Delete untracked file
      await fs.rm(resolved, { force: true, recursive: true });
    } else if (staged) {
      // Reset both index and working tree for staged files
      await git(['checkout', 'HEAD', '--', relPath], worktree.path);
    } else {
      await git(['checkout', '--', relPath], worktree.path);
    }
  });

  ipcMain.handle(IPC.FILE_DIFF, async (_event, sessionId: string, filePath: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    // Sanitize: strip Docker container paths (/workspace/...) and make relative
    let relPath = filePath.replace(/^\/workspace\//, '');
    // Also strip the host worktree prefix if it's an absolute path
    const normalWt = path.normalize(worktree.path) + path.sep;
    if (path.normalize(relPath).startsWith(normalWt)) {
      relPath = path.relative(worktree.path, relPath);
    }
    const resolved = path.resolve(worktree.path, relPath);
    if (!path.normalize(resolved).startsWith(normalWt)) {
      throw new Error('Path traversal not allowed');
    }
    // Get unified diff of this file vs HEAD
    try {
      const diff = await git(['diff', 'HEAD', '--', relPath], worktree.path);
      if (diff) return diff;
      // If empty diff, file may be untracked — synthesize an all-add diff
      const content = await fs.readFile(resolved, 'utf-8');
      if (content) {
        const lines = content.split('\n');
        const header = `--- /dev/null\n+++ b/${relPath.replace(/\\/g, '/')}\n@@ -0,0 +1,${lines.length} @@\n`;
        return header + lines.map(l => `+${l}`).join('\n');
      }
      return '';
    } catch {
      // File may be untracked (new file) — try to read and synthesize diff
      try {
        const content = await fs.readFile(resolved, 'utf-8');
        const lines = content.split('\n');
        const header = `--- /dev/null\n+++ b/${relPath.replace(/\\/g, '/')}\n@@ -0,0 +1,${lines.length} @@\n`;
        return header + lines.map(l => `+${l}`).join('\n');
      } catch {
        return '';
      }
    }
  });

  // ─── Git status ───

  ipcMain.handle(IPC.GIT_STATUS, async (_event, sessionId: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) return { entries: [] };

    try {
      const raw = await git(['status', '--porcelain=v1', '-z'], worktree.path);
      return parseGitStatusPorcelain(raw);
    } catch (e) {
      logger.warn(`git status failed for session ${sessionId}:`, e);
      return { entries: [] };
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

  /** Resolve adapter by optional type, falling back to registry default. */
  function resolveAdapter(adapterType?: string) {
    return adapterType ? (adapterRegistry.get(adapterType) ?? adapterRegistry.getDefault()) : adapterRegistry.getDefault();
  }

  ipcMain.handle(IPC.PLUGIN_LIST, async (_event, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType);
    if (!adapter.capabilities.plugins || !adapter.listPlugins) {
      return { installed: [], available: [] };
    }
    try {
      return await adapter.listPlugins();
    } catch (e: any) {
      logger.warn('Failed to list plugins:', e.message);
      return { installed: [], available: [] };
    }
  });

  ipcMain.handle(IPC.PLUGIN_INSTALL, async (_event, pluginId: string, scope = 'user', adapterType?: string) => {
    const adapter = resolveAdapter(adapterType);
    if (!adapter.installPlugin) throw new Error(`Adapter "${adapter.id}" does not support plugins`);
    await adapter.installPlugin(pluginId, scope);
  });

  ipcMain.handle(IPC.PLUGIN_UNINSTALL, async (_event, pluginId: string, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType);
    if (!adapter.uninstallPlugin) throw new Error(`Adapter "${adapter.id}" does not support plugins`);
    await adapter.uninstallPlugin(pluginId);
  });

  ipcMain.handle(IPC.PLUGIN_ENABLE, async (_event, pluginId: string, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType);
    if (!adapter.enablePlugin) throw new Error(`Adapter "${adapter.id}" does not support plugins`);
    await adapter.enablePlugin(pluginId);
  });

  ipcMain.handle(IPC.PLUGIN_DISABLE, async (_event, pluginId: string, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType);
    if (!adapter.disablePlugin) throw new Error(`Adapter "${adapter.id}" does not support plugins`);
    await adapter.disablePlugin(pluginId);
  });

  // ─── PTY Terminal (per-session persistent shell) ───

  ipcMain.handle(IPC.PTY_SPAWN, (event, sessionId: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) {
      // Worktree may not exist yet (still being created in background).
      // Return false so the renderer can retry later instead of showing an error.
      logger.debug(`[PTY_SPAWN] Worktree not ready for session ${sessionId}`);
      return false;
    }
    return terminalManager.spawnPty(sessionId, worktree.path, event.sender);
  });

  ipcMain.on(IPC.PTY_WRITE, (_event, sessionId: string, data: string) => {
    terminalManager.write(sessionId, data);
  });

  ipcMain.on(IPC.PTY_RESIZE, (_event, sessionId: string, cols: number, rows: number) => {
    terminalManager.resize(sessionId, cols, rows);
  });

  ipcMain.handle(IPC.PTY_KILL, (_event, sessionId: string) => {
    terminalManager.killPty(sessionId);
  });

  ipcMain.handle(IPC.PTY_IS_ALIVE, (_event, sessionId: string) => {
    return terminalManager.isAlive(sessionId);
  });

  // ─── Agent Adapters ───

  ipcMain.handle(IPC.AGENT_LIST_ADAPTERS, () => {
    return adapterRegistry.list().map(a => ({
      id: a.id,
      displayName: a.displayName,
      capabilities: { ...a.capabilities },
    }));
  });

  ipcMain.handle(IPC.AGENT_GET_MODELS, (_event, adapterType?: string) => {
    const adapter = adapterType
      ? adapterRegistry.get(adapterType)
      : adapterRegistry.getDefault();
    if (!adapter) return [];
    return adapter.getModels();
  });

  // ─── Memory ───

  ipcMain.handle(IPC.MEMORY_LIST, (_event, repoPath: string) => {
    return memory.listMemoryFiles(repoPath);
  });

  ipcMain.handle(IPC.MEMORY_READ, (_event, repoPath: string, relativePath: string) => {
    return memory.readMemoryFile(repoPath, relativePath);
  });

  ipcMain.handle(IPC.MEMORY_WRITE, (_event, repoPath: string, relativePath: string, content: string) => {
    memory.writeMemoryFile(repoPath, relativePath, content);
  });

  ipcMain.handle(IPC.MEMORY_DELETE, (_event, repoPath: string, relativePath: string) => {
    return memory.deleteMemoryFile(repoPath, relativePath);
  });

  // ─── Shell / Terminal ───

  ipcMain.handle(IPC.SHELL_RUN, (event, sessionId: string, command: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    return terminalManager.spawnCommand(sessionId, command, worktree.path, event.sender);
  });

  ipcMain.handle(IPC.SHELL_KILL, (_event, execId: string) => {
    terminalManager.killExecution(execId);
  });

  ipcMain.on(IPC.SHELL_INPUT, (_event, execId: string, data: string) => {
    terminalManager.sendInput(execId, data);
  });

  // ─── Settings ───

  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return settings.getSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SAVE, (event, data: import('../shared/types.js').GroveBenchSettings) => {
    settings.saveSettings(data);
    const win = BrowserWindow.fromWebContents(event.sender);
    settings.applyImmediateEffects(win, data);
  });

  // ─── App State ───

  ipcMain.handle(IPC.APP_STATE_GET_ACTIVE_TAB, () => {
    return loadAppState().activeTabId;
  });

  ipcMain.on(IPC.APP_STATE_SET_ACTIVE_TAB, (_event, id: string | null) => {
    saveActiveTab(id);
  });

  ipcMain.handle(IPC.APP_STATE_GET_OPEN_TABS, () => {
    return loadAppState().openTabIds;
  });

  ipcMain.on(IPC.APP_STATE_SET_OPEN_TABS, (_event, ids: string[]) => {
    saveOpenTabs(ids);
  });

  // ─── Window controls ───

  ipcMain.on(IPC.WIN_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(IPC.WIN_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize();
    }
  });

  ipcMain.on(IPC.WIN_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(IPC.WIN_IS_MAXIMIZED, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
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

  // ─── Auto-updater ───

  ipcMain.handle(IPC.UPDATE_CHECK, () => checkForUpdate());
  ipcMain.handle(IPC.UPDATE_DOWNLOAD, () => downloadUpdate());
  ipcMain.on(IPC.UPDATE_INSTALL, () => installUpdate());
}
