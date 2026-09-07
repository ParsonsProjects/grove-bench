/**
 * Read-only tool-call classifier for Auto permission mode.
 *
 * Auto mode auto-approves tool calls that only READ, and falls back to a
 * normal permission prompt for anything that mutates state or that this
 * classifier does not recognize. The classifier is deliberately conservative:
 * it is an allowlist, so an unknown command is never auto-approved, it just
 * prompts. A false negative costs one extra click; a false positive is
 * impossible for commands outside the allowlist.
 *
 * Hardening notes (each closes a verified bypass):
 * - No network-fetch tools are auto-approved (WebFetch/WebSearch prompt):
 *   read-anything + fetch-any-URL is an exfiltration channel.
 * - Reads are scoped to the worktree: absolute paths, `~`, and `..` traversal
 *   outside it prompt — both in tool inputs (Read/Grep/Glob) and in Bash
 *   command arguments.
 * - Commands that can execute or write through flags are excluded (`env`,
 *   `awk`, `sort -o`) or flag-gated (`find -exec/-delete`).
 * - git's config-injection and exec flags are rejected (`-c`, `--config-env`,
 *   `--exec-path`, `--upload-pack`, `--output`, `-O`/`--open-files-in-pager`,
 *   `--ext-diff`), and `fetch`/`ls-remote` only accept configured remote
 *   names, never ad-hoc URLs (another exfiltration channel).
 *
 * This remains a UX layer, not a security boundary — OS-level sandboxing is
 * the enforcement mechanism for untrusted workloads.
 */

import path from 'node:path';
import { isPathInside } from './agent-utils.js';

/** Tools that never mutate anything. Tools listed in TOOL_PATH_FIELDS are
 *  additionally path-scoped to the worktree. */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'NotebookRead',
  'TodoRead',
]);

/** Input fields holding filesystem paths, checked against the worktree.
 *  Absent fields default to the tool's cwd, which is the worktree. */
const TOOL_PATH_FIELDS: Record<string, string[]> = {
  Read: ['file_path'],
  NotebookRead: ['notebook_path'],
  Grep: ['path'],
  Glob: ['path'],
  LS: ['path'],
};

/** Plain commands that only read (filesystem or stdout). Deliberately absent:
 *  env (env CMD executes CMD), awk (system() executes), sort/tree (-o writes),
 *  sed (-i writes), xargs/curl/wget. */
const READ_ONLY_COMMANDS = new Set([
  'ls', 'dir', 'pwd', 'cd', 'cat', 'type', 'head', 'tail', 'less', 'more',
  'wc', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'findstr', 'which', 'where',
  'whoami', 'echo', 'printf', 'date', 'printenv', 'stat', 'file',
  'du', 'df', 'dirname', 'basename', 'realpath', 'readlink',
  'uniq', 'cut', 'jq', 'diff', 'cmp', 'hostname', 'uname',
  'md5sum', 'sha1sum', 'sha256sum', 'true',
]);

/** `find` flags that execute programs or mutate the filesystem. Prefix-matched
 *  so -execdir, -fprintf, -fprint0 etc. are covered. */
const FIND_MUTATING_FLAG_PREFIXES = ['-exec', '-ok', '-delete', '-fprint', '-fls'];

/** git subcommands that are read-only unconditionally. fetch/ls-remote contact
 *  the remote read-only, and are further restricted to configured remote names
 *  (no ad-hoc URLs) below. */
const GIT_READ_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'blame', 'grep', 'describe', 'shortlog',
  'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'ls-remote', 'cat-file',
  'name-rev', 'cherry', 'count-objects', 'merge-base', 'whatchanged',
  'reflog', 'fetch', 'help', 'var', 'check-ignore', 'diff-tree', 'diff-index',
]);

/** git global options that inject config or executable paths — these can turn
 *  any read subcommand into code execution (core.fsmonitor, core.pager,
 *  diff.*.command, …), so their presence rejects outright. Prefix-matched to
 *  cover --config-env=… and --exec-path=… forms. */
const GIT_DANGEROUS_GLOBAL_PREFIXES = ['-c', '--config-env', '--exec-path'];

/** git flags that execute programs or write files despite a read subcommand:
 *  --upload-pack=CMD (fetch/ls-remote), -O/--open-files-in-pager=CMD (grep),
 *  --output=FILE (log/diff), --ext-diff (diff runs configured external tool). */
const GIT_DANGEROUS_FLAG_PREFIXES = ['--upload-pack', '--output', '--open-files-in-pager', '-O', '--ext-diff'];

/** Flags that make `git branch` / `git tag` mutate — presence of any rejects.
 *  Kept separate because -a lists for branch but annotates (creates) for tag. */
const GIT_BRANCH_MUTATING_FLAGS = new Set([
  '-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy',
  '--edit-description', '-u', '--set-upstream-to', '--unset-upstream',
  '-f', '--force',
]);
const GIT_TAG_MUTATING_FLAGS = new Set([
  '-d', '--delete', '-a', '--annotate', '-s', '--sign', '-m', '-F',
  '-e', '--edit', '-f', '--force',
]);

/** gh subcommand pairs that only read from GitHub. */
const GH_READ_PAIRS = new Set([
  'pr view', 'pr list', 'pr diff', 'pr status', 'pr checks',
  'issue view', 'issue list', 'issue status',
  'repo view', 'run list', 'run view', 'release list', 'release view',
  'search repos', 'search issues', 'search prs', 'search code',
  'status', 'auth status',
]);

/** npm subcommands that only read (view/ping hit the registry read-only). */
const NPM_READ_SUBCOMMANDS = new Set(['ls', 'list', 'view', 'info', 'show', 'outdated', 'ping', 'root', 'prefix', 'help']);

function isFlag(token: string): boolean {
  return token.startsWith('-');
}

function stripQuotes(token: string): string {
  return token.replace(/^['"]|['"]$/g, '');
}

/** True when a token looks like a URL or scp-style remote (user@host:path). */
function looksLikeRemoteUrl(token: string): boolean {
  const t = stripQuotes(token);
  return t.includes('://') || /^[^\s/]+@[^\s/]+:/.test(t);
}

/**
 * True when a command-line token references a filesystem location outside the
 * worktree. Checks the token itself and any value after "=" (--flag=/path).
 * `~` and `..` traversal always reject; absolute paths must resolve inside
 * `cwd` (reject all when cwd is unknown). A token starting with "/" counts as
 * a path only when it has a second separator ("/etc/passwd", "/c/Users/…") so
 * Windows-style switches like findstr's "/s" stay usable.
 */
function referencesPathOutsideCwd(token: string, cwd: string | undefined): boolean {
  const raw = stripQuotes(token);
  const candidates = [raw];
  const eq = raw.indexOf('=');
  if (eq > 0) candidates.push(stripQuotes(raw.slice(eq + 1)));

  for (const c of candidates) {
    if (c.startsWith('~')) return true;
    if (c === '..' || /^\.\.[\\/]/.test(c) || /[\\/]\.\.([\\/]|$)/.test(c)) return true;
    const isDrivePath = /^[A-Za-z]:[\\/]/.test(c);
    const isUnc = c.startsWith('\\\\') || c.startsWith('\\');
    const isPosixPath = c.startsWith('/') && c.indexOf('/', 1) !== -1;
    if (isDrivePath || isUnc || isPosixPath) {
      if (!cwd) return true;
      if (!isPathInside(cwd, path.resolve(c))) return true;
    }
  }
  return false;
}

/** Classify a single simple command (no shell operators). */
function isReadOnlySimpleCommand(segment: string, cwd: string | undefined): boolean {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true; // empty segment (e.g. trailing ;)

  // Worktree scoping applies to every recognized command's arguments.
  if (tokens.some((t) => referencesPathOutsideCwd(t, cwd))) return false;

  const cmd = tokens[0].toLowerCase();

  if (cmd === 'find') {
    return !tokens.some((t) => FIND_MUTATING_FLAG_PREFIXES.some((p) => t.startsWith(p)));
  }

  if (READ_ONLY_COMMANDS.has(cmd)) return true;

  if (cmd === 'git') {
    // Config/exec injection via global options rejects outright — a -c
    // core.fsmonitor=CMD prefix turns `git status` into code execution.
    // Skip benign global options (-C <path>) to find the subcommand.
    let i = 1;
    while (i < tokens.length && isFlag(tokens[i])) {
      if (GIT_DANGEROUS_GLOBAL_PREFIXES.some((p) => tokens[i].startsWith(p))) return false;
      if (tokens[i] === '-C') i += 2;
      else i += 1;
    }
    const sub = tokens[i]?.toLowerCase();
    if (!sub) return false;
    const rest = tokens.slice(i + 1);

    if (rest.some((t) => GIT_DANGEROUS_FLAG_PREFIXES.some((p) => t.startsWith(p)))) return false;

    if (sub === 'fetch' || sub === 'ls-remote') {
      // Only configured remote names — an ad-hoc URL is both an exfiltration
      // channel (data in the URL) and, for exotic schemes, an exec vector.
      return !rest.some(looksLikeRemoteUrl);
    }
    if (GIT_READ_SUBCOMMANDS.has(sub)) return true;
    if (sub === 'branch' || sub === 'tag') {
      // Mutating flags reject outright; bare positional args (create forms
      // like `git branch foo`) are only allowed with an explicit list flag.
      const mutatingFlags = sub === 'branch' ? GIT_BRANCH_MUTATING_FLAGS : GIT_TAG_MUTATING_FLAGS;
      if (rest.some((t) => mutatingFlags.has(t))) return false;
      const hasPositional = rest.some((t) => !isFlag(t));
      const hasListFlag = rest.some((t) => t === '-l' || t === '--list' || t === '--contains' || t === '--merged' || t === '--no-merged' || t === '--points-at');
      return !hasPositional || hasListFlag;
    }
    if (sub === 'remote') return rest.length === 0 || rest[0] === '-v' || rest[0] === 'show' || rest[0] === 'get-url';
    if (sub === 'stash') return rest[0] === 'list' || rest[0] === 'show';
    if (sub === 'config') return rest.some((t) => t === '--get' || t === '--get-all' || t === '--get-regexp' || t === '--list' || t === '-l');
    if (sub === 'worktree') return rest[0] === 'list';
    return false;
  }

  if (cmd === 'gh') {
    const pair2 = tokens.slice(1, 3).join(' ').toLowerCase();
    const pair1 = tokens[1]?.toLowerCase() ?? '';
    return GH_READ_PAIRS.has(pair2) || GH_READ_PAIRS.has(pair1);
  }

  if (cmd === 'npm') {
    const sub = tokens[1]?.toLowerCase();
    return sub ? NPM_READ_SUBCOMMANDS.has(sub) || sub === '--version' || sub === '-v' : false;
  }

  // Version probes for common runtimes are harmless.
  if (['node', 'npx', 'python', 'python3', 'deno', 'bun', 'tsc'].includes(cmd)) {
    return tokens.length === 2 && ['--version', '-v', '-V'].includes(tokens[1]);
  }

  return false;
}

/**
 * True when a Bash command string is recognizably read-only and stays inside
 * the worktree at `cwd`.
 *
 * The command is split on shell operators (&&, ||, ;, |, &, newlines) and every
 * segment must independently pass the allowlist. Output redirection (`>`),
 * command substitution (`$(`, backticks) and process spawning tricks are
 * rejected wholesale — even inside quotes. That over-rejects (e.g. grepping
 * for a literal ">") but never under-rejects; rejected commands simply fall
 * back to the normal permission prompt.
 */
export function isReadOnlyBashCommand(command: string, cwd?: string): boolean {
  if (typeof command !== 'string' || command.trim() === '') return false;
  if (/[>`]|\$\(/.test(command)) return false;
  const segments = command.split(/&&|\|\||[;|&\n]/);
  return segments.every((s) => isReadOnlySimpleCommand(s, cwd));
}

/**
 * True when a tool call is recognizably read-only, scoped to the worktree at
 * `cwd`, and safe to auto-approve in Auto mode. Anything unrecognized returns
 * false and prompts normally.
 */
export function isReadOnlyToolCall(toolName: string, toolInput: unknown, cwd?: string): boolean {
  if (READ_ONLY_TOOLS.has(toolName)) {
    const fields = TOOL_PATH_FIELDS[toolName];
    if (!fields) return true;
    const input = (toolInput ?? {}) as Record<string, unknown>;
    return fields.every((f) => {
      const value = input[f];
      if (value === undefined || value === null) return true; // defaults to cwd
      if (typeof value !== 'string') return false;
      if (!cwd) return false;
      return isPathInside(cwd, path.resolve(cwd, value));
    });
  }
  if (toolName === 'Bash') {
    const command = (toolInput as { command?: unknown } | null)?.command;
    return typeof command === 'string' && isReadOnlyBashCommand(command, cwd);
  }
  return false;
}
