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
} from './types.js';

export { adapterRegistry } from './registry.js';
export { ClaudeCodeAdapter } from './claude-code.js';

import { adapterRegistry } from './registry.js';
import { ClaudeCodeAdapter } from './claude-code.js';

/** Register all built-in adapters. Call once during app initialization. */
export function initAdapters(): void {
  if (adapterRegistry.list().length > 0) return; // already initialized
  adapterRegistry.register(new ClaudeCodeAdapter());
}
