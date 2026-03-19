/**
 * Pure utility functions extracted from agent-session.ts for testability.
 * These will move into the adapter layer in Phase 2.
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
