export type {
  AgentAdapter,
  AgentQueryHandle,
  AgentCapabilities,
  AdapterConfig,
  AdapterPrerequisiteStatus,
  ModelInfo,
  UserMessage,
  PermissionRequest,
  PermissionResponse,
  PermissionHandler,
  MemoryOperations,
  PreviewOperations,
  PreviewTarget,
  PreviewScreenshot,
} from './types.js';

export { adapterRegistry } from './registry.js';
export { ClaudeCodeAdapter } from './claude-code.js';
export { AcpAdapter } from './acp/acp-adapter.js';

import type { AcpAgentSetting, ClaudeAccountSetting } from '../../shared/types.js';
import { adapterRegistry } from './registry.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { claudeAccounts, type ClaudeAccount } from './claude-accounts.js';
import { AcpAdapter } from './acp/acp-adapter.js';
import { ACP_PRESETS, customAcpAgents } from './acp/presets.js';

/** Register all adapters: Claude Code (the default), the user's other Claude
 *  accounts, the ACP agents Grove knows, then the user's own ACP agents. Call
 *  once during app initialization. */
export function initAdapters(
  acpAgents: readonly AcpAgentSetting[] = [],
  accounts: readonly ClaudeAccountSetting[] = [],
): void {
  if (adapterRegistry.list().length > 0) return; // already initialized
  adapterRegistry.register(new ClaudeCodeAdapter());
  for (const account of claudeAccounts(accounts)) registerClaudeAccount(account);
  for (const def of [...ACP_PRESETS, ...customAcpAgents(acpAgents)]) {
    adapterRegistry.register(new AcpAdapter(def));
  }
}

/** Register one of the user's other Claude accounts as its own agent, at
 *  launch or when it is added. One added again in the same run replaces the
 *  earlier agent; threads still running on that one keep it. */
export function registerClaudeAccount(account: ClaudeAccount): ClaudeCodeAdapter {
  const adapter = new ClaudeCodeAdapter(undefined, account);
  adapterRegistry.register(adapter);
  return adapter;
}
