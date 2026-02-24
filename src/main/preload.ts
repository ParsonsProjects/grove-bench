import { contextBridge, ipcRenderer } from 'electron';
import type { GroveBenchAPI, CreateSessionOpts } from '../shared/types.js';
import { IPC } from '../shared/types.js';

const api: GroveBenchAPI = {
  // Repo operations
  addRepo: () => ipcRenderer.invoke(IPC.REPO_SELECT),
  removeRepo: (repoPath: string) => ipcRenderer.invoke(IPC.REPO_REMOVE, repoPath),
  validateRepo: (path: string) => ipcRenderer.invoke(IPC.REPO_VALIDATE, path),

  // Session operations
  createSession: (opts: CreateSessionOpts) =>
    ipcRenderer.invoke(IPC.SESSION_CREATE, opts),
  destroySession: (id: string, deleteBranch?: boolean) =>
    ipcRenderer.invoke(IPC.SESSION_DESTROY, id, deleteBranch),
  listSessions: () => ipcRenderer.invoke(IPC.SESSION_LIST),

  // Worktree operations
  listWorktrees: (repoPath: string) => ipcRenderer.invoke(IPC.WORKTREE_LIST, repoPath),

  // Branch operations
  listBranches: (repoPath: string) => ipcRenderer.invoke(IPC.BRANCH_LIST, repoPath),

  // Terminal I/O
  termWrite: (sessionId: string, data: string) =>
    ipcRenderer.send(IPC.TERM_WRITE, sessionId, data),
  termResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send(IPC.TERM_RESIZE, sessionId, cols, rows),
  onTermData: (sessionId: string, callback: (data: string) => void) => {
    const channel = `${IPC.TERM_DATA}:${sessionId}`;
    const handler = (_event: Electron.IpcRendererEvent, data: string) =>
      callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  offTermData: (sessionId: string) => {
    ipcRenderer.removeAllListeners(`${IPC.TERM_DATA}:${sessionId}`);
  },

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
