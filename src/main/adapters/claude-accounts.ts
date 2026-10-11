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
import { slugify } from '../../shared/slug.js';

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
  // A gateway or proxy set for the default account would also get this
  // account's requests and its sign-in. An account that needs one sets it in
  // its own folder's settings.json.
  'ANTHROPIC_BASE_URL',
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

/** Characters PowerShell ends a single-quoted string at: the apostrophe and
 *  four typographic single quotes (IsSingleQuote in PowerShell's
 *  CharTraits.cs). Each is written twice to stand for itself. */
const POWERSHELL_SINGLE_QUOTES = /['\u2018\u2019\u201A\u201B]/g;

/** The PowerShell line that signs in to the account: Claude Code's own
 *  `claude auth login`, pointed at the account's folder. The variable is
 *  cleared afterwards, so a later `claude` in the same window uses the
 *  default account again. */
export function accountSignInCommand(configDir: string): string {
  const quoted = configDir.replace(POWERSHELL_SINGLE_QUOTES, '$&$&');
  return `$env:CLAUDE_CONFIG_DIR = '${quoted}'; claude auth login; Remove-Item Env:CLAUDE_CONFIG_DIR`;
}

/** `name` in `env`, matched in any case as Windows does. */
function envValue(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/** A typed folder as an absolute path. Quotes around it (Explorer's Copy as
 *  path adds them) are dropped, `%NAME%` is an environment variable, `~` is
 *  the home folder, and a relative path is taken from the home folder.
 *  Throws for a variable that isn't set. */
function resolveFolder(typed: string, home: string, env: Readonly<Record<string, string | undefined>>): string {
  let dir = typed.trim().replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1').trim();
  dir = dir.replace(/%([^%]+)%/g, (_, name: string) => {
    const value = envValue(env, name);
    if (value === undefined) throw new Error(`%${name}% isn't set on this computer.`);
    return value;
  });
  if (dir === '~' || /^~[\\/]/.test(dir)) dir = path.join(home, dir.slice(1));
  return path.isAbsolute(dir) ? path.normalize(dir) : path.join(home, dir);
}

/** Whether two folders are the same (in any case on Windows). */
function sameFolder(a: string, b: string): boolean {
  return path.relative(path.resolve(a), path.resolve(b)) === '';
}

/** The account a saved entry stands for, or null for one without a name. */
function toAccount(s: ClaudeAccountSetting, home: string, env: Readonly<Record<string, string | undefined>>): ClaudeAccount | null {
  const name = s.name?.trim();
  if (!name) return null;
  const slug = slugify(s.id) || slugify(name)
    || `account-${crypto.createHash('sha1').update(name).digest('hex').slice(0, 8)}`;
  const dir = s.configDir?.trim();
  let configDir = path.join(home, `.claude-${slug}`);
  if (dir) {
    try { configDir = resolveFolder(dir, home, env); }
    catch { /* a variable that has gone: keep the default folder */ }
  }
  return { id: `${CLAUDE_ACCOUNT_PREFIX}${slug}`, name, configDir };
}

/** Longest account name. It shows in the agent picker. */
const MAX_NAME_LENGTH = 40;

/**
 * Checks an account the user is adding against the ones already saved.
 * Returns the account to register and the entry to save: its id is fixed now,
 * so the agent and its default folder stay the same whatever the name later
 * becomes. A typed folder is saved as the absolute path it resolved to; an
 * empty one stays empty, for `~/.claude-<id>`. Throws a user-facing message.
 */
export function newClaudeAccount(
  input: { name: unknown; configDir: unknown },
  saved: readonly ClaudeAccountSetting[],
  { home = os.homedir(), env = process.env }: { home?: string; env?: Readonly<Record<string, string | undefined>> } = {},
): { account: ClaudeAccount; setting: ClaudeAccountSetting } {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new Error('Enter a name for the account, such as Work.');
  if (name.length > MAX_NAME_LENGTH) throw new Error(`Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`);
  const typed = typeof input.configDir === 'string' ? input.configDir.trim() : '';
  const configDir = typed ? resolveFolder(typed, home, env) : '';

  const account = toAccount({ id: '', name, configDir }, home, env)!;
  const others = claudeAccounts(saved, home, env);
  const sameId = others.find((a) => a.id === account.id);
  if (sameId) throw new Error(`You already have an account called "${sameId.name}". Pick another name.`);
  if (sameFolder(account.configDir, home)) throw new Error('Pick a folder for this account, not your home folder itself.');
  const defaultFolder = envValue(env, 'CLAUDE_CONFIG_DIR')?.trim() || path.join(home, '.claude');
  if (sameFolder(account.configDir, defaultFolder)) throw new Error('That folder is your first account\'s. Pick another one.');
  const sameDir = others.find((a) => sameFolder(a.configDir, account.configDir));
  if (sameDir) throw new Error(`"${sameDir.name}" already uses that folder.`);

  return { account, setting: { id: account.id.slice(CLAUDE_ACCOUNT_PREFIX.length), name, configDir } };
}

/** Accounts from the settings. Entries without a name, or that repeat an id,
 *  are skipped. The id comes from the first of id and name that gives a
 *  usable slug, else a hash of the name, so it stays the same across
 *  launches. The folder defaults to `~/.claude-<slug>`, the name Claude
 *  Code's docs use for a second account. */
export function claudeAccounts(
  settings: readonly ClaudeAccountSetting[] | undefined,
  home = os.homedir(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): ClaudeAccount[] {
  const out: ClaudeAccount[] = [];
  const seen = new Set<string>();
  for (const s of settings ?? []) {
    const account = toAccount(s, home, env);
    if (!account || seen.has(account.id)) continue;
    seen.add(account.id);
    out.push(account);
  }
  return out;
}

/** Whether `adapterId` names one of the user's other Claude accounts. */
export function isClaudeAccountId(adapterId: string | null | undefined): boolean {
  return !!adapterId?.startsWith(CLAUDE_ACCOUNT_PREFIX);
}

/** Why a thread on a Claude account that is no longer set up can't go to
 *  another account instead. */
export function removedAccountMessage(adapterId: string): string {
  return `This thread ran on a Claude account that has been removed (${adapterId.slice(CLAUDE_ACCOUNT_PREFIX.length)}). Add it again in Settings → Agents to use it, so its work doesn't go to another account.`;
}
