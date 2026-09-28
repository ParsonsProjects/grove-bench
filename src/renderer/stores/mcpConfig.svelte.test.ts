import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';

import { mcpConfigStore } from './mcpConfig.svelte.js';
import type { McpConfiguredServer } from '../../shared/types.js';

const SERVER: McpConfiguredServer = {
  name: 'test-server',
  target: 'npx test-server',
  transport: 'stdio',
  status: 'connected',
};

beforeEach(() => {
  vi.clearAllMocks();
  mcpConfigStore.servers = [];
  mcpConfigStore.loading = false;
  mcpConfigStore.loaded = false;
  mcpConfigStore.error = null;
  mcpConfigStore.actionInProgress = null;
  mcpConfigStore.cwd = undefined;
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

describe('project', () => {
  const list = () => mockGroveBench.mcpConfigList as ReturnType<typeof vi.fn>;

  it('switches back to user servers only', async () => {
    list().mockResolvedValue([]);
    await mcpConfigStore.showProject('C:/dev/app');
    await mcpConfigStore.showProject(undefined);
    expect(mcpConfigStore.cwd).toBeUndefined();
    expect(list()).toHaveBeenLastCalledWith(undefined);
  });

  it('shows the project a project-scope server was added to', async () => {
    list().mockResolvedValue([]);
    await mcpConfigStore.showProject('C:/dev/a');
    await mcpConfigStore.add({ name: 'x', transport: 'stdio', commandOrUrl: 'y', scope: 'project', cwd: 'C:/dev/b' });
    expect(mcpConfigStore.cwd).toBe('C:/dev/b');
    expect(list()).toHaveBeenLastCalledWith('C:/dev/b');
  });

  it('keeps the listed project after adding a user server', async () => {
    list().mockResolvedValue([]);
    await mcpConfigStore.showProject('C:/dev/a');
    await mcpConfigStore.add({ name: 'x', transport: 'stdio', commandOrUrl: 'y', scope: 'user' });
    expect(list()).toHaveBeenLastCalledWith('C:/dev/a');
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
