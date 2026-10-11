/**
 * The user's other Claude accounts (Settings > Agents), such as work next to
 * personal. Each runs as its own Claude agent with its own Claude Code
 * folder, set through CLAUDE_CONFIG_DIR: Claude Code keeps an account's
 * sign-in, history, settings, MCP servers and plugins there ("Log in with
 * multiple accounts", https://code.claude.com/docs/en/authentication). The
 * default account keeps `~/.claude`.
 *
 * Grove never reads the sign-in. The user signs in with Claude Code's own
 * `claude auth login`, run with the account's folder (DESIGN.md,
 * "Authentication rules").
 */
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { ClaudeAccountSetting } from '../../shared/types.js';
import { slugify } from '../agent-utils.js';

/** Adapter ids of the user's other Claude accounts carry this prefix, so
 *  they can't take a built-in id. */
export const CLAUDE_ACCOUNT_PREFIX = 'claude-account-';

export interface ClaudeAccount {
  /** Adapter id: CLAUDE_ACCOUNT_PREFIX and a slug. */
  id: string;
  name: string;
  /** Absolute path of the account's Claude Code folder. */
  configDir: string;
}

/**
 * Credentials and provider switches Claude Code uses over a folder's own
 * sign-in when they are in its environment (its authentication precedence,
 * https://code.claude.com/docs/en/authentication#authentication-precedence).
 * An account agent drops these from Grove's environment, or one key set in
 * the user's shell would quietly stand in for every account. The account's
 * own saved key is added back afterwards.
 */
export const INHERITED_SIGN_IN_ENV: readonly string[] = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_FEDERATION_RULE_ID',
];

/** `env` for an account's Claude Code: without inherited sign-ins, and with
 *  CLAUDE_CONFIG_DIR set to the account's folder. Names are matched in any
 *  case, as Windows reads them. */
export function accountEnv(env: Readonly<Record<string, string | undefined>>, configDir: string): Record<string, string | undefined> {
  const dropped = new Set([...INHERITED_SIGN_IN_ENV, 'CLAUDE_CONFIG_DIR']);
  const out = Object.fromEntries(Object.entries(env).filter(([name]) => !dropped.has(name.toUpperCase())));
  out.CLAUDE_CONFIG_DIR = configDir;
  return out;
}

/** The PowerShell line that signs in to the account: Claude Code's own
 *  `claude auth login`, pointed at the account's folder. */
export function accountSignInCommand(configDir: string): string {
  return `$env:CLAUDE_CONFIG_DIR = '${configDir.replace(/'/g, "''")}'; claude auth login`;
}

/** A typed folder as an absolute path: `~` is the home folder, and a
 *  relative path is taken from it. */
function resolveFolder(dir: string, home: string): string {
  const expanded = dir === '~' || /^~[\\/]/.test(dir) ? path.join(home, dir.slice(1)) : dir;
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.join(home, expanded);
}

/** Accounts from the settings. Entries without a name, or that repeat an id,
 *  are skipped. The id comes from the first of id and name that gives a
 *  usable slug, else a hash of the name, so it stays the same across
 *  launches. The folder defaults to `~/.claude-<slug>`, the name Claude
 *  Code's docs use for a second account. */
export function claudeAccounts(settings: readonly ClaudeAccountSetting[] | undefined, home = os.homedir()): ClaudeAccount[] {
  const out: ClaudeAccount[] = [];
  const seen = new Set<string>();
  for (const s of settings ?? []) {
    const name = s.name?.trim();
    if (!name) continue;
    const slug = slugify(s.id) || slugify(name)
      || `account-${crypto.createHash('sha1').update(name).digest('hex').slice(0, 8)}`;
    const id = `${CLAUDE_ACCOUNT_PREFIX}${slug}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const dir = s.configDir?.trim();
    out.push({ id, name, configDir: dir ? resolveFolder(dir, home) : path.join(home, `.claude-${slug}`) });
  }
  return out;
}
