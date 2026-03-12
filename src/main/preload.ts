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
  listSessions: () => ipcRenderer.invoke(IPC.SESSION_LIST),

  // Worktree operations
  listWorktrees: (repoPath: string) => ipcRenderer.invoke(IPC.WORKTREE_LIST, repoPath),

  // Branch operations
  listBranches: (repoPath: string) => ipcRenderer.invoke(IPC.BRANCH_LIST, repoPath),

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

  // App lifecycle
  onAppClosing: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.APP_CLOSING, handler);
    return () => {
      ipcRenderer.removeListener(IPC.APP_CLOSING, handler);
    };
  },
};

contextBridge.exposeInMainWorld('groveBench', api);
