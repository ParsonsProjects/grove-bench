/**
 * OpenCode (`opencode acp`) as a built-in ACP agent, with OpenRouter as the
 * provider when the user saves an OpenRouter key in Grove.
 *
 * What OpenCode does unless told otherwise, and why each setting below exists
 * (docs/open-model-harnesses-plan.md, Spike findings):
 * - It edits files and runs commands without asking, so Grove's modes and tool
 *   rules never see them. The inline config makes edits, commands and fetches
 *   ask; Grove then answers from its rules, the mode or the user.
 * - Its plan mode still lets edits through (they only ask). Denying edits to
 *   the plan agent takes the edit tools away while it plans.
 * - `opencode acp` also serves an HTTP API on 127.0.0.1. Without a password any
 *   program on the computer can use it, and it returns saved provider keys.
 *   Each process gets a random password, which nothing else needs.
 *
 * The user's own OpenCode setup (sign-ins, opencode.json, plugins) still
 * applies; OPENCODE_CONFIG_CONTENT is merged over it, and over any
 * OPENCODE_CONFIG_CONTENT the user already set.
 */
import crypto from 'node:crypto';
import { net } from 'electron';
import { logger } from '../../logger.js';

/** Where a new conversation starts when the OpenRouter key is Grove's. */
export const OPENCODE_DEFAULT_MODEL = 'openrouter/deepseek/deepseek-v4.1-flash';

const OPENROUTER_KEY_CHECK_URL = 'https://openrouter.ai/api/v1/key';
const OPENROUTER_KEY_CHECK_TIMEOUT_MS = 10_000;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

/** Environment for one OpenCode process. `env` is what it would start with;
 *  `savedKey` says whether the OpenRouter key in it is the one saved in Grove,
 *  in which case new sessions start on OPENCODE_DEFAULT_MODEL (and its title
 *  requests use it too) unless the user's inline config names a model. */
export function openCodeEnv(env: Readonly<Record<string, string | undefined>>, { savedKey }: { savedKey: boolean }): Record<string, string> {
  let base: JsonObject = {};
  try {
    base = asObject(JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? ''));
  } catch {
    // Unset or not JSON: start from nothing.
  }
  const agent = asObject(base.agent);
  const plan = asObject(agent.plan);
  const config: JsonObject = {
    ...base,
    permission: { ...asObject(base.permission), edit: 'ask', bash: 'ask', webfetch: 'ask' },
    agent: { ...agent, plan: { ...plan, permission: { ...asObject(plan.permission), edit: 'deny' } } },
    ...(savedKey && !base.model ? { model: OPENCODE_DEFAULT_MODEL } : {}),
    ...(savedKey && !base.small_model ? { small_model: OPENCODE_DEFAULT_MODEL } : {}),
  };
  return {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_SERVER_PASSWORD: crypto.randomBytes(24).toString('base64url'),
  };
}

type KeyCheckFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** Ask OpenRouter about a key (GET /api/v1/key): true when it is accepted,
 *  false when refused, null when that couldn't be told (offline, an outage). */
export async function verifyOpenRouterKey(
  key: string,
  { fetchFn = (url, init) => net.fetch(url, init) }: { fetchFn?: KeyCheckFetch } = {},
): Promise<boolean | null> {
  try {
    const res = await fetchFn(OPENROUTER_KEY_CHECK_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(OPENROUTER_KEY_CHECK_TIMEOUT_MS),
    });
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) return false;
    logger.debug(`[opencode] OpenRouter key check answered ${res.status}`);
    return null;
  } catch (err) {
    logger.debug('[opencode] OpenRouter key check failed:', err);
    return null;
  }
}
