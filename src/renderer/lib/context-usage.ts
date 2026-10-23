/** Token counts for the status bar: 1234 -> "1.2k", 1500000 -> "1.5M". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

export interface ContextUsage {
  usedTokens: number;
  freeTokens: number;
  /** 0 to 100. */
  usedPercent: number;
}

/**
 * How full the context window is. The API's input_tokens counts only what
 * was not served from the cache, so the total adds cache reads and writes.
 */
export function contextUsage(
  usage: { inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number },
  contextWindow: number,
): ContextUsage {
  const usedTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  return {
    usedTokens,
    freeTokens: Math.max(0, contextWindow - usedTokens),
    usedPercent: Math.min((usedTokens / contextWindow) * 100, 100),
  };
}
