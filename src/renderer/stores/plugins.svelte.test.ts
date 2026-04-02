import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { pluginStore } from './plugins.svelte.js';
import type { InstalledPlugin, AvailablePlugin } from '../../shared/types.js';

function makeInstalledPlugin(id: string): InstalledPlugin {
  return { id, version: '1.0.0', scope: 'user', enabled: true, installPath: '/path', installedAt: '2026-01-01', lastUpdated: '2026-01-01' };
}

function makeAvailablePlugin(pluginId: string, name: string): AvailablePlugin {
  return { pluginId, name, description: '', marketplaceName: name, version: '1.0.0', source: 'npm', installCount: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  pluginStore.installed = [];
  pluginStore.available = [];
  pluginStore.loading = false;
  pluginStore.error = null;
  pluginStore.actionInProgress = null;
});

describe('PluginStore', () => {
  describe('refresh()', () => {
    it('fetches installed and available plugins', async () => {
      const installed = [makeInstalledPlugin('p1')];
      const available = [makeAvailablePlugin('p2', 'Plugin 2')];
      mockGroveBench.pluginList.mockResolvedValue({ installed, available });

      await pluginStore.refresh();

      expect(pluginStore.installed).toEqual(installed);
      expect(pluginStore.available).toEqual(available);
      expect(pluginStore.loading).toBe(false);
      expect(pluginStore.error).toBeNull();
    });

    it('sets loading during fetch', async () => {
      let resolvePromise: Function;
      mockGroveBench.pluginList.mockReturnValue(new Promise(r => { resolvePromise = r; }));

      const promise = pluginStore.refresh();
      expect(pluginStore.loading).toBe(true);

      resolvePromise!({ installed: [], available: [] });
      await promise;
      expect(pluginStore.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      mockGroveBench.pluginList.mockRejectedValue(new Error('network error'));

      await pluginStore.refresh();

      expect(pluginStore.error).toBe('network error');
      expect(pluginStore.loading).toBe(false);
    });
  });

  describe('install()', () => {
    it('calls pluginInstall and refreshes', async () => {
      mockGroveBench.pluginList.mockResolvedValue({ installed: [], available: [] });

      await pluginStore.install('p1', 'user');

      expect(mockGroveBench.pluginInstall).toHaveBeenCalledWith('p1', 'user');
      expect(mockGroveBench.pluginList).toHaveBeenCalled();
      expect(pluginStore.actionInProgress).toBeNull();
    });

    it('sets actionInProgress during install', async () => {
      let resolvePromise: Function;
      mockGroveBench.pluginInstall.mockReturnValue(new Promise(r => { resolvePromise = r; }));

      const promise = pluginStore.install('p1');
      expect(pluginStore.actionInProgress).toBe('p1');

      resolvePromise!();
      mockGroveBench.pluginList.mockResolvedValue({ installed: [], available: [] });
      await promise;
      expect(pluginStore.actionInProgress).toBeNull();
    });

    it('sets error on failure', async () => {
      mockGroveBench.pluginInstall.mockRejectedValue(new Error('install failed'));

      await pluginStore.install('p1');

      expect(pluginStore.error).toBe('install failed');
      expect(pluginStore.actionInProgress).toBeNull();
    });
  });

  describe('uninstall()', () => {
    it('calls pluginUninstall and refreshes', async () => {
      mockGroveBench.pluginList.mockResolvedValue({ installed: [], available: [] });

      await pluginStore.uninstall('p1');

      expect(mockGroveBench.pluginUninstall).toHaveBeenCalledWith('p1');
      expect(mockGroveBench.pluginList).toHaveBeenCalled();
    });

    it('sets error on failure', async () => {
      mockGroveBench.pluginUninstall.mockRejectedValue(new Error('uninstall failed'));

      await pluginStore.uninstall('p1');

      expect(pluginStore.error).toBe('uninstall failed');
    });
  });

  describe('enable()', () => {
    it('calls pluginEnable and refreshes', async () => {
      mockGroveBench.pluginList.mockResolvedValue({ installed: [], available: [] });

      await pluginStore.enable('p1');

      expect(mockGroveBench.pluginEnable).toHaveBeenCalledWith('p1');
      expect(mockGroveBench.pluginList).toHaveBeenCalled();
    });

    it('sets error on failure', async () => {
      mockGroveBench.pluginEnable.mockRejectedValue(new Error('enable failed'));

      await pluginStore.enable('p1');

      expect(pluginStore.error).toBe('enable failed');
    });
  });

  describe('disable()', () => {
    it('calls pluginDisable and refreshes', async () => {
      mockGroveBench.pluginList.mockResolvedValue({ installed: [], available: [] });

      await pluginStore.disable('p1');

      expect(mockGroveBench.pluginDisable).toHaveBeenCalledWith('p1');
      expect(mockGroveBench.pluginList).toHaveBeenCalled();
    });

    it('sets error on failure', async () => {
      mockGroveBench.pluginDisable.mockRejectedValue(new Error('disable failed'));

      await pluginStore.disable('p1');

      expect(pluginStore.error).toBe('disable failed');
    });
  });

  describe('isInstalled()', () => {
    it('returns true when plugin is installed', () => {
      pluginStore.installed = [makeInstalledPlugin('p1')];
      expect(pluginStore.isInstalled('p1')).toBe(true);
    });

    it('returns false when plugin is not installed', () => {
      pluginStore.installed = [makeInstalledPlugin('p1')];
      expect(pluginStore.isInstalled('p2')).toBe(false);
    });

    it('returns false when no plugins installed', () => {
      expect(pluginStore.isInstalled('p1')).toBe(false);
    });
  });
});
