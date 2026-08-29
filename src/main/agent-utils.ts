/**
 * Pure utility functions shared between agent-session.ts and adapters.
 */

/**
 * Environment variable prefixes that leak noisy paths into the LLM context.
 */
export const ENV_NOISE_PREFIXES = ['npm_', 'NVM_', 'FNM_', 'VSCODE_', 'ELECTRON_'];

/**
 * Strip noisy env vars that leak absolute paths into the LLM context,
 * causing the model to use full paths for simple CLI commands.
 */
export function cleanEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !ENV_NOISE_PREFIXES.some(p => key.startsWith(p))
    )
  );
}

/**
 * Match a tool rule pattern against a tool call.
 * Patterns: "Bash" matches all Bash, "Bash(npm run *)" matches commands starting with "npm run ".
 * Glob-style * wildcards are supported.
 */
export function matchToolRule(pattern: string, toolName: string, toolCall: string): boolean {
  // Simple tool name match (no parentheses)
  if (!pattern.includes('(')) {
    return toolName === pattern || toolName.startsWith(pattern);
  }
  // Pattern with specifier: ToolName(specifier)
  const match = pattern.match(/^([^(]+)\((.+)\)$/);
  if (!match) return false;
  const [, ruleTool, specifier] = match;
  if (ruleTool !== toolName) return false;
  if (specifier === '*') return true;
  // Convert glob pattern to regex
  const escaped = specifier.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`).test(toolCall.slice(toolName.length + 1, -1) || '');
  } catch {
    return false;
  }
}

/**
 * Creates an AsyncIterable from a ReadableStream so we can pass
 * it to query()'s prompt parameter for multi-turn conversations.
 */
export function readableStreamToAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const reader = stream.getReader();
      return {
        async next() {
          const { done, value } = await reader.read();
          if (done) return { done: true, value: undefined as any };
          return { done: false, value };
        },
        async return() {
          reader.releaseLock();
          return { done: true, value: undefined as any };
        },
        async throw(e: unknown) {
          reader.cancel(e instanceof Error ? e.message : String(e));
          return { done: true, value: undefined as any };
        },
      };
    },
  };
}

/**
 * Find the provider chain-entry UUID to fork at when rewinding to the user
 * message with the given (Grove-generated) uuid: the SDK uuid of the last
 * assistant-side event before that message in the event history. Returns null
 * when the target isn't found or no provider content precedes it (e.g. a
 * rewind to the first message), in which case the caller should fall back to
 * starting a fresh conversation.
 *
 * Only assistant-side events carry provider uuids — user_message events hold
 * Grove's own uuids and must not be used as fork points.
 */
export function findRewindForkPoint(
  events: import('../shared/types.js').AgentEvent[],
  targetUuid: string,
): string | null {
  const idx = events.findLastIndex(
    (e) => e.type === 'user_message' && e.uuid === targetUuid,
  );
  if (idx < 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const e = events[i];
    if (
      (e.type === 'assistant_text' || e.type === 'assistant_tool_use' || e.type === 'thinking') &&
      e.uuid
    ) {
      return e.uuid;
    }
  }
  return null;
}
