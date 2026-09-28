import type { McpConfiguredServer, McpAddServerOpts, McpConfigScope } from '../../shared/types.js';

const STALE_BRIDGE_ERROR =
  'MCP configuration is unavailable in this running build — restart Grove Bench to enable it.';

/** The preload bridge is frozen at window load, so a hot-reloaded renderer can be newer than it. */
function bridgeHas(fn: 'mcpConfigList' | 'mcpConfigAdd' | 'mcpConfigRemove' | 'mcpConfigApprove'): boolean {
  return typeof window.groveBench?.[fn] === 'function';
}

/** Configured MCP servers from the agent CLI config (settings panel view). */
class McpConfigStore {
  servers = $state<McpConfiguredServer[]>([]);
  loading = $state(false);
  /** True once the first refresh has completed (empty list vs never loaded). */
  loaded = $state(false);
  error = $state<string | null>(null);
  /** Server name currently being added/removed/approved. */
  actionInProgress = $state<string | null>(null);
  /** What is being done to `actionInProgress`. */
  actionKind = $state<'add' | 'remove' | 'approve' | null>(null);
  /** Project the list was loaded for. Project and local servers only show
   *  for one project; undefined lists user-level servers only. */
  cwd = $state<string | undefined>(undefined);

  async refresh(cwd: string | undefined = this.cwd) {
    if (!bridgeHas('mcpConfigList')) {
      this.error = STALE_BRIDGE_ERROR;
      return;
    }
    this.cwd = cwd;
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
    this.actionKind = 'add';
    this.error = null;
    try {
      await window.groveBench.mcpConfigAdd(opts);
      await this.refresh();
      return true;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    } finally {
      this.actionInProgress = null;
      this.actionKind = null;
    }
  }

  async remove(name: string, scope?: McpConfigScope) {
    if (!bridgeHas('mcpConfigRemove')) {
      this.error = STALE_BRIDGE_ERROR;
      return;
    }
    this.actionInProgress = name;
    this.actionKind = 'remove';
    this.error = null;
    try {
      await window.groveBench.mcpConfigRemove(name, scope, this.cwd);
      await this.refresh();
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.actionInProgress = null;
      this.actionKind = null;
    }
  }

  /** Add several servers, refreshing once at the end (`claude mcp list` is
   *  slow). Stops at the first failure. Returns the names that were added. */
  async addMany(list: McpAddServerOpts[]): Promise<string[]> {
    if (!bridgeHas('mcpConfigAdd')) {
      this.error = STALE_BRIDGE_ERROR;
      return [];
    }
    this.error = null;
    const added: string[] = [];
    let error: string | null = null;
    try {
      for (const opts of list) {
        this.actionInProgress = opts.name;
        this.actionKind = 'add';
        await window.groveBench.mcpConfigAdd(opts);
        added.push(opts.name);
      }
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      this.actionInProgress = null;
      this.actionKind = null;
    }
    // refresh() clears the error, so set it after
    if (added.length > 0) await this.refresh();
    if (error) this.error = added.length > 0 ? `Added ${added.join(', ')}, then failed: ${error}` : error;
    return added;
  }

  /** Approve a project (.mcp.json) server for the listed project. */
  async approve(name: string) {
    if (!bridgeHas('mcpConfigApprove')) {
      this.error = STALE_BRIDGE_ERROR;
      return;
    }
    if (!this.cwd) return;
    this.actionInProgress = name;
    this.actionKind = 'approve';
    this.error = null;
    try {
      await window.groveBench.mcpConfigApprove(name, this.cwd);
      await this.refresh();
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.actionInProgress = null;
      this.actionKind = null;
    }
  }
}

export const mcpConfigStore = new McpConfigStore();
