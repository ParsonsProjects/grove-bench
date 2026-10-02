import type { AgentSummary } from '../../shared/types.js';
import { DEFAULT_GROVE_WRITTEN } from '../lib/unsaved-files.js';

/** Whether new conversations may use `agent`: any agent that isn't in
 *  alpha, and alpha agents the user turned on (enabledAlphaAgents). */
export function offeredForNew(agent: Pick<AgentSummary, 'id' | 'stage'>, enabledAlpha: readonly string[]): boolean {
  return agent.stage !== 'alpha' || enabledAlpha.includes(agent.id);
}

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

  /** Whether an agent supports a capability. True until the list loads, and
   *  for an agent it doesn't know, so nothing is held back by a slow load. */
  supports(id: string | null | undefined, capability: string): boolean {
    const agent = this.get(id ?? this.defaultId);
    return agent ? agent.capabilities[capability] !== false : true;
  }

  /** Files Grove writes into worktrees for any agent (AgentSummary.generatedFiles),
   *  or Claude Code's until the list loads. */
  generatedFiles(): ReadonlySet<string> {
    if (!this.loaded) return DEFAULT_GROVE_WRITTEN;
    return new Set(this.list.flatMap((a) => a.generatedFiles ?? []));
  }

  /** offeredForNew for an agent id. True for an agent it doesn't know, like
   *  supports(). Existing conversations keep their agent either way. */
  isOffered(id: string | null | undefined, enabledAlpha: readonly string[]): boolean {
    const agent = this.get(id);
    return !agent || offeredForNew(agent, enabledAlpha);
  }

  /** The agents a new conversation can be started with. */
  offered(enabledAlpha: readonly string[]): AgentSummary[] {
    return this.list.filter((a) => this.isOffered(a.id, enabledAlpha));
  }

  /** Agents that support a capability, e.g. 'plugins' or 'mcpConfig'. */
  supporting(capability: string): AgentSummary[] {
    return this.list.filter((a) => a.capabilities[capability]);
  }
}

export const agentsStore = new AgentsStore();
