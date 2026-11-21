/**
 * Shortens what a successful shell command printed before the model reads
 * it, for the "Shorten command output" setting. Claude Code only: its
 * PostToolUse hook can replace a tool's output (adapters/claude-shorten-output.ts).
 * The idea is rtk's (https://github.com/rtk-ai/rtk), in TypeScript and for
 * commands that succeeded only: a failing one goes to PostToolUseFailure,
 * which can't change the output.
 *
 * Each command family has its own rules, which drop lines that tell the
 * model little: passing tests, progress lines, git's hints, deprecation
 * notices, build files listed one by one. Most leave a line saying what
 * they dropped, so the model knows something was there. Output is left
 * alone unless every command in it is one Grove knows (or one that prints
 * nothing), it has no pipe (its output is already shaped), and the rules
 * save enough to be worth it. Rules see the whole output, as a chain's
 * outputs can't be told apart, so a chain whose parts need different rules
 * is shortened only when none of them is a diff, which must stay exact.
 *
 * "Succeeded" is the whole command's exit status, which a chain can hide:
 * after `;` or `||` the last part decides. So output is left alone when a
 * part with rules is followed by one of those, and when test output shows
 * a failure or lint output shows an error anyway (a script ending in
 * `|| true`).
 */

import type { OutputFamily } from '../shared/types.js';

/** Which rules apply. git's subcommands print different things. */
type Kind = 'test' | 'lint' | 'git-status' | 'git-diff' | 'git-log' | 'git-remote' | 'install' | 'build';

export interface ShortenedOutput {
  stdout: string;
  stderr: string;
  families: OutputFamily[];
}

/** Below this, output is left alone: too short to be worth it. */
const MIN_CHARS = 800;
/** And the rules have to save at least this much... */
const MIN_SAVED_CHARS = 400;
/** ...and a fifth of the output, rtk's bar for a filter. */
const MIN_SAVED_SHARE = 0.2;

/** Tokens in `chars` characters of output, roughly. rtk counts the same way
 *  (bytes / 4); close enough for English and code, not exact. */
export function estimateTokens(chars: number): number {
  return Math.max(0, Math.round(chars / 4));
}

// ─── Which command ───

const ENV_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Words that run the command after them. */
const WRAPPERS = new Set(['npx', 'bunx', 'pnpx', 'time', 'command', 'exec', 'env', 'sudo']);
const TEST_TOOLS = new Set(['vitest', 'jest', 'mocha', 'pytest', 'py.test', 'ava']);
const LINT_TOOLS = new Set(['tsc', 'vue-tsc', 'svelte-check', 'eslint']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const INSTALL_VERBS = new Set(['install', 'i', 'ci', 'add', 'update', 'up', 'upgrade']);

/** A segment's words, from the program it runs: environment variables,
 *  npx and the like left off, and a path or .exe left off the program. */
function programWords(segment: string): string[] {
  const all = segment.trim().split(/\s+/).map((w) => w.replace(/^['"]|['"]$/g, '')).filter(Boolean);
  let i = 0;
  while (i < all.length) {
    const w = all[i];
    const next = all[i + 1];
    if (ENV_WORD.test(w) || WRAPPERS.has(w)) i++;
    else if ((w === 'pnpm' || w === 'yarn') && (next === 'exec' || next === 'dlx')) i += 2;
    else if ((w === 'uv' || w === 'poetry' || w === 'pipenv') && next === 'run') i += 2;
    else if (/^python[\d.]*$/.test(w) && next === '-m') i += 2;
    else break;
  }
  const words = all.slice(i);
  if (words.length > 0) words[0] = words[0].replace(/^.*[\\/]/, '').replace(/\.(exe|cmd)$/i, '').toLowerCase();
  return words;
}

const TEST_SCRIPT_WORDS = new Set(['test', 'tests', 'spec', 'specs', 'e2e', 'vitest', 'jest']);
const LINT_SCRIPT_WORDS = new Set(['lint', 'eslint', 'typecheck', 'tsc', 'check', 'types']);
const BUILD_SCRIPT_WORDS = new Set(['build', 'compile']);

/** What a package script's name suggests it runs, by its words: `test:main`
 *  and `type-check` count, `inspect` and `healthcheck` don't. */
function scriptKind(name: string | undefined): Kind | null {
  if (!name) return null;
  const words = name.toLowerCase().split(/[:._/-]/);
  if (words.some((w) => TEST_SCRIPT_WORDS.has(w))) return 'test';
  if (words.some((w) => LINT_SCRIPT_WORDS.has(w))) return 'lint';
  if (words.some((w) => BUILD_SCRIPT_WORDS.has(w))) return 'build';
  return null;
}

/** Where git's subcommand is, past its global options: -1 for none. */
function gitSubcommandAt(words: string[]): number {
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === '-C' || w === '-c' || w === '--git-dir' || w === '--work-tree') i++;
    else if (!w.startsWith('-')) return i;
  }
  return -1;
}

function gitKinds(words: string[]): Kind[] {
  const at = gitSubcommandAt(words);
  const args = at < 0 ? [] : words.slice(at + 1).filter((w) => !w.startsWith('-'));
  switch (at < 0 ? undefined : words[at]) {
    case 'status': return ['git-status'];
    case 'diff': return ['git-diff'];
    // `git show HEAD:file` prints a file, which no rule should touch.
    case 'show': return args.some((a) => a.includes(':')) ? [] : ['git-diff', 'git-log'];
    case 'log': return ['git-diff', 'git-log'];
    case 'push':
    case 'pull':
    case 'fetch':
    case 'clone': return ['git-remote'];
    default: return [];
  }
}

function kindsOf(words: string[]): Kind[] {
  const [cmd, sub, third] = words;
  if (!cmd) return [];
  if (TEST_TOOLS.has(cmd)) return ['test'];
  if (LINT_TOOLS.has(cmd)) return ['lint'];
  if (cmd === 'git') return gitKinds(words);
  if (cmd === 'vite') return sub === 'build' ? ['build'] : [];
  if (cmd === 'playwright') return sub === 'test' ? ['test'] : [];
  if (cmd === 'cargo') {
    if (sub === 'test' || sub === 'nextest') return ['test'];
    return sub === 'build' || sub === 'check' || sub === 'clippy' ? ['build'] : [];
  }
  if (cmd === 'go') return sub === 'test' ? ['test'] : [];
  if (cmd === 'pip' || cmd === 'pip3') return sub === 'install' ? ['install'] : [];
  if (cmd === 'uv') return (sub === 'pip' && third === 'install') || sub === 'sync' || sub === 'add' ? ['install'] : [];
  if (PACKAGE_MANAGERS.has(cmd)) {
    const args = words.slice(1).filter((w) => !w.startsWith('-'));
    const [verb, script] = args;
    if (verb === undefined) return cmd === 'yarn' ? ['install'] : [];
    if (INSTALL_VERBS.has(verb)) return ['install'];
    if (verb === 'test' || verb === 't') return ['test'];
    const kind = verb === 'run' || verb === 'run-script' ? scriptKind(script) : scriptKind(verb);
    return kind ? [kind] : [];
  }
  return [];
}

/** Programs that print nothing when they succeed, which a chain can have
 *  without changing what the output is. */
const QUIET = new Set(['cd', 'export', 'set', 'unset', 'mkdir', 'rm', 'cp', 'mv', 'touch', 'true']);

/** Output whose lines must stay exactly as they are, but for the ones a
 *  rule drops: a diff's blank, repeated and trailing-space lines are part
 *  of what changed, and a CRLF file's lines end in a carriage return. */
const EXACT_KINDS: ReadonlySet<Kind> = new Set(['git-diff', 'git-log']);

/** The order rules run in. A diff's rules come before the log's, which
 *  rewrite the commit lines the diff's rules find their way by. */
const RULE_ORDER: readonly Kind[] = ['git-diff', 'git-log', 'git-status', 'git-remote', 'test', 'lint', 'install', 'build'];

/**
 * The rules for a command's output, in the order they run. None when:
 * - its output goes through a pipe (`| tail`, `| grep`), which has shaped it
 * - a part of it is a command Grove doesn't know, which prints what it likes
 * - a part with rules is followed by `;`, `||` or a new line, so the
 *   command can succeed though that part failed
 * - its parts need different rules and one of them is a diff or log
 */
export function outputKinds(command: string): Kind[] {
  if (/(^|[^|])\|(?!\|)/.test(command)) return [];
  const parts = command.split(/(&&|\|\||;|\n)/);
  const segments: Kind[][] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const words = programWords(parts[i]);
    if (words.length === 0) continue;
    const kinds = kindsOf(words);
    if (kinds.length === 0) {
      if (QUIET.has(words[0])) continue;
      return [];
    }
    const next = parts[i + 1];
    const more = parts.slice(i + 2).some((p, j) => j % 2 === 0 && p.trim() !== '');
    if (next !== undefined && next !== '&&' && more) return [];
    segments.push(kinds);
  }
  const all = new Set(segments.flat());
  const mixed = new Set(segments.map((k) => k.join())).size > 1;
  if (mixed && [...all].some((k) => EXACT_KINDS.has(k))) return [];
  return RULE_ORDER.filter((k) => all.has(k));
}

const FAMILY: Record<Kind, OutputFamily> = {
  'test': 'test',
  'lint': 'lint',
  'git-status': 'git',
  'git-diff': 'git',
  'git-log': 'git',
  'git-remote': 'git',
  'install': 'install',
  'build': 'build',
};

// ─── Line rules ───

/** Drop the lines `drop` matches. With `note`, a line saying how many goes
 *  where the first of them was. */
function dropLines(lines: string[], drop: (line: string) => boolean, note?: (count: number) => string): string[] {
  const out: string[] = [];
  let count = 0;
  let noteAt = -1;
  for (const line of lines) {
    if (!drop(line)) {
      out.push(line);
      continue;
    }
    if (count === 0 && note) {
      noteAt = out.length;
      out.push('');
    }
    count++;
  }
  if (note && noteAt >= 0) out[noteAt] = note(count);
  return out;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
/** A note for dropped lines: `[hidden: 3 lines about passing tests]`. */
const hidden = (what: string) => (count: number) => `[hidden: ${plural(count, 'line')} ${what}]`;

// Tests. A pass mark (vitest, jest --verbose, mocha, Playwright), jest's
// PASS line per file, pytest's dots and PASSED lines, cargo's and go's
// per-test lines.
const PASS_MARK = /^\s*[✓✔√]\s(?!built in |\d+ modules transformed)/;
const JEST_PASS = /^\s*PASS\s+\S/;
const PYTEST_PROGRESS = /^\S+\.py\s+[.sx]+\s*(\[\s*\d+%\])?$/;
const PYTEST_PASSED = /^\S+::\S.*\s(PASSED|SKIPPED|XFAIL)(\s+\[\s*\d+%\])?$/;
const PYTEST_HEADER = /^(platform |cachedir: |rootdir: |configfile: |plugins: |testpaths: )/;
const CARGO_OK = /^test \S+ \.\.\. ok$/;
const GO_RUN = /^\s*=== (RUN|PAUSE|CONT|NAME)\s/;
const GO_PASS = /^\s*--- PASS: /;
/** Vitest's block of a test's console output, up to a blank line. */
const CONSOLE_BLOCK = /^(stdout|stderr) \| \S/;

function testRules(lines: string[]): string[] {
  let out = dropConsoleBlocks(lines);
  out = dropLines(out, (l) => PASS_MARK.test(l) || JEST_PASS.test(l) || CARGO_OK.test(l) || GO_PASS.test(l)
    || PYTEST_PROGRESS.test(l) || PYTEST_PASSED.test(l), hidden('about passing tests'));
  out = dropLines(out, (l) => GO_RUN.test(l) || PYTEST_HEADER.test(l));
  return buildRules(out);
}

function dropConsoleBlocks(lines: string[]): string[] {
  const out: string[] = [];
  let blocks = 0;
  let noteAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!CONSOLE_BLOCK.test(lines[i])) {
      out.push(lines[i]);
      continue;
    }
    if (blocks === 0) {
      noteAt = out.length;
      out.push('');
    }
    blocks++;
    while (i + 1 < lines.length && lines[i + 1].trim() !== '') i++;
  }
  if (noteAt >= 0) out[noteAt] = `[hidden: ${plural(blocks, 'block')} of console output from tests]`;
  return out;
}

// Type check and lint. ESLint's problems past the first few in a file;
// svelte-check's banner.
const ESLINT_PROBLEM = /^\s+\d+:\d+\s+(warning|error)\s/;
const ESLINT_KEEP = 3;

/** An ESLint problem line's rule: its last column, after two spaces. Found
 *  by searching the string, as a pattern for it backtracks on long runs of
 *  spaces. */
function eslintRule(line: string): string | null {
  const text = line.trimEnd();
  const at = text.lastIndexOf('  ');
  const rule = at < 0 ? '' : text.slice(at + 2);
  return rule && !/\s/.test(rule) ? rule : null;
}
const SVELTE_CHECK_BANNER = /^(Loading svelte-check in workspace|Getting Svelte diagnostics)|^={10,}$/;

function lintRules(lines: string[]): string[] {
  const out: string[] = [];
  let inFile = 0;
  let rest: string[] = [];
  const flush = () => {
    if (rest.length === 0) return;
    const rules = new Map<string, number>();
    for (const rule of rest) rules.set(rule, (rules.get(rule) ?? 0) + 1);
    const byRule = [...rules].sort((a, b) => b[1] - a[1]).map(([rule, n]) => `${rule} ×${n}`).join(', ');
    out.push(`  [hidden: ${plural(rest.length, 'more problem')} in this file: ${byRule}]`);
    rest = [];
  };
  for (const line of lines) {
    const problem = ESLINT_PROBLEM.exec(line);
    if (!problem) {
      flush();
      inFile = 0;
      if (!SVELTE_CHECK_BANNER.test(line)) out.push(line);
      continue;
    }
    inFile++;
    if (inFile <= ESLINT_KEEP) out.push(line);
    else rest.push(eslintRule(line) ?? problem[1]);
  }
  flush();
  return out;
}

// git status: its "(use "git add <file>..." to ...)" hints.
const GIT_HINT = /^\s+\((?:use |commit or |fix |all conflicts )[^()]*\)$/;

function gitStatusRules(lines: string[]): string[] {
  return dropLines(lines, (l) => GIT_HINT.test(l));
}

// git log and show: each commit's header lines in one, the email and time
// of day left off. The hash stays whole: a short one can be ambiguous.
const LOG_COMMIT = /^commit ([0-9a-f]{7,64})(.*)$/;
const LOG_DATE = /^Date:\s+(.*)$/;
const LOG_MERGE = /^Merge:\s+(.*)$/;

/** The name on an Author: line, without the email. */
function authorOf(line: string): string | null {
  if (!line.startsWith('Author:')) return null;
  const author = line.slice('Author:'.length).trim();
  const email = author.lastIndexOf(' <');
  return email >= 0 && author.endsWith('>') ? author.slice(0, email).trim() : author;
}
const GIT_DATE = /^\w{3} (\w{3}) (\d{1,2}) [\d:]+ (\d{4})/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(date: string): string {
  const m = GIT_DATE.exec(date);
  const month = m ? MONTHS.indexOf(m[1]) + 1 : 0;
  if (!m || month === 0) return date.trim();
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function gitLogRules(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const commit = LOG_COMMIT.exec(lines[i]);
    if (!commit) {
      out.push(lines[i]);
      continue;
    }
    let author = '';
    let date = '';
    let merge = '';
    let j = i + 1;
    for (; j < lines.length; j++) {
      const a = authorOf(lines[j]);
      const d = LOG_DATE.exec(lines[j]);
      const m = LOG_MERGE.exec(lines[j]);
      if (a !== null) author = a;
      else if (d) date = shortDate(d[1]);
      else if (m) merge = `(merge of ${m[1].trim()})`;
      else break;
    }
    // Not git's own header (a custom format): leave it as it is.
    if (!author && !date) {
      out.push(lines[i]);
      continue;
    }
    out.push([commit[1] + commit[2], date, author, merge].filter(Boolean).join(' '));
    // The blank line before the message.
    if (lines[j] === '') j++;
    i = j - 1;
  }
  return out;
}

// git diff: index lines, and the changes to lock files the command didn't
// name. A file's part of a diff ends at the first line that can't be in it,
// such as the blank line before `git log -p`'s next commit.
const DIFF_HEADER = /^diff --git a\/.+ b\/(.+)$/;
const DIFF_BODY = /^(?:[ +\-\\]|@@ |index |(?:new|deleted) file mode |old mode |new mode |(?:dis)?similarity index |rename (?:from|to) |copy (?:from|to) |Binary files )/;
const DIFF_INDEX = /^index [0-9a-f]+\.\.[0-9a-f]+(?: \d+)?$/;
const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'Cargo.lock', 'poetry.lock', 'uv.lock', 'Pipfile.lock', 'Gemfile.lock', 'composer.lock', 'go.sum',
]);

const baseName = (p: string) => p.replace(/^.*[\\/]/, '');

/** Whether the command names a lock file, so its changes are what it asked for. */
function namesLockfile(command: string): boolean {
  return command.split(/\s+/).some((w) => LOCKFILES.has(baseName(w.replace(/^['"]|['"]$/g, ''))));
}

function gitDiffRules(lines: string[], options: RuleOptions): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (DIFF_INDEX.test(line)) continue;
    out.push(line);
    const header = DIFF_HEADER.exec(line);
    if (!header || options.keepLockfiles || !LOCKFILES.has(baseName(header[1]))) continue;
    let added = 0;
    let removed = 0;
    while (i + 1 < lines.length && DIFF_BODY.test(lines[i + 1])) {
      const next = lines[++i];
      if (next.startsWith('+') && !next.startsWith('+++')) added++;
      else if (next.startsWith('-') && !next.startsWith('---')) removed++;
    }
    out.push(`[hidden: changes to this lock file, +${added} -${removed} lines]`);
  }
  return out;
}

// git push, pull, fetch, clone: transfer progress. Other "remote:" lines
// (a link to open a pull request) stay.
const GIT_PROGRESS = /^(?:remote: )?(?:Enumerating objects|Counting objects|Compressing objects|Writing objects|Receiving objects|Resolving deltas|Unpacking objects|Delta compression using up to|Total \d+ \(delta \d+\))|^remote:\s*$/;

function gitRemoteRules(lines: string[]): string[] {
  return dropLines(lines, (l) => GIT_PROGRESS.test(l));
}

// Installs. Deprecation warnings in one line, funding and npm's notices,
// all but pnpm's last progress line, pip's download and resolve lines.
const DEPRECATED = /^(?:npm (?:warn|WARN)|\s*WARN)\s+deprecated (\S+?):/;
const FUNDING = /^\d+ packages? (?:is|are) looking for funding$|^\s+run `npm fund` for details$/;
const NPM_NOTICE = /^npm notice\b/;
const PNPM_PROGRESS = /^Progress: resolved \d+/;
const PLUS_BAR = /^\++-*$/;
const YARN_STEP = /^\[\d+\/\d+\] /;
const PIP_NOISE = /^\s*(?:Collecting |Requirement already satisfied: |Using cached |Downloading |Obtaining |Preparing metadata|Installing build dependencies|Getting requirements to build|Building wheel for|Created wheel for|Stored in directory:|Building wheels for collected packages:)/;
const PROGRESS_BAR = /^\s*[━╸╺─█▏▎▍▌▋▊▉]{3,}/;

function installRules(lines: string[]): string[] {
  const deprecated: string[] = [];
  let noteAt = -1;
  let out: string[] = [];
  for (const line of lines) {
    const d = DEPRECATED.exec(line);
    if (!d) {
      out.push(line);
      continue;
    }
    if (noteAt < 0) {
      noteAt = out.length;
      out.push('');
    }
    deprecated.push(d[1]);
  }
  if (noteAt >= 0) out[noteAt] = `[deprecation warnings for ${plural(deprecated.length, 'package')}: ${deprecated.join(', ')}]`;

  const lastProgress = out.findLastIndex((l) => PNPM_PROGRESS.test(l));
  out = out.filter((l, i) => !(PNPM_PROGRESS.test(l) && i !== lastProgress));
  out = dropLines(out, (l) => FUNDING.test(l) || NPM_NOTICE.test(l) || PLUS_BAR.test(l) || YARN_STEP.test(l) || PROGRESS_BAR.test(l));
  return dropLines(out, (l) => PIP_NOISE.test(l), hidden('of download and resolve progress'));
}

// Builds. cargo's per-crate lines; Vite's steps and its files past the
// largest few.
const CARGO_PROGRESS = /^\s+(?:(?:Compiling|Checking|Downloaded|Fresh|Adding|Removing) \S+ v\d|(?:Updating|Downloading) (?:crates\.io index|crates \.\.\.|`)|Locking \d+ packages?)/;
const VITE_STEP = /^(?:transforming|rendering chunks|computing gzip size)\.\.\.$/;
// One word or more (a path may have single spaces), two spaces or more,
// the size. Written so a long run of spaces can't make it backtrack.
const VITE_FILE_PATTERN = /^\S+(?:\s\S+)*?\s{2,}([\d,]+(?:\.\d+)?) kB(?:\s+│.*)?$/;
const VITE_KEEP = 5;

function viteFile(line: string): RegExpExecArray | null {
  return line.includes(' kB') ? VITE_FILE_PATTERN.exec(line) : null;
}

function buildRules(lines: string[]): string[] {
  let out = dropLines(lines, (l) => CARGO_PROGRESS.test(l), hidden('of cargo progress'));
  out = dropLines(out, (l) => VITE_STEP.test(l));
  const kept: string[] = [];
  for (let i = 0; i < out.length; i++) {
    if (!viteFile(out[i])) {
      kept.push(out[i]);
      continue;
    }
    let end = i;
    while (end + 1 < out.length && viteFile(out[end + 1])) end++;
    const run = out.slice(i, end + 1);
    if (run.length <= VITE_KEEP + 1) {
      kept.push(...run);
    } else {
      const size = (l: string) => Number((viteFile(l)?.[1] ?? '0').replace(/,/g, ''));
      const largest = new Set([...run].sort((a, b) => size(b) - size(a)).slice(0, VITE_KEEP));
      kept.push(`[hidden: ${run.length - VITE_KEEP} smaller output files]`, ...run.filter((l) => largest.has(l)));
    }
    i = end;
  }
  return kept;
}

interface RuleOptions {
  /** Show lock files' changes: the command named one. */
  keepLockfiles: boolean;
}

const RULES: Record<Kind, (lines: string[], options: RuleOptions) => string[]> = {
  'test': testRules,
  'lint': lintRules,
  'git-status': gitStatusRules,
  'git-diff': gitDiffRules,
  'git-log': gitLogRules,
  'git-remote': gitRemoteRules,
  'install': installRules,
  'build': buildRules,
};

// ─── Whole output ───

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** Lines without colour codes, each as a terminal leaves it after
 *  carriage returns redraw it (progress bars), trailing spaces gone. */
function cleanLines(text: string): string[] {
  return text.replace(ANSI, '').split('\n').map((line) => {
    const cr = line.replace(/\r$/, '');
    return cr.slice(cr.lastIndexOf('\r') + 1).trimEnd();
  });
}

/** One blank line at most in a row, none at either end, and a line said
 *  more than twice in a row said once with a count. */
function tidy(lines: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    let repeats = 0;
    while (line !== '' && lines[i + 1] === line) {
      repeats++;
      i++;
    }
    out.push(line);
    if (repeats === 1) out.push(line);
    else if (repeats > 1) out.push(`[the line above ${repeats} more times]`);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

function shortenText(text: string, kinds: Kind[], options: RuleOptions): string {
  if (text.trim() === '') return text;
  const exact = kinds.some((k) => EXACT_KINDS.has(k));
  let lines = exact ? text.replace(ANSI, '').split('\n') : cleanLines(text);
  for (const kind of kinds) lines = RULES[kind](lines, options);
  return exact ? lines.join('\n') : tidy(lines);
}

/** Signs that tests failed, or lint found errors, whatever the exit status
 *  said: vitest's and jest's FAIL and ×, pytest's FAILED and failure
 *  sections, go's --- FAIL, cargo's FAILED result, "2 failed" counts. */
const TEST_FAILED = /^\s*(?:FAIL|FAILED|ERROR)\b|^\s*[×✗✕]\s|^\s*--- FAIL: |^test result: FAILED|\b[1-9]\d* (?:failed|failing|errors?)\b|^=+ (?:FAILURES|ERRORS) =+$/m;
/** ESLint's, tsc's and svelte-check's error counts and tsc's error lines. */
const LINT_FAILED = /\b[1-9]\d* errors?\b|\berror TS\d+/;

function showsFailure(text: string, kinds: Kind[]): boolean {
  return (kinds.includes('test') && TEST_FAILED.test(text)) || (kinds.includes('lint') && LINT_FAILED.test(text));
}

/**
 * `stdout` and `stderr` shortened for the model, or null to leave them as
 * they are: a command Grove has no rules for (see outputKinds), output too
 * short to bother with, tests that failed or lint that found errors, or
 * rules that save too little. `extraChars`: what the caller will add to
 * the short version (a line saying where the full output is), counted
 * against the savings. Never longer than the original, with those added.
 */
export function shortenCommandOutput(command: string, stdout: string, stderr: string, extraChars = 0): ShortenedOutput | null {
  const before = stdout.length + stderr.length;
  if (before < MIN_CHARS) return null;
  const kinds = outputKinds(command);
  if (kinds.length === 0 || showsFailure(stdout, kinds) || showsFailure(stderr, kinds)) return null;
  const options: RuleOptions = { keepLockfiles: namesLockfile(command) };
  const out = shortenText(stdout, kinds, options);
  const err = shortenText(stderr, kinds, options);
  const saved = before - out.length - err.length - extraChars;
  if (saved < MIN_SAVED_CHARS || saved < before * MIN_SAVED_SHARE) return null;
  return { stdout: out, stderr: err, families: [...new Set(kinds.map((k) => FAMILY[k]))] };
}
