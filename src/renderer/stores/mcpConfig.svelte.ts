import type { McpConfiguredServer, McpAddServerOpts, McpConfigScope } from '../../shared/types.js';

const STALE_BRIDGE_ERROR =
  'MCP configuration is unavailable in this running build — restart Grove Bench to enable it.';

/** The preload bridge is frozen at window load, so a hot-reloaded renderer can be newer than it. */
function bridgeHas(fn: 'mcpConfigList' | 'mcpConfigAdd' | 'mcpConfigRemove'): boolean {
  return typeof (window.groveBench as Record<string, unknown> | undefined)?.[fn] === 'function';
}

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
    if (!bridgeHas('mcpConfigList')) {
      this.error = STALE_BRIDGE_ERROR;
      return;
    }
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
    if (!bridgeHas('mcpConfigAdd')) {
      this.error = STALE_BRIDGE_ERROR;
      return false;
    }
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
    if (!bridgeHas('mcpConfigRemove')) {
      this.error = STALE_BRIDGE_ERROR;
      return;
    }
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
