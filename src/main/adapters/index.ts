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
} from './types.js';

export { adapterRegistry } from './registry.js';
export { ClaudeCodeAdapter } from './claude-code.js';
export { MistralAdapter } from './mistral-agent.js';

import { adapterRegistry } from './registry.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { MistralAdapter } from './mistral-agent.js';

/** Register all built-in adapters. Call once during app initialization. */
export function initAdapters(): void {
  if (adapterRegistry.list().length > 0) return; // already initialized
  adapterRegistry.register(new ClaudeCodeAdapter());
  adapterRegistry.register(new MistralAdapter());
}
