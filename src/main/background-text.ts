import type { AgentAdapter } from './adapters/types.js';
import { backgroundModelFor } from './background-tasks.js';

/**
 * One-reply background requests (branch names, commit messages, conversation
 * goals): the conversation's agent, its background model, and a time limit.
 */

/** How long a background request may take before it is given up. */
export const BACKGROUND_TEXT_TIMEOUT_MS = 60_000;

type TextAgent = AgentAdapter & { generateText: NonNullable<AgentAdapter['generateText']> };

/** Throw unless the agent can generate text. Callers run it before any slow
 *  work (reading a diff, say), so an agent without it fails fast. */
export function assertTextGeneration(adapter: AgentAdapter): asserts adapter is TextAgent {
  if (!adapter.generateText) {
    throw new Error(`The ${adapter.displayName} agent does not support text generation`);
  }
}

/** Ask the agent for one reply on its background model, giving up after
 *  `timeoutMs`. Throws when the agent can't generate text. */
export async function generateBackgroundText(
  adapter: AgentAdapter,
  systemPrompt: string,
  userMessage: string,
  cwd: string,
  timeoutMs = BACKGROUND_TEXT_TIMEOUT_MS,
): Promise<string> {
  assertTextGeneration(adapter);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    return await adapter.generateText(systemPrompt, userMessage, {
      cwd,
      abortSignal: abortController.signal,
      model: backgroundModelFor(adapter),
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** The body of a reply wrapped in one ``` fence (trimmed), else the reply. */
export function unwrapFence(text: string): string {
  const fence = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/);
  return fence ? fence[1].trim() : text;
}
