import { vi } from 'vitest';

export const app = {
  getPath: vi.fn((name: string) => `/mock/${name}`),
  getVersion: vi.fn(() => '33.3.1'),
  getName: vi.fn(() => 'grove-bench'),
  isReady: vi.fn(() => true),
  on: vi.fn(),
  quit: vi.fn(),
};

export const BrowserWindow = vi.fn().mockImplementation(() => ({
  loadURL: vi.fn(),
  on: vi.fn(),
  show: vi.fn(),
  close: vi.fn(),
  isDestroyed: vi.fn(() => false),
  setAlwaysOnTop: vi.fn(),
  webContents: {
    send: vi.fn(),
    on: vi.fn(),
  },
}));

export const ipcMain = {
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
};

export const ipcRenderer = {
  invoke: vi.fn(),
  on: vi.fn(),
  send: vi.fn(),
  removeListener: vi.fn(),
};

export const dialog = {
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn(),
};

export const shell = {
  openExternal: vi.fn(),
};

export const nativeTheme = {
  themeSource: 'system' as string,
  shouldUseDarkColors: false,
  on: vi.fn(),
};

export const contextBridge = {
  exposeInMainWorld: vi.fn(),
};

export default {
  app,
  BrowserWindow,
  ipcMain,
  ipcRenderer,
  dialog,
  shell,
  nativeTheme,
  contextBridge,
};
