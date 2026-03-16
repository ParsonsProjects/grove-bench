import { contextBridge, ipcRenderer } from 'electron';
import type { GroveBenchAPI, CreateSessionOpts, PermissionDecision, OrchCreateOpts, OrchTask } from '../shared/types.js';
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
    ipcRenderer.send(IPC.AGENT_PERMISSION, sessionId, decision),
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
  revertFile: (sessionId: string, filePath: string) =>
    ipcRenderer.invoke(IPC.FILE_REVERT, sessionId, filePath),
  getFileDiff: (sessionId: string, filePath: string) =>
    ipcRenderer.invoke(IPC.FILE_DIFF, sessionId, filePath),

  // PR info
  getPrInfo: (sessionId: string) => ipcRenderer.invoke(IPC.PR_INFO, sessionId),

  // External links
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),

  // Localhost process cleanup
  killPort: (port: number) => ipcRenderer.invoke(IPC.KILL_PORT, port),

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

  // Docker
  checkDocker: () => ipcRenderer.invoke(IPC.DOCKER_CHECK),
  saveDockerToken: (token: string) => ipcRenderer.invoke(IPC.DOCKER_SAVE_TOKEN, token),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  saveSettings: (s: import('../shared/types.js').GroveBenchSettings) =>
    ipcRenderer.invoke(IPC.SETTINGS_SAVE, s),

  // Orchestration
  createOrchJob: (opts: OrchCreateOpts) =>
    ipcRenderer.invoke(IPC.ORCH_CREATE, opts),
  approveOrchPlan: (jobId: string, editedTasks?: Partial<OrchTask>[]) =>
    ipcRenderer.invoke(IPC.ORCH_APPROVE, jobId, editedTasks),
  cancelOrchJob: (jobId: string) =>
    ipcRenderer.invoke(IPC.ORCH_CANCEL, jobId),
  removeOrchJob: (jobId: string) =>
    ipcRenderer.invoke(IPC.ORCH_REMOVE, jobId),
  listOrchJobs: () =>
    ipcRenderer.invoke(IPC.ORCH_LIST),
  retryOrchTask: (jobId: string, taskId: string) =>
    ipcRenderer.invoke(IPC.ORCH_RETRY_TASK, jobId, taskId),
  retryAllOrchTasks: (jobId: string) =>
    ipcRenderer.invoke(IPC.ORCH_RETRY_ALL, jobId),
  mergeOrchJob: (jobId: string) =>
    ipcRenderer.invoke(IPC.ORCH_MERGE, jobId),
  resolveOrchConflict: (jobId: string, taskId: string) =>
    ipcRenderer.invoke(IPC.ORCH_RESOLVE_CONFLICT, jobId, taskId),
  onOrchEvent: (jobId: string, callback: (event: import('../shared/types.js').OrchEvent) => void) => {
    const channel = `${IPC.ORCH_EVENT}:${jobId}`;
    const handler = (_event: Electron.IpcRendererEvent, data: import('../shared/types.js').OrchEvent) =>
      callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  offOrchEvent: (jobId: string) => {
    ipcRenderer.removeAllListeners(`${IPC.ORCH_EVENT}:${jobId}`);
  },

  // App lifecycle
  onAppClosing: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.APP_CLOSING, handler);
    return () => {
      ipcRenderer.removeListener(IPC.APP_CLOSING, handler);
    };
  },

  // Window controls
  winMinimize: () => ipcRenderer.send(IPC.WIN_MINIMIZE),
  winMaximize: () => ipcRenderer.send(IPC.WIN_MAXIMIZE),
  winClose: () => ipcRenderer.send(IPC.WIN_CLOSE),
  winIsMaximized: () => ipcRenderer.invoke(IPC.WIN_IS_MAXIMIZED),
};

contextBridge.exposeInMainWorld('groveBench', api);
