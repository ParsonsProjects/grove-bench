import type { AgentAdapter } from './types.js';

class AdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();
  private defaultId: string | null = null;
  private preferred: () => string | null = () => null;

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

  /** Follow the user's pick of default agent: `pick` is asked on every
   *  getDefault, so a change in Settings applies at once. It returns an
   *  adapter id, or null for the built-in default. */
  setPreferred(pick: () => string | null): void {
    this.preferred = pick;
  }

  /** The agent new threads start on: the user's pick when it is registered,
   *  else the built-in default. */
  getDefault(): AgentAdapter {
    const preferred = this.preferred();
    const picked = preferred ? this.adapters.get(preferred) : undefined;
    return picked ?? this.getBuiltInDefault();
  }

  /** The default when the user hasn't picked one (the first registered,
   *  unless setDefault said otherwise). */
  getBuiltInDefault(): AgentAdapter {
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
