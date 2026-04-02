import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentAdapter } from './types.js';

function makeAdapter(id: string, overrides?: Partial<AgentAdapter>): AgentAdapter {
  return {
    id,
    displayName: id,
    capabilities: {
      permissions: false,
      permissionModes: false,
      resume: false,
      modelSwitching: false,
      thinking: false,
      plugins: false,
      imageAttachments: false,
      structuredOutput: false,
      sandbox: false,
    },
    getModels: () => [],
    checkPrerequisites: async () => ({ available: true }),
    start: async () => {
      throw new Error('not implemented');
    },
    authErrorMessage: 'auth error',
    ...overrides,
  };
}

// vi.resetModules() + dynamic import gives us a fresh singleton each test
let adapterRegistry: typeof import('./registry.js')['adapterRegistry'];

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./registry.js');
  adapterRegistry = mod.adapterRegistry;
});

describe('AdapterRegistry', () => {
  it('registers an adapter and retrieves it by id', () => {
    const adapter = makeAdapter('test-adapter');
    adapterRegistry.register(adapter);
    expect(adapterRegistry.get('test-adapter')).toBe(adapter);
  });

  it('returns undefined for unregistered id', () => {
    expect(adapterRegistry.get('nonexistent')).toBeUndefined();
  });

  it('first registered adapter becomes the default', () => {
    const first = makeAdapter('first');
    const second = makeAdapter('second');
    adapterRegistry.register(first);
    adapterRegistry.register(second);
    expect(adapterRegistry.getDefault()).toBe(first);
  });

  it('setDefault changes the default adapter', () => {
    const first = makeAdapter('first');
    const second = makeAdapter('second');
    adapterRegistry.register(first);
    adapterRegistry.register(second);
    adapterRegistry.setDefault('second');
    expect(adapterRegistry.getDefault()).toBe(second);
  });

  it('setDefault throws for unregistered adapter', () => {
    expect(() => adapterRegistry.setDefault('missing')).toThrow(
      'Adapter "missing" not registered',
    );
  });

  it('getDefault throws when no adapters registered', () => {
    expect(() => adapterRegistry.getDefault()).toThrow('No adapters registered');
  });

  it('list returns all registered adapters', () => {
    const a = makeAdapter('a');
    const b = makeAdapter('b');
    adapterRegistry.register(a);
    adapterRegistry.register(b);
    expect(adapterRegistry.list()).toEqual([a, b]);
  });

  it('list returns empty array when none registered', () => {
    expect(adapterRegistry.list()).toEqual([]);
  });

  it('disposeAll calls dispose on all adapters', async () => {
    const disposeFn = vi.fn().mockResolvedValue(undefined);
    const a = makeAdapter('a', { dispose: disposeFn });
    const b = makeAdapter('b', { dispose: disposeFn });
    adapterRegistry.register(a);
    adapterRegistry.register(b);
    await adapterRegistry.disposeAll();
    expect(disposeFn).toHaveBeenCalledTimes(2);
  });

  it('disposeAll handles adapters without dispose', async () => {
    const a = makeAdapter('a'); // no dispose method
    adapterRegistry.register(a);
    await expect(adapterRegistry.disposeAll()).resolves.toBeUndefined();
  });
});
