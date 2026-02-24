import { contextBridge, ipcRenderer } from 'electron';
import type { GroveBenchAPI, CreateSessionOpts, ClaudeEvent, PermissionRequest, SessionStatus } from '../shared/types.js';
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

  // Chat I/O
  sendMessage: (sessionId: string, message: string) =>
    ipcRenderer.invoke(IPC.SEND_MESSAGE, sessionId, message),

  onClaudeEvent: (sessionId: string, callback: (event: ClaudeEvent) => void) => {
    const channel = `${IPC.CLAUDE_EVENT}:${sessionId}`;
    const handler = (_event: Electron.IpcRendererEvent, event: ClaudeEvent) =>
      callback(event);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  offClaudeEvent: (sessionId: string) => {
    ipcRenderer.removeAllListeners(`${IPC.CLAUDE_EVENT}:${sessionId}`);
  },

  // Permission handling
  respondPermission: (requestId: string, allowed: boolean) => {
    ipcRenderer.send(IPC.PERMISSION_RESPONSE, requestId, allowed);
  },

  onPermissionRequest: (callback: (request: PermissionRequest) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: PermissionRequest) =>
      callback(request);
    ipcRenderer.on(IPC.PERMISSION_REQUEST, handler);
    return () => {
      ipcRenderer.removeListener(IPC.PERMISSION_REQUEST, handler);
    };
  },

  // Prerequisites
  checkPrerequisites: () => ipcRenderer.invoke(IPC.PREREQUISITES_CHECK),

  // Session status updates
  onSessionStatus: (callback: (sessionId: string, status: SessionStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, status: SessionStatus) =>
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
