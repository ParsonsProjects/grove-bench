import type { McpConfiguredServer, McpAddServerOpts, McpConfigScope } from '../../shared/types.js';

/** Configured MCP servers from the agent CLI config (settings panel view). */
class McpConfigStore {
  servers = $state<McpConfiguredServer[]>([]);
  loading = $state(false);
  /** True once the first refresh has completed (empty list vs never loaded). */
  loaded = $state(false);
  error = $state<string | null>(null);
  /** Server name currently being added/removed. */
  actionInProgress = $state<string | null>(null);

  async refresh(cwd?: string) {
    this.loading = true;
    this.error = null;
    try {
      this.servers = await window.groveBench.mcpConfigList(cwd);
      this.loaded = true;
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.loading = false;
    }
  }

  async add(opts: McpAddServerOpts) {
    this.actionInProgress = opts.name;
    this.error = null;
    try {
      await window.groveBench.mcpConfigAdd(opts);
      await this.refresh(opts.cwd);
      return true;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    } finally {
      this.actionInProgress = null;
    }
  }

  async remove(name: string, scope?: McpConfigScope, cwd?: string) {
    this.actionInProgress = name;
    this.error = null;
    try {
      await window.groveBench.mcpConfigRemove(name, scope, cwd);
      await this.refresh(cwd);
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.actionInProgress = null;
    }
  }
}

export const mcpConfigStore = new McpConfigStore();
