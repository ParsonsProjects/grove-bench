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

import type { AcpAgentSetting } from '../../shared/types.js';
import { adapterRegistry } from './registry.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { AcpAdapter } from './acp/acp-adapter.js';
import { ACP_PRESETS, customAcpAgents } from './acp/presets.js';

/** Register all adapters: Claude Code (the default), the ACP agents Grove
 *  knows, then the user's own ACP agents. Call once during app initialization. */
export function initAdapters(acpAgents: readonly AcpAgentSetting[] = []): void {
  if (adapterRegistry.list().length > 0) return; // already initialized
  adapterRegistry.register(new ClaudeCodeAdapter());
  for (const def of [...ACP_PRESETS, ...customAcpAgents(acpAgents)]) {
    adapterRegistry.register(new AcpAdapter(def));
  }
}
