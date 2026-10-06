import type { AgentSummary } from '../../shared/types.js';

/** One entry in the MCP servers page's agent picker. */
export interface McpAgentChoice {
  /** The agent the list is read and changed through. */
  id: string;
  label: string;
  /** Every agent the entry stands for. */
  agentIds: string[];
}

/** The picker's entries: one per agent, except that agents sharing one list
 *  (McpSupport.config.shared, the ACP agents) get one entry between them,
 *  where the first of them is. */
export function mcpAgentChoices(agents: readonly AgentSummary[]): McpAgentChoice[] {
  const choices: McpAgentChoice[] = [];
  const shared = new Map<string, McpAgentChoice>();
  for (const agent of agents) {
    const label = agent.mcp?.config?.shared?.label;
    const existing = label ? shared.get(label) : undefined;
    if (existing) {
      existing.agentIds.push(agent.id);
      continue;
    }
    const choice = { id: agent.id, label: label ?? agent.displayName, agentIds: [agent.id] };
    if (label) shared.set(label, choice);
    choices.push(choice);
  }
  return choices;
}
