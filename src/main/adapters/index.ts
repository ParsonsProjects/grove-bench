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
export { MistralVibeAdapter } from './mistral-vibe.js';

import { adapterRegistry } from './registry.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { MistralVibeAdapter } from './mistral-vibe.js';

/** Register all built-in adapters. Call once during app initialization.
 *  Order matters: the first registered adapter is the registry default. */
export function initAdapters(): void {
  if (adapterRegistry.list().length > 0) return; // already initialized
  adapterRegistry.register(new ClaudeCodeAdapter());
  adapterRegistry.register(new MistralVibeAdapter());
}
