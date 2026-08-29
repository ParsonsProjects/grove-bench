import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';

import { mcpConfigStore } from './mcpConfig.svelte.js';
import type { McpConfiguredServer } from '../../shared/types.js';

const SERVER: McpConfiguredServer = {
  name: 'test-server',
  transport: 'stdio',
  command: 'npx test-server',
  scope: 'user',
} as McpConfiguredServer;

beforeEach(() => {
  vi.clearAllMocks();
  mcpConfigStore.servers = [];
  mcpConfigStore.loading = false;
  mcpConfigStore.loaded = false;
  mcpConfigStore.error = null;
  mcpConfigStore.actionInProgress = null;
});

describe('refresh', () => {
  it('loads servers from the bridge', async () => {
    (mockGroveBench.mcpConfigList as ReturnType<typeof vi.fn>).mockResolvedValue([SERVER]);
    await mcpConfigStore.refresh();
    expect(mcpConfigStore.servers).toEqual([SERVER]);
    expect(mcpConfigStore.loaded).toBe(true);
    expect(mcpConfigStore.error).toBeNull();
  });

  it('captures errors from the bridge', async () => {
    (mockGroveBench.mcpConfigList as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    await mcpConfigStore.refresh();
    expect(mcpConfigStore.error).toBe('boom');
    expect(mcpConfigStore.loaded).toBe(false);
  });
});

describe('stale preload bridge', () => {
  const bridge = mockGroveBench as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = {
      mcpConfigList: bridge.mcpConfigList,
      mcpConfigAdd: bridge.mcpConfigAdd,
      mcpConfigRemove: bridge.mcpConfigRemove,
    };
    delete bridge.mcpConfigList;
    delete bridge.mcpConfigAdd;
    delete bridge.mcpConfigRemove;
  });

  afterEach(() => {
    Object.assign(bridge, saved);
  });

  it('refresh sets a restart hint instead of throwing', async () => {
    await mcpConfigStore.refresh();
    expect(mcpConfigStore.error).toMatch(/restart/i);
    expect(mcpConfigStore.loading).toBe(false);
    expect(mcpConfigStore.loaded).toBe(false);
  });

  it('add sets a restart hint and returns false', async () => {
    const ok = await mcpConfigStore.add({ name: 'x', transport: 'stdio', command: 'y' } as never);
    expect(ok).toBe(false);
    expect(mcpConfigStore.error).toMatch(/restart/i);
    expect(mcpConfigStore.actionInProgress).toBeNull();
  });

  it('remove sets a restart hint instead of throwing', async () => {
    await mcpConfigStore.remove('test-server');
    expect(mcpConfigStore.error).toMatch(/restart/i);
    expect(mcpConfigStore.actionInProgress).toBeNull();
  });
});
