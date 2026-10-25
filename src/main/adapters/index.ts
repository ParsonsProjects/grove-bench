export { adapterRegistry } from './registry.js';

import type { AcpAgentSetting, ClaudeAccountSetting, GroveBenchSettings } from '../../shared/types.js';
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

/** The agent the user picked for new threads (settings.defaultAgent), or
 *  null for the built-in default: none picked, or one that isn't offered for
 *  new threads (an alpha agent turned off, an account taken out of Settings,
 *  an agent that is gone). The renderer's agentsStore.defaultId matches it. */
export function pickedDefaultAgent(
  settings: Pick<GroveBenchSettings, 'defaultAgent' | 'enabledAlphaAgents' | 'claudeAccounts'>,
): string | null {
  const adapter = settings.defaultAgent ? adapterRegistry.get(settings.defaultAgent) : undefined;
  if (!adapter) return null;
  if (adapter.stage === 'alpha' && !settings.enabledAlphaAgents.includes(adapter.id)) return null;
  if (adapter.account && !claudeAccounts(settings.claudeAccounts).some((a) => a.id === adapter.id)) return null;
  return adapter.id;
}

/** Make the registry's default follow the user's pick, read from `settings`
 *  each time so a change in Settings applies at once. */
export function followDefaultAgent(settings: () => GroveBenchSettings): void {
  adapterRegistry.setPreferred(() => pickedDefaultAgent(settings()));
}

/** Register one of the user's other Claude accounts as its own agent, at
 *  launch or when it is added. One added again in the same run replaces the
 *  earlier agent; threads still running on that one keep it. */
export function registerClaudeAccount(account: ClaudeAccount): ClaudeCodeAdapter {
  const adapter = new ClaudeCodeAdapter(undefined, account);
  adapterRegistry.register(adapter);
  return adapter;
}
