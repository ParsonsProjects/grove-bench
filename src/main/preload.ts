import { contextBridge, ipcRenderer } from 'electron';
import type { GroveBenchAPI, CreateSessionOpts, PermissionDecision } from '../shared/types.js';
import { IPC } from '../shared/types.js';

const api: GroveBenchAPI = {
  // Repo operations
  addRepo: () => ipcRenderer.invoke(IPC.REPO_SELECT),
  removeRepo: (repoPath: string) => ipcRenderer.invoke(IPC.REPO_REMOVE, repoPath),
  validateRepo: (path: string) => ipcRenderer.invoke(IPC.REPO_VALIDATE, path),

  // Session operations
  createSession: (opts: CreateSessionOpts) =>
    ipcRenderer.invoke(IPC.SESSION_CREATE, opts),
  resumeSession: (id: string, repoPath: string) =>
    ipcRenderer.invoke(IPC.SESSION_RESUME, id, repoPath),
  stopSession: (id: string) =>
    ipcRenderer.invoke(IPC.SESSION_STOP, id),
  destroySession: (id: string, deleteBranch?: boolean) =>
    ipcRenderer.invoke(IPC.SESSION_DESTROY, id, deleteBranch),
  renameSession: (sessionId: string, displayName: string) =>
    ipcRenderer.invoke(IPC.SESSION_RENAME, sessionId, displayName),
  listSessions: () => ipcRenderer.invoke(IPC.SESSION_LIST),

  // Worktree operations
  listWorktrees: (repoPath: string) => ipcRenderer.invoke(IPC.WORKTREE_LIST, repoPath),

  // Branch operations
  listBranches: (repoPath: string) => ipcRenderer.invoke(IPC.BRANCH_LIST, repoPath),
  renameBranch: (sessionId: string, newBranchName: string) =>
    ipcRenderer.invoke(IPC.BRANCH_RENAME, sessionId, newBranchName),

  // Agent I/O
  sendMessage: (sessionId: string, content: string, images?: import('../shared/types.js').ImageAttachment[]) =>
    ipcRenderer.send(IPC.AGENT_SEND, sessionId, content, images),
  respondToPermission: (sessionId: string, decision: PermissionDecision) =>
    ipcRenderer.invoke(IPC.AGENT_PERMISSION, sessionId, decision),
  onAgentEvent: (sessionId: string, callback: (event: import('../shared/types.js').AgentEvent) => void) => {
    const channel = `${IPC.AGENT_EVENT}:${sessionId}`;
    const handler = (_event: Electron.IpcRendererEvent, data: import('../shared/types.js').AgentEvent) =>
      callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  offAgentEvent: (sessionId: string) => {
    ipcRenderer.removeAllListeners(`${IPC.AGENT_EVENT}:${sessionId}`);
  },
  getEventHistory: (sessionId: string) =>
    ipcRenderer.invoke(IPC.AGENT_HISTORY, sessionId),
  clearEventHistory: (sessionId: string) =>
    ipcRenderer.invoke(IPC.AGENT_CLEAR_HISTORY, sessionId),

  // Mode control
  setMode: (sessionId: string, mode: string) =>
    ipcRenderer.invoke(IPC.AGENT_SET_MODE, sessionId, mode),

  // Model control
  setModel: (sessionId: string, model?: string) =>
    ipcRenderer.invoke(IPC.AGENT_SET_MODEL, sessionId, model),

  // Thinking control
  setThinking: (sessionId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.AGENT_SET_THINKING, sessionId, enabled),

  // File operations (for @ file picker)
  listFiles: (sessionId: string) => ipcRenderer.invoke(IPC.FILE_LIST, sessionId),
  readFile: (sessionId: string, filePath: string) => ipcRenderer.invoke(IPC.FILE_READ, sessionId, filePath),
  openInEditor: (sessionId: string, filePath: string, line?: number) =>
    ipcRenderer.invoke(IPC.FILE_OPEN_IN_EDITOR, sessionId, filePath, line),

  // File revert & diff (for changes review)
  revertFile: (sessionId: string, filePath: string, staged?: boolean) =>
    ipcRenderer.invoke(IPC.FILE_REVERT, sessionId, filePath, staged),
  getFileDiff: (sessionId: string, filePath: string) =>
    ipcRenderer.invoke(IPC.FILE_DIFF, sessionId, filePath),

  // Checkpoint rewind
  rewindSession: (sessionId: string, userMessageId: string, options?: { conversationOnly?: boolean }) =>
    ipcRenderer.invoke(IPC.AGENT_REWIND, sessionId, userMessageId, options),
  getCheckpointDiff: (sessionId: string, userMessageId: string) =>
    ipcRenderer.invoke(IPC.AGENT_CHECKPOINT_DIFF, sessionId, userMessageId),

  // Git status
  getGitStatus: (sessionId: string) =>
    ipcRenderer.invoke(IPC.GIT_STATUS, sessionId),

  // PR info
  getPrInfo: (sessionId: string) => ipcRenderer.invoke(IPC.PR_INFO, sessionId),

  // External links
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),

  // Localhost process cleanup
  killPort: (port: number) => ipcRenderer.invoke(IPC.KILL_PORT, port),

  // Dev server
  startDevServer: (sessionId: string, command?: string) =>
    ipcRenderer.invoke(IPC.DEV_SERVER_START, sessionId, command),
  stopDevServer: (sessionId: string) =>
    ipcRenderer.invoke(IPC.DEV_SERVER_STOP, sessionId),

  // Plugins
  pluginList: () => ipcRenderer.invoke(IPC.PLUGIN_LIST),
  pluginInstall: (pluginId: string, scope?: string) =>
    ipcRenderer.invoke(IPC.PLUGIN_INSTALL, pluginId, scope),
  pluginUninstall: (pluginId: string) => ipcRenderer.invoke(IPC.PLUGIN_UNINSTALL, pluginId),
  pluginEnable: (pluginId: string) => ipcRenderer.invoke(IPC.PLUGIN_ENABLE, pluginId),
  pluginDisable: (pluginId: string) => ipcRenderer.invoke(IPC.PLUGIN_DISABLE, pluginId),

  // Prerequisites
  checkPrerequisites: () => ipcRenderer.invoke(IPC.PREREQUISITES_CHECK),

  // Session status updates
  onSessionStatus: (callback: (sessionId: string, status: import('../shared/types.js').SessionStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, status: import('../shared/types.js').SessionStatus) =>
      callback(sessionId, status);
    ipcRenderer.on(IPC.SESSION_STATUS, handler);
    return () => {
      ipcRenderer.removeListener(IPC.SESSION_STATUS, handler);
    };
  },

  // Folder
  openSessionFolder: (sessionId: string) =>
    ipcRenderer.invoke(IPC.OPEN_SESSION_FOLDER, sessionId),

  // Memory
  memoryList: (repoPath: string) => ipcRenderer.invoke(IPC.MEMORY_LIST, repoPath),
  memoryRead: (repoPath: string, relativePath: string) =>
    ipcRenderer.invoke(IPC.MEMORY_READ, repoPath, relativePath),
  memoryWrite: (repoPath: string, relativePath: string, content: string) =>
    ipcRenderer.invoke(IPC.MEMORY_WRITE, repoPath, relativePath, content),
  memoryDelete: (repoPath: string, relativePath: string) =>
    ipcRenderer.invoke(IPC.MEMORY_DELETE, repoPath, relativePath),

  // PTY Terminal (per-session persistent shell)
  ptySpawn: (sessionId: string) =>
    ipcRenderer.invoke(IPC.PTY_SPAWN, sessionId),
  ptyWrite: (sessionId: string, data: string) =>
    ipcRenderer.send(IPC.PTY_WRITE, sessionId, data),
  ptyResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send(IPC.PTY_RESIZE, sessionId, cols, rows),
  ptyKill: (sessionId: string) =>
    ipcRenderer.invoke(IPC.PTY_KILL, sessionId),
  ptyIsAlive: (sessionId: string) =>
    ipcRenderer.invoke(IPC.PTY_IS_ALIVE, sessionId),
  onPtyData: (sessionId: string, callback: (data: string) => void) => {
    const channel = `${IPC.PTY_DATA}:${sessionId}`;
    const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  onPtyExit: (sessionId: string, callback: (exitCode: number, signal?: number) => void) => {
    const channel = `${IPC.PTY_EXIT}:${sessionId}`;
    const handler = (_event: Electron.IpcRendererEvent, exitCode: number, signal?: number) =>
      callback(exitCode, signal);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  saveSettings: (s: import('../shared/types.js').GroveBenchSettings) =>
    ipcRenderer.invoke(IPC.SETTINGS_SAVE, s),

  // App state persistence
  getActiveTab: () => ipcRenderer.invoke(IPC.APP_STATE_GET_ACTIVE_TAB),
  setActiveTab: (id: string | null) => ipcRenderer.send(IPC.APP_STATE_SET_ACTIVE_TAB, id),
  getOpenTabs: () => ipcRenderer.invoke(IPC.APP_STATE_GET_OPEN_TABS) as Promise<string[]>,
  setOpenTabs: (ids: string[]) => ipcRenderer.send(IPC.APP_STATE_SET_OPEN_TABS, ids),

  // App lifecycle
  onAppClosing: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.APP_CLOSING, handler);
    return () => {
      ipcRenderer.removeListener(IPC.APP_CLOSING, handler);
    };
  },
  onPowerResume: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.POWER_RESUME, handler);
    return () => {
      ipcRenderer.removeListener(IPC.POWER_RESUME, handler);
    };
  },

  // Window controls
  winMinimize: () => ipcRenderer.send(IPC.WIN_MINIMIZE),
  winMaximize: () => ipcRenderer.send(IPC.WIN_MAXIMIZE),
  winClose: () => ipcRenderer.send(IPC.WIN_CLOSE),
  winIsMaximized: () => ipcRenderer.invoke(IPC.WIN_IS_MAXIMIZED),
};

contextBridge.exposeInMainWorld('groveBench', api);
