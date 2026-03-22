import type { AgentAdapter } from './types.js';

class AdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();
  private defaultId: string | null = null;

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
    // First registered adapter becomes the default unless explicitly set
    if (!this.defaultId) {
      this.defaultId = adapter.id;
    }
  }

  get(id: string): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  /** Set which adapter is used as the default. */
  setDefault(id: string): void {
    if (!this.adapters.has(id)) throw new Error(`Adapter "${id}" not registered`);
    this.defaultId = id;
  }

  getDefault(): AgentAdapter {
    if (!this.defaultId) throw new Error('No adapters registered');
    const adapter = this.adapters.get(this.defaultId);
    if (!adapter) throw new Error(`Default adapter "${this.defaultId}" not found`);
    return adapter;
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()];
  }

  /** Dispose all adapters (called during app shutdown). */
  async disposeAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.dispose?.();
    }
  }
}

export const adapterRegistry = new AdapterRegistry();
