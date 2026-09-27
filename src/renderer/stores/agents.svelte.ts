import type { AgentSummary } from '../../shared/types.js';

/** The registered agents (adapters), loaded once per launch: the list only
 *  changes when the app is updated. */
class AgentsStore {
  list = $state<AgentSummary[]>([]);
  loaded = $state(false);

  private inFlight: Promise<void> | null = null;

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    this.inFlight ??= window.groveBench.listAdapters()
      .then((list) => {
        this.list = list;
        this.loaded = true;
      })
      .catch((err) => { console.error('Failed to list agents:', err); })
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  /** Fetch the list again, e.g. after an agent reports new models (its
   *  background model can change with them). */
  refresh(): Promise<void> {
    this.loaded = false;
    return this.load();
  }

  /** The agent new conversations use unless another is picked. */
  get defaultId(): string | null {
    return this.list.find((a) => a.isDefault)?.id ?? this.list[0]?.id ?? null;
  }

  get(id: string | null | undefined): AgentSummary | undefined {
    return id ? this.list.find((a) => a.id === id) : undefined;
  }

  /** Agents that support a capability, e.g. 'plugins' or 'mcpConfig'. */
  supporting(capability: string): AgentSummary[] {
    return this.list.filter((a) => a.capabilities[capability]);
  }
}

export const agentsStore = new AgentsStore();
