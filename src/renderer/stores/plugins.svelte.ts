import type { InstalledPlugin, AvailablePlugin } from '../../shared/types.js';

class PluginStore {
  installed = $state<InstalledPlugin[]>([]);
  available = $state<AvailablePlugin[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  actionInProgress = $state<string | null>(null); // plugin id currently being acted on

  async refresh() {
    this.loading = true;
    this.error = null;
    try {
      const result = await window.groveBench.pluginList();
      this.installed = result.installed;
      this.available = result.available;
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.loading = false;
    }
  }

  async install(pluginId: string, scope = 'user') {
    this.actionInProgress = pluginId;
    this.error = null;
    try {
      await window.groveBench.pluginInstall(pluginId, scope);
      await this.refresh();
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.actionInProgress = null;
    }
  }

  async uninstall(pluginId: string) {
    this.actionInProgress = pluginId;
    this.error = null;
    try {
      await window.groveBench.pluginUninstall(pluginId);
      await this.refresh();
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.actionInProgress = null;
    }
  }

  async enable(pluginId: string) {
    this.actionInProgress = pluginId;
    this.error = null;
    try {
      await window.groveBench.pluginEnable(pluginId);
      await this.refresh();
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.actionInProgress = null;
    }
  }

  async disable(pluginId: string) {
    this.actionInProgress = pluginId;
    this.error = null;
    try {
      await window.groveBench.pluginDisable(pluginId);
      await this.refresh();
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.actionInProgress = null;
    }
  }

  isInstalled(pluginId: string): boolean {
    return this.installed.some((p) => p.id === pluginId);
  }
}

export const pluginStore = new PluginStore();
