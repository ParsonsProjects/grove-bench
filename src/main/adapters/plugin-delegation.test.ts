import { describe, it, expect, vi } from 'vitest';
import type { AgentAdapter, AgentCapabilities, AdapterConfig, AgentQueryHandle, ModelInfo, AdapterPrerequisiteStatus } from './types.js';

/**
 * TDD tests for plugin delegation through the adapter layer.
 *
 * The adapter interface should expose optional plugin methods so that
 * IPC handlers delegate to the active adapter rather than hardcoding
 * `execa('claude', ['plugin', ...])`.
 */

// ─── Stub adapter with plugin support ───

class PluginCapableAdapter implements AgentAdapter {
  readonly id = 'plugin-test';
  readonly displayName = 'Plugin Test Adapter';
  readonly capabilities: AgentCapabilities = {
    permissions: false,
    permissionModes: false,
    resume: false,
    modelSwitching: false,
    thinking: false,
    plugins: true,
    imageAttachments: false,
    structuredOutput: false,
    sandbox: false,
  };

  // Track calls
  listPluginsCalled = false;
  installedPlugin: string | null = null;
  uninstalledPlugin: string | null = null;
  enabledPlugin: string | null = null;
  disabledPlugin: string | null = null;

  getModels(): ModelInfo[] { return []; }
  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> { return { available: true }; }
  async start(_config: AdapterConfig): Promise<AgentQueryHandle> { throw new Error('Not needed'); }

  async listPlugins() {
    this.listPluginsCalled = true;
    return { installed: [{ id: 'test-plugin', name: 'Test', enabled: true }], available: [] };
  }

  async installPlugin(pluginId: string, _scope?: string) {
    this.installedPlugin = pluginId;
  }

  async uninstallPlugin(pluginId: string) {
    this.uninstalledPlugin = pluginId;
  }

  async enablePlugin(pluginId: string) {
    this.enabledPlugin = pluginId;
  }

  async disablePlugin(pluginId: string) {
    this.disabledPlugin = pluginId;
  }
}

class NoPluginAdapter implements AgentAdapter {
  readonly id = 'no-plugin';
  readonly displayName = 'No Plugin Adapter';
  readonly capabilities: AgentCapabilities = {
    permissions: false,
    permissionModes: false,
    resume: false,
    modelSwitching: false,
    thinking: false,
    plugins: false,
    imageAttachments: false,
    structuredOutput: false,
    sandbox: false,
  };

  getModels(): ModelInfo[] { return []; }
  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> { return { available: true }; }
  async start(_config: AdapterConfig): Promise<AgentQueryHandle> { throw new Error('Not needed'); }
  // No plugin methods — adapter does not support plugins
}

// ─── Tests ───

describe('Plugin delegation through adapter', () => {
  it('plugin-capable adapter implements listPlugins', async () => {
    const adapter = new PluginCapableAdapter();
    expect(adapter.capabilities.plugins).toBe(true);
    expect(typeof adapter.listPlugins).toBe('function');

    const result = await adapter.listPlugins!();
    expect(adapter.listPluginsCalled).toBe(true);
    expect(result.installed).toHaveLength(1);
    expect(result.installed[0].id).toBe('test-plugin');
  });

  it('plugin-capable adapter implements installPlugin', async () => {
    const adapter = new PluginCapableAdapter();
    await adapter.installPlugin!('my-plugin', 'user');
    expect(adapter.installedPlugin).toBe('my-plugin');
  });

  it('plugin-capable adapter implements uninstallPlugin', async () => {
    const adapter = new PluginCapableAdapter();
    await adapter.uninstallPlugin!('my-plugin');
    expect(adapter.uninstalledPlugin).toBe('my-plugin');
  });

  it('plugin-capable adapter implements enablePlugin', async () => {
    const adapter = new PluginCapableAdapter();
    await adapter.enablePlugin!('my-plugin');
    expect(adapter.enabledPlugin).toBe('my-plugin');
  });

  it('plugin-capable adapter implements disablePlugin', async () => {
    const adapter = new PluginCapableAdapter();
    await adapter.disablePlugin!('my-plugin');
    expect(adapter.disabledPlugin).toBe('my-plugin');
  });

  it('adapter without plugins has capabilities.plugins === false', () => {
    const adapter = new NoPluginAdapter();
    expect(adapter.capabilities.plugins).toBe(false);
    expect((adapter as any).listPlugins).toBeUndefined();
  });

  it('callers should check capabilities before calling plugin methods', () => {
    const adapter: AgentAdapter = new NoPluginAdapter();
    // This pattern is what IPC handlers should use:
    if (adapter.capabilities.plugins && 'listPlugins' in adapter) {
      // Would call adapter.listPlugins() — but should not reach here
      expect.unreachable('should not enter this branch');
    }
    // If we get here, the guard worked correctly
    expect(adapter.capabilities.plugins).toBe(false);
  });
});
