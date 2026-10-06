import { describe, it, expect } from 'vitest';
import type { AgentSummary, McpSupport } from '../../shared/types.js';
import { mcpAgentChoices } from './mcp-agents.js';

const controls = { list: false, reconnect: false, toggle: false, signIn: false, contextCost: false };
const shared: McpSupport = {
  controls,
  disconnectHint: '',
  config: { scopes: [], namePattern: '.*', nameRule: '', shared: { label: 'ACP agents', note: '' } },
};

function agent(id: string, mcp?: McpSupport): AgentSummary {
  return { id, displayName: id.toUpperCase(), capabilities: {}, ...(mcp ? { mcp } : {}) };
}

describe('mcpAgentChoices', () => {
  it('gives agents that share a list one entry, where the first of them is', () => {
    const choices = mcpAgentChoices([agent('gemini', shared), agent('claude'), agent('copilot', shared)]);
    expect(choices).toEqual([
      { id: 'gemini', label: 'ACP agents', agentIds: ['gemini', 'copilot'] },
      { id: 'claude', label: 'CLAUDE', agentIds: ['claude'] },
    ]);
  });

  it('keeps one entry per agent with a list of its own', () => {
    expect(mcpAgentChoices([agent('a'), agent('b')]).map((c) => c.label)).toEqual(['A', 'B']);
  });
});
