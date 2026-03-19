import type { AgentAdapter } from './types.js';

class AdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  getDefault(): AgentAdapter {
    const adapter = this.adapters.get('claude-code');
    if (!adapter) throw new Error('No default adapter registered');
    return adapter;
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()];
  }
}

export const adapterRegistry = new AdapterRegistry();
