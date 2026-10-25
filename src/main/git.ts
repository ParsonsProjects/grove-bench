import { runProcess } from './process-host.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { BranchCommit, CommitEntry, FileDiffResult, GitOperation, GitOpResult, GitSyncStatus } from '../shared/types.js';
import { porcelainRecords } from './git-status-parser.js';
import { isConflictCode } from '../shared/git-conflicts.js';

/** Cap on network git commands (fetch): a dead network must not leave git
 *  processes hanging or block what waits on them. */
export const FETCH_TIMEOUT_MS = 30_000;

export interface GitOptions {
  /** Kill the git process after this many ms (for network commands that can hang). */
  timeout?: number;
  /** Fail, with `isMaxBuffer` set, once git has written more than this many
   *  characters; git ends when it next writes. execa's own limit is 100 MB. */
  maxBuffer?: number;
}

export async function git(args: string[], cwd: string, opts?: GitOptions): Promise<string> {
  const result = await runProcess('git', args, {
    cwd,
    ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    ...(opts?.maxBuffer ? { maxBuffer: opts.maxBuffer } : {}),
  });
  return result.stdout;
}

/** `git <args>`'s exit code and error output, without throwing on a non-zero
 *  exit: for commands whose exit code is the answer (merge-base --is-ancestor). */
export async function gitExit(args: string[], cwd: string): Promise<{ exitCode: number; stderr: string }> {
  const result = await runProcess('git', args, { cwd, reject: false });
  return { exitCode: result.exitCode ?? -1, stderr: String(result.stderr ?? '') };
}

/** Whether `git <args>` exits 0. For yes/no commands such as check-ignore. */
async function gitSucceeds(args: string[], cwd: string): Promise<boolean> {
  const result = await runProcess('git', args, { cwd, reject: false });
  return result.exitCode === 0;
}

/**
 * Keep files Grove writes into a worktree (e.g. `.claude/settings.local.json`)
 * out of `git status` and the agent's `git add -A`: list each in the
 * repository's info/exclude, which all its worktrees share and which is never
 * committed. A file git already ignores, or tracks (where ignoring does
 * nothing), is left alone. Returns the paths it added.
 */
export async function excludeFromGit(cwd: string, relPaths: readonly string[]): Promise<string[]> {
  const added: string[] = [];
  for (const rel of relPaths) {
    if (await gitSucceeds(['ls-files', '--error-unmatch', '--', rel], cwd)) continue;
    if (await gitSucceeds(['check-ignore', '-q', '--', rel], cwd)) continue;
    added.push(rel.replace(/\\/g, '/'));
  }
  if (added.length === 0) return [];

  // In a worktree this is the main repository's .git/info/exclude.
  const excludeFile = path.resolve(cwd, (await git(['rev-parse', '--git-path', 'info/exclude'], cwd)).trim());
  let current = '';
  try {
    current = await fs.readFile(excludeFile, 'utf-8');
  } catch { /* not there yet */ }
  const lead = current && !current.endsWith('\n') ? '\n' : '';
  await fs.mkdir(path.dirname(excludeFile), { recursive: true });
  await fs.appendFile(excludeFile, `${lead}# Written by Grove Bench into each thread's worktree\n${added.map((rel) => `/${rel}`).join('\n')}\n`);
  return added;
}

export async function gitEnv(
  args: string[], cwd: string, env: Record<string, string>
): Promise<string> {
  const result = await runProcess('git', args, { cwd, env: { ...process.env, ...env } });
  return result.stdout;
}

export async function gitVersion(): Promise<{ version: string; major: number; minor: number; patch: number } | null> {
  try {
    const { stdout } = await runProcess('git', ['--version']);
    const match = stdout.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return {
      version: stdout.trim(),
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
    };
  } catch {
    return null;
  }
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await runProcess('git', ['rev-parse', '--git-dir'], { cwd: path });
    return true;
  } catch {
    return false;
  }
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    await runProcess('git', ['rev-parse', '--verify', branch], { cwd });
    return true;
  } catch {
    return false;
  }
}

/** Check if a branch exists locally OR as a remote-tracking ref. */
export async function branchExistsAnywhere(cwd: string, branch: string): Promise<boolean> {
  // Check local first
  if (await branchExists(cwd, branch)) return true;
  // Check remote-tracking refs (e.g. origin/feat/API-1388)
  try {
    const output = await runProcess('git', ['branch', '-r', '--format=%(refname:short)'], { cwd });
    const remotes = output.stdout.split('\n').map(l => l.trim()).filter(Boolean);
    return remotes.some(ref => {
      // Strip remote name prefix (e.g. "origin/feat/foo" → "feat/foo")
      const slash = ref.indexOf('/');
      return slash !== -1 && ref.slice(slash + 1) === branch;
    });
  } catch {
    return false;
  }
}

/** The repository's default branch (what origin/HEAD points at), falling back
 *  to `main`/`master` when the remote HEAD is unknown (no remote, or never
 *  fetched with set-head). Offline-safe — never touches the network. */
export async function getDefaultBranch(cwd: string): Promise<string> {
  try {
    const ref = (await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd)).trim();
    // "origin/main" → "main"
    const slash = ref.indexOf('/');
    if (slash !== -1) return ref.slice(slash + 1);
    if (ref) return ref;
  } catch { /* origin/HEAD not set */ }
  for (const name of ['main', 'master']) {
    if (await branchExistsAnywhere(cwd, name)) return name;
  }
  return 'main';
}

export async function listBranches(cwd: string, opts: { fetch?: boolean } = {}): Promise<string[]> {
  // Fetch latest remote refs (non-blocking — proceed with local cache on failure)
  if (opts.fetch !== false) {
    try { await git(['fetch', '--prune'], cwd, { timeout: FETCH_TIMEOUT_MS }); } catch { /* offline or no remote */ }
  }

  // Get remote names so we can strip their prefix from remote-tracking branches
  let remotes: string[] = [];
  try {
    const remotesOut = await git(['remote'], cwd);
    remotes = remotesOut.split('\n').map(r => r.trim()).filter(Boolean);
  } catch { /* no remotes */ }

  const output = await git(['branch', '-a', '--format=%(refname:short)'], cwd);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of output.split('\n')) {
    let name = raw.trim();
    if (!name) continue;
    // Skip HEAD pointers like "origin/HEAD"
    if (name.endsWith('/HEAD')) continue;
    // Strip remote prefix (e.g. "origin/feature/foo" → "feature/foo")
    for (const remote of remotes) {
      if (name.startsWith(`${remote}/`)) {
        name = name.slice(remote.length + 1);
        break;
      }
    }
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

export async function validateBranchName(name: string): Promise<boolean> {
  try {
    await runProcess('git', ['check-ref-format', '--branch', name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Work out which files a failed merge/rebase/cherry-pick left in conflict:
 * porcelain status first, then `diff --diff-filter=U`, then the CONFLICT
 * lines in git's own message. Falls back to the error text so the caller
 * always has something to show.
 */
async function detectConflicts(cwd: string, opErr: any): Promise<string[]> {
  const errMsg: string = opErr?.stderr || opErr?.message || String(opErr);
  try {
    // -z: names as they are. Without it git quotes and escapes any name
    // outside ASCII ("caf\303\251.ts").
    const conflicts = porcelainRecords(await git(['status', '--porcelain', '-z'], cwd))
      .filter((r) => isConflictCode(r.xy))
      .map((r) => r.path);
    if (conflicts.length > 0) return conflicts;

    // No UU lines — try to extract conflicted files from diff --name-only --diff-filter=U
    const diffOutput = await git(['diff', '--name-only', '--diff-filter=U', '-z'], cwd).catch(() => '');
    const diffConflicts = diffOutput.split('\0').filter(Boolean);
    if (diffConflicts.length > 0) return diffConflicts;

    // Still nothing — extract info from the error message
    // ("CONFLICT (content): Merge conflict in <file>")
    const conflictMatches = [...errMsg.matchAll(/CONFLICT[^:]*:\s*Merge conflict in\s+(.+)/g)];
    if (conflictMatches.length > 0) {
      return conflictMatches.map((m: RegExpMatchArray) => m[1].trim());
    }
    return [errMsg.slice(0, 200)];
  } catch {
    return [errMsg.slice(0, 200)];
  }
}

export async function mergeNoCommit(cwd: string, branch: string): Promise<{ success: boolean; conflicts?: string[] }> {
  try {
    await git(['merge', '--no-commit', '--no-ff', branch], cwd);
    await git(['commit', '-m', `Merge ${branch}`], cwd);
    return { success: true };
  } catch (mergeErr: any) {
    return { success: false, conflicts: await detectConflicts(cwd, mergeErr) };
  }
}

export async function abortMerge(cwd: string): Promise<void> {
  try {
    await git(['merge', '--abort'], cwd);
  } catch { /* no merge in progress */ }
}

// ─── Branch operations (rebase / cherry-pick / squash) ───

/** True when there are no staged, unstaged, or (unless `ignoreUntracked`)
 *  untracked changes. */
export async function isWorkingTreeClean(cwd: string, opts: { ignoreUntracked?: boolean } = {}): Promise<boolean> {
  const status = await git(['status', '--porcelain', ...(opts.ignoreUntracked ? ['--untracked-files=no'] : [])], cwd);
  return status.trim() === '';
}

const DIRTY_TREE_ERROR = 'The working tree has uncommitted changes. Commit or stash them first.';

/** Shared guard for history-rewriting operations. */
async function requireCleanTree(cwd: string): Promise<GitOpResult | null> {
  try {
    if (!(await isWorkingTreeClean(cwd))) return { success: false, error: DIRTY_TREE_ERROR };
  } catch (e: any) {
    return { success: false, error: e?.stderr?.trim() || e?.message || 'git status failed' };
  }
  return null;
}

/** Turn a failed operation into a GitOpResult: conflicts when git left the
 *  tree mid-operation (which `abortArgs` then unwinds), otherwise the error. */
async function failedOp(cwd: string, err: any, abortArgs: string[]): Promise<GitOpResult> {
  const errMsg: string = err?.stderr || err?.message || String(err);
  const looksLikeConflict = /CONFLICT|could not apply|conflict/i.test(errMsg);
  const conflicts = looksLikeConflict ? await detectConflicts(cwd, err) : [];
  // Always unwind so the worktree is usable again; the user can redo the
  // operation in the terminal if they want to resolve by hand.
  await git(abortArgs, cwd).catch(() => {});
  if (conflicts.length > 0 && looksLikeConflict) return { success: false, conflicts };
  return { success: false, error: errMsg.trim().slice(0, 500) };
}

/** Rebase the current branch onto `onto`. Conflicts abort the rebase. */
export async function rebaseOnto(cwd: string, onto: string): Promise<GitOpResult> {
  const dirty = await requireCleanTree(cwd);
  if (dirty) return dirty;
  try {
    await git(['rebase', onto], cwd);
    return { success: true };
  } catch (e: any) {
    return failedOp(cwd, e, ['rebase', '--abort']);
  }
}

/** Apply one commit from anywhere in the repo onto the current branch. */
export async function cherryPick(cwd: string, sha: string): Promise<GitOpResult> {
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) return { success: false, error: `Not a commit id: ${sha}` };
  const dirty = await requireCleanTree(cwd);
  if (dirty) return dirty;
  try {
    await git(['cherry-pick', sha], cwd);
    return { success: true };
  } catch (e: any) {
    return failedOp(cwd, e, ['cherry-pick', '--abort']);
  }
}

/**
 * Squash every commit since the merge base with `base` into one commit with
 * `message`. Uses a soft reset so the tree is untouched; refuses when there
 * are fewer than two commits to squash.
 */
export async function squashSince(cwd: string, base: string, message: string): Promise<GitOpResult> {
  if (!message.trim()) return { success: false, error: 'A commit message is required.' };
  const dirty = await requireCleanTree(cwd);
  if (dirty) return dirty;
  const resolved = await resolveMergeBase(cwd, base);
  if (!resolved) return { success: false, error: `Cannot find a merge base with ${base}.` };
  const { mergeBase } = resolved;
  const count = parseInt((await git(['rev-list', '--count', `${mergeBase}..HEAD`], cwd)).trim(), 10);
  if (!count || count < 2) {
    return { success: false, error: count === 1 ? 'Only one commit since the base — nothing to squash.' : 'No commits since the base.' };
  }
  const head = (await git(['rev-parse', 'HEAD'], cwd)).trim();
  try {
    await git(['reset', '--soft', mergeBase], cwd);
    await git(['commit', '-m', message], cwd);
    return { success: true };
  } catch (e: any) {
    // The commit can fail after the reset (a commit-msg or pre-commit hook,
    // signing): put the branch back, or its commits would be left folded
    // into staged changes. The tree was clean, so this restores it exactly.
    await git(['reset', '--soft', head], cwd).catch(() => {});
    return { success: false, error: e?.stderr?.trim() || e?.message || 'squash failed' };
  }
}

/** Commits reachable from `ref` but not from `base`, newest first, with ids
 *  (for cherry-pick pickers). Falls back to origin/<base> like branchCommits. */
export async function logCommits(cwd: string, ref: string, base: string): Promise<CommitEntry[]> {
  for (const baseRef of [base, `origin/${base}`]) {
    try {
      const raw = await git(['log', '--format=%H%x1f%h%x1f%s%x1e', `${baseRef}..${ref}`], cwd);
      return parseLogCommits(raw);
    } catch { /* base ref missing — try the remote-tracking name */ }
  }
  return [];
}

export function parseLogCommits(raw: string): CommitEntry[] {
  return raw
    .split('\x1e')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [sha = '', shortSha = '', subject = ''] = chunk.split('\x1f');
      return { sha: sha.trim(), shortSha: shortSha.trim(), subject: subject.trim() };
    })
    .filter((c) => c.sha);
}

export async function branchHasRemote(cwd: string, branch: string): Promise<boolean> {
  try {
    const output = await git(['branch', '-r', '--list', `*/${branch}`], cwd);
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export async function renameBranch(cwd: string, oldName: string, newName: string): Promise<void> {
  await git(['branch', '-m', oldName, newName], cwd);
}

/** True when `refs/heads/<branch>` exists. Unlike branchExists, a tag or SHA
 *  with that name doesn't count. */
export async function localBranchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], cwd);
    return true;
  } catch {
    return false;
  }
}

/** The remote-tracking ref for `branch` (e.g. `origin/feat/x`), preferring
 *  origin when several remotes carry it. Null when no remote has it. */
export async function remoteTrackingRef(cwd: string, branch: string): Promise<string | null> {
  let remotes: string[] = [];
  try {
    remotes = (await git(['remote'], cwd)).split('\n').map((r) => r.trim()).filter(Boolean);
  } catch { /* no remotes */ }
  remotes.sort((a, b) => (a === 'origin' ? -1 : b === 'origin' ? 1 : 0));
  for (const remote of remotes) {
    try {
      await git(['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`], cwd);
      return `${remote}/${branch}`;
    } catch { /* not on this remote */ }
  }
  return null;
}

/** Branch name → checkout path for every worktree of the repo that has a
 *  branch checked out (the main checkout included). */
export async function worktreeBranches(repoPath: string): Promise<Map<string, string>> {
  return parseWorktreeBranches(await git(['worktree', 'list', '--porcelain'], repoPath));
}

/** Parse `git worktree list --porcelain`: blocks of `worktree <path>` then
 *  `HEAD <sha>` then `branch refs/heads/<name>` (or `detached`). */
export function parseWorktreeBranches(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  let wtPath: string | null = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('worktree ')) wtPath = trimmed.slice('worktree '.length);
    else if (trimmed.startsWith('branch refs/heads/') && wtPath) out.set(trimmed.slice('branch refs/heads/'.length), wtPath);
    else if (trimmed === '') wtPath = null;
  }
  return out;
}

/** Check out a branch in `cwd`. `create` makes a new branch at HEAD; `track`
 *  (a remote-tracking ref) makes a new local branch following it; otherwise
 *  `branch` must be an existing local branch. Uses `checkout` rather than
 *  `switch`, which needs git 2.23 (the app supports 2.17). */
export async function checkoutBranch(
  cwd: string,
  branch: string,
  opts: { create?: boolean; track?: string } = {},
): Promise<void> {
  if (opts.create) await git(['checkout', '-b', branch], cwd);
  else if (opts.track) await git(['checkout', '-b', branch, '--track', opts.track], cwd);
  // The trailing `--` stops git reading the name as a file path.
  else await git(['checkout', branch, '--'], cwd);
}

/** What `git diff` (working tree against the index) gives a file in
 *  conflict: a combined diff, a column per side, or only this line when one
 *  side deleted it. */
const UNMERGED_DIFF = /^(diff --cc |\* Unmerged path )/;

/**
 * Diff a single file. `staged` selects the index-vs-HEAD diff (`--cached`);
 * otherwise the working-tree-vs-index diff is returned. Returns the raw unified
 * patch (possibly empty, e.g. for an untracked file — see synthesizeUntrackedDiff),
 * or null when it's too large to show (gitPatch).
 */
export async function fileDiff(
  cwd: string,
  relPath: string,
  opts: { staged?: boolean } = {},
): Promise<string | null> {
  const args = opts.staged
    ? ['diff', '--cached', '--', relPath]
    : ['diff', '--', relPath];
  const patch = await gitPatch(args, cwd);
  // A file in conflict has a copy per side in the index rather than one to
  // diff against: show it as it is now, conflict markers and all, against
  // HEAD.
  if (!opts.staged && patch && UNMERGED_DIFF.test(patch)) return gitPatch(['diff', 'HEAD', '--', relPath], cwd);
  return patch;
}

/** Whether git tracks a path (it is in the index), unlike a new or ignored file. */
export async function isTracked(cwd: string, relPath: string): Promise<boolean> {
  try {
    await git(['ls-files', '--error-unmatch', '--', relPath], cwd);
    return true;
  } catch {
    return false;
  }
}

/** Diff a single file against an arbitrary ref (working tree vs `ref`), or
 *  null when it's too large to show (gitPatch). */
export async function fileDiffAgainst(cwd: string, relPath: string, ref: string): Promise<string | null> {
  return gitPatch(['diff', ref, '--', relPath], cwd);
}

/**
 * Resolve the merge base between HEAD and `base`, from whichever of the local
 * branch and `origin/<base>` gives the newer one. A local base that is behind
 * origin (a new worktree starts from origin when the local branch can't be
 * fast-forwarded) would otherwise count the upstream commits the branch
 * started from as its own: in the branch diff, and in what a squash folds in.
 * When they have diverged, the local branch wins.
 */
export async function resolveMergeBase(cwd: string, base: string): Promise<{ ref: string; mergeBase: string } | null> {
  if (!isRefArg(base)) return null;
  let best: { ref: string; mergeBase: string } | null = null;
  for (const ref of [base, `origin/${base}`]) {
    let mergeBase: string;
    try {
      mergeBase = (await git(['merge-base', ref, 'HEAD'], cwd)).trim();
    } catch { continue; /* ref missing */ }
    if (!mergeBase) continue;
    if (!best) {
      best = { ref, mergeBase };
    } else if (mergeBase !== best.mergeBase && (await isAncestor(cwd, best.mergeBase, mergeBase))) {
      best = { ref, mergeBase };
    }
  }
  return best;
}

async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await git(['merge-base', '--is-ancestor', ancestor, descendant], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * The lines of a file as `rev` (a tree or commit, or '' for the index)
 * holds it, for expanding a diff's context. Null when it's over
 * MAX_TEXT_FILE_BYTES, where git is stopped before the rest is read, or
 * binary; throws when `rev` has no such file. Read as raw bytes, so the
 * limit and textLines treat it as they do the working-tree copy.
 */
export async function blobLines(cwd: string, rev: string, relPath: string): Promise<string[] | null> {
  // <rev>:<path> takes forward slashes only.
  const object = `${rev}:${relPath.replace(/\\/g, '/')}`;
  let stdout: Uint8Array;
  try {
    ({ stdout } = await runProcess('git', ['cat-file', 'blob', object], { cwd, encoding: 'buffer', stripFinalNewline: false, maxBuffer: MAX_TEXT_FILE_BYTES }));
  } catch (e) {
    if ((e as { isMaxBuffer?: unknown } | null)?.isMaxBuffer === true) return null;
    throw e;
  }
  return textLines(Buffer.from(stdout));
}

/** Blob hashes of the working-tree content of `relPaths`, in one git call,
 *  one line per path in input order. Git fails the whole call on a path it
 *  cannot open, so callers pass only files that exist and treat a failure as
 *  "hashes unavailable this round". */
export async function hashWorkingFiles(cwd: string, relPaths: string[]): Promise<string> {
  if (relPaths.length === 0) return '';
  const result = await runProcess('git', ['hash-object', '--stdin-paths'], { cwd, input: relPaths.join('\n') + '\n' });
  return result.stdout;
}

/** Larger files aren't read whole to show in a diff or expand its context,
 *  and a larger patch isn't sent to the window. */
export const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;

/** A patch to show, or tooLarge when it's too big to send to the window. */
export function patchResult(patch: string): FileDiffResult {
  const bytes = Buffer.byteLength(patch);
  return bytes > MAX_TEXT_FILE_BYTES ? { kind: 'tooLarge', bytes } : { kind: 'text', patch };
}

/**
 * `git <args>` for a patch to show in a diff, or null when it's too large.
 * Git is stopped once it has written more than `maxChars` characters, plus
 * the final newline execa counts before taking it off. By default that's
 * MAX_TEXT_FILE_BYTES: a character is at least one byte, so the patch is
 * then over the limit and patchResult would turn it away. Reading on (execa
 * reads up to 100 MB, then fails, which showed as "No diff available")
 * would only move a patch that is thrown away into the main process.
 */
export async function gitPatch(args: string[], cwd: string, maxChars = MAX_TEXT_FILE_BYTES): Promise<string | null> {
  try {
    return await git(args, cwd, { maxBuffer: maxChars + 1 });
  } catch (e) {
    if ((e as { isMaxBuffer?: unknown } | null)?.isMaxBuffer === true) return null;
    throw e;
  }
}

/** What a patch gitPatch stopped gives: too large, of unknown size. */
export function patchOverLimit(): FileDiffResult {
  return { kind: 'tooLarge', bytes: MAX_TEXT_FILE_BYTES, atLeast: true };
}

/** True when a git diff describes a binary change rather than a text patch. */
export function detectBinaryDiff(diffOutput: string): boolean {
  return /^Binary files .* differ$/m.test(diffOutput) || diffOutput.includes('GIT binary patch');
}

/** Image extensions previewed as before/after thumbnails. SVG is excluded — it diffs as XML text. */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);

/** Returns the lowercased image extension for a path, or null if it isn't a previewable image. */
export function imageExtFor(relPath: string): string | null {
  const m = relPath.match(/\.([A-Za-z0-9]+)$/);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return IMAGE_EXTS.has(ext) ? ext : null;
}

/** Whether a caller-supplied ref is safe as a positional git argument. A
 *  leading dash would be read as an option (`--output=<file>` makes
 *  `git log` write a file); real branch names can't start with one. */
export function isRefArg(ref: unknown): ref is string {
  return typeof ref === 'string' && ref.length > 0 && !ref.startsWith('-');
}

/** Tracked files plus untracked ones that aren't ignored (new files the
 *  agent hasn't added yet), as real paths. `-z` because without it git quotes
 *  any path with non-ASCII characters (`"caf\303\251.ts"`). */
export async function listProjectFiles(cwd: string): Promise<string[]> {
  const out = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd);
  // A file in a merge conflict is listed once per stage.
  return [...new Set(out.split('\0').filter(Boolean))];
}

/** A relative path as git writes it: on Windows, path.relative gives
 *  backslashes. */
const gitPath = (relPath: string) => (path.sep === '\\' ? relPath.replaceAll('\\', '/') : relPath);

/** A path for a pathspec, read as it is: `[id].tsx` or `*.ts` names that
 *  one file, never others it would match as a pattern. */
const literal = (relPath: string) => `:(literal)${gitPath(relPath)}`;

/**
 * Throw away one file's changes, by git status as it is now. Untracked files,
 * files added with `git add -N`, and files staged as new or as a copy are
 * deleted, since they didn't exist before; a staged change is reset to HEAD
 * in both the index and the working tree; an unstaged change is reset to the
 * index. A file with a merge conflict is refused.
 *
 * A rename is undone: its old path comes back, from HEAD for a staged rename
 * or from the index for one in the worktree (`git add -N`), and then the new
 * path is deleted. `renamedFrom` is the old path the caller showed; if git
 * now says otherwise (an agent changed the index since), nothing is done.
 * Nor while anything is at the old path, which the restore would overwrite:
 * a new file there, a folder the file was moved into, or on Windows the file
 * itself, when only the letter case changed.
 */
export async function revertFile(cwd: string, relPath: string, staged: boolean, renamedFrom?: string): Promise<void> {
  // The whole tree: a rename only reads as one with both its paths in view.
  const record = porcelainRecords(await git(['status', '--porcelain=v1', '-z'], cwd)).find((r) => r.path === gitPath(relPath));
  if (record && isConflictCode(record.xy)) {
    // Neither side is safe: checkout refuses an unmerged path, and rm would
    // delete a file both branches added, HEAD's copy included.
    throw new Error(`${relPath} has a merge conflict. Resolve it, or abort the merge, before reverting.`);
  }
  const code = record?.xy[staged ? 0 : 1];
  const renamedNow = code === 'R' ? record?.origPath : undefined;
  if (renamedNow !== (renamedFrom && gitPath(renamedFrom))) {
    throw new Error(`${relPath} has changed since the list was read. Check it and try again.`);
  }
  if (renamedNow) {
    if (await fs.lstat(path.join(cwd, renamedNow)).then(() => true, () => false)) {
      throw new Error(renamedNow.toLowerCase() === relPath.toLowerCase()
        ? `Can't undo a rename that only changes letter case here. Use git mv in the terminal.`
        : `Can't undo the rename while something is at ${renamedNow}. Move it, then try again.`);
    }
    await git(staged ? ['checkout', 'HEAD', '--', literal(renamedNow)] : ['checkout', '--', literal(renamedNow)], cwd);
    await git(['rm', '-f', '-q', '--', literal(relPath)], cwd);
  } else if (record?.xy === '??') {
    await fs.rm(path.join(cwd, relPath), { force: true, recursive: true });
  } else if (code === 'A' || (staged && code === 'C')) {
    // `git checkout HEAD -- <path>` fails here: the path isn't in HEAD. And
    // an add in the worktree column is a file added with `git add -N`
    // (" A", or "DA" after `git rm --cached`), which has no content in the
    // index, so `git checkout -- <path>` would empty it.
    await git(['rm', '-f', '-q', '--', literal(relPath)], cwd);
  } else if (staged) {
    await git(['checkout', 'HEAD', '--', literal(relPath)], cwd);
  } else {
    await git(['checkout', '--', literal(relPath)], cwd);
  }
}

/** Stage a single path (git add). */
export async function stageFile(cwd: string, relPath: string): Promise<void> {
  // Staging a file in conflict is how git marks it resolved.
  if (await hasLeftoverConflictMarkers(cwd, relPath)) {
    throw new Error(`${relPath} still has conflict markers. Edit them out, then mark it resolved.`);
  }
  await git(['add', '--', literal(relPath)], cwd);
}

/** Whether a file in conflict still has the markers git wrote into it.
 *  `git diff --check` knows a .gitattributes conflict-marker-size too. A
 *  file not in conflict is never refused: its lines are its own. */
async function hasLeftoverConflictMarkers(cwd: string, relPath: string): Promise<boolean> {
  if (!(await git(['ls-files', '--unmerged', '-z', '--', literal(relPath)], cwd))) return false;
  // It exits 2 for whitespace errors as well, so the lines are read.
  const { stdout } = await runProcess('git', ['diff', '--check', '--', literal(relPath)], { cwd, reject: false });
  return /: leftover conflict marker$/m.test(stdout);
}

/** Unstage a single path, leaving working-tree changes intact (git reset HEAD). */
export async function unstageFile(cwd: string, relPath: string): Promise<void> {
  await git(['reset', '-q', 'HEAD', '--', literal(relPath)], cwd);
}

/** Commit the staged changes with the given message. Rejects an empty message. */
export async function commit(cwd: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('Commit message cannot be empty');
  await git(['commit', '-m', message], cwd);
}

/** Push the branch to origin, setting upstream (idempotent when already set). */
export async function push(cwd: string, branch: string): Promise<void> {
  try {
    await git(['push', '--set-upstream', 'origin', branch], cwd);
  } catch (e: any) {
    throw new Error(e?.stderr?.trim() || e?.message || 'git push failed', { cause: e });
  }
}

/** The worktree's own git dir, read from `.git` in `cwd`: a folder, or in a
 *  linked worktree a file naming its folder. Null when there's neither. */
export async function dotGitDir(cwd: string): Promise<string | null> {
  const dotGit = path.join(cwd, '.git');
  const stat = await fs.stat(dotGit).catch(() => null);
  if (stat?.isDirectory()) return dotGit;
  const pointer = stat?.isFile() ? (await fs.readFile(dotGit, 'utf8')).match(/^gitdir:\s*(.+?)\s*$/m) : null;
  return pointer ? path.resolve(cwd, pointer[1]) : null;
}

/** Where git keeps the state of a merge or rebase under way. From `.git`
 *  rather than asked of git, as the status asks on every refresh. */
async function worktreeGitDir(cwd: string): Promise<string> {
  return (await dotGitDir(cwd)) ?? path.resolve(cwd, (await git(['rev-parse', '--git-dir'], cwd)).trim());
}

/**
 * A merge, rebase, cherry-pick or revert stopped part way in `cwd` (on
 * conflicts, or resolved and waiting to be finished), or null. No git call
 * when there is none; `git am` (rebase-apply/applying) isn't one of these.
 */
export async function gitOperation(cwd: string): Promise<GitOperation | null> {
  const gitDir = await worktreeGitDir(cwd);
  const [rebaseMerge, rebaseApply, mergeHead, cherryPickHead, revertHead, sequencerTodo] =
    ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer/todo'].map((f) => path.join(gitDir, f));
  const exists = (p: string) => fs.access(p).then(() => true, () => false);
  const read = (p: string) => fs.readFile(p, 'utf8').then((t) => t.trim(), () => '');

  // A rebase first: it can leave other heads behind while it runs.
  for (const [dir, stepFile, totalFile] of [[rebaseMerge, 'msgnum', 'end'], [rebaseApply, 'next', 'last']] as const) {
    if (!(await exists(dir)) || await exists(path.join(dir, 'applying'))) continue;
    const head = await read(path.join(dir, 'head-name'));
    const onto = await read(path.join(dir, 'onto'));
    const step = parseInt(await read(path.join(dir, stepFile)), 10);
    const total = parseInt(await read(path.join(dir, totalFile)), 10);
    return {
      kind: 'rebase',
      ...(head.startsWith('refs/heads/') ? { branch: head.slice('refs/heads/'.length) } : {}),
      ...(onto ? { incoming: await refName(cwd, onto) } : {}),
      ...(step > 0 && total > 0 ? { step, total } : {}),
    };
  }
  if (await exists(mergeHead)) {
    // Git's own message for the merge commit, without its # comments.
    const message = (await read(path.join(path.dirname(mergeHead), 'MERGE_MSG')))
      .split('\n').filter((l) => !l.startsWith('#')).join('\n').trim();
    const branch = await currentBranch(cwd);
    // "Merge branch 'main' into feat", or from git pull "Merge branch 'main'
    // of C:\Users\Jo Smith\up into feat". A branch's name may hold a quote.
    const named = message.split('\n', 1)[0].trim().match(/^Merge (?:remote-tracking )?branch '(.+?)'(?: of .+?)?(?: into .+)?$/)?.[1];
    return {
      kind: 'merge',
      incoming: named ?? (await read(mergeHead)).slice(0, 7),
      ...(branch ? { branch } : {}),
      ...(message ? { message } : {}),
    };
  }
  if (await exists(cherryPickHead)) return { kind: 'cherry-pick', commit: (await read(cherryPickHead)).slice(0, 7) };
  if (await exists(revertHead)) return { kind: 'revert', commit: (await read(revertHead)).slice(0, 7) };
  // Picking or reverting several commits, between two of them. HEAD has
  // moved since git's last step if a commit was made by hand; if not, git
  // never started the next one, which its --continue would pass over.
  const [command, next] = (await read(sequencerTodo)).split(/\s+/, 2);
  const kind = command === 'pick' ? 'cherry-pick' : command === 'revert' ? 'revert' : null;
  if (!kind) return null;
  const last = await read(path.join(gitDir, 'sequencer', 'abort-safety'));
  if (!last) return { kind };
  return last === (await git(['rev-parse', 'HEAD'], cwd)).trim() ? { kind, passesOver: next } : { kind, byHand: true };
}

/** A branch's name for a commit (`main`, `origin/main`), or its short oid. */
async function refName(cwd: string, oid: string): Promise<string> {
  try {
    const name = (await git(['name-rev', '--name-only', '--no-undefined', '--refs=refs/heads/*', '--refs=refs/remotes/*', oid], cwd)).trim();
    return name.replace(/^remotes\//, '') || oid.slice(0, 7);
  } catch {
    return oid.slice(0, 7);
  }
}

/** git's own words from a failed call. */
function gitErrorText(e: unknown): string {
  const { stderr, message } = (e ?? {}) as { stderr?: string; message?: string };
  return (stderr?.trim() || message || String(e)).slice(0, 500);
}

/**
 * Continue a rebase, cherry-pick or revert whose conflicts are resolved,
 * keeping each commit's own message (no editor opens). Stopping again on
 * the next commit's conflicts isn't a failure: the status shows them. A
 * commit resolved to no change is dropped. A merge is finished with a
 * commit instead.
 */
export async function continueGitOperation(cwd: string, kind: GitOperation['kind']): Promise<void> {
  if (kind === 'merge') throw new Error('A merge is finished with a commit.');
  const op = await gitOperation(cwd);
  if (op?.kind !== kind) throw new Error(`There is no ${kind} to continue: it may have finished already.`);
  const [unmerged, unstaged, nothingStaged] = await Promise.all([
    hasUnmergedPaths(cwd),
    // 1 means changes; an error is left for git's own command to report.
    gitExit(['diff', '--quiet', '--ignore-submodules'], cwd).then((r) => r.exitCode === 1),
    gitExit(['diff', '--cached', '--quiet'], cwd).then((r) => r.exitCode === 0),
  ]);
  if (unmerged) throw new Error('Mark each conflict resolved first.');
  // git refuses with "You must edit all merge conflicts", which misleads.
  if (kind === 'rebase' && unstaged) {
    throw new Error("Stage or undo the changes that aren't staged first: git won't continue a rebase with them.");
  }
  // A pick resolved to no change: git won't make an empty commit, so drop it,
  // as a rebase does itself. Its --skip keeps unstaged changes. Between
  // picks (no commit stopped on) there is none to drop.
  const skip = kind !== 'rebase' && !!op.commit && nothingStaged;
  try {
    await gitEnv([kind, skip ? '--skip' : '--continue'], cwd, { GIT_EDITOR: 'true' });
  } catch (e) {
    // Conflicts now are the next commit's: it stopped again.
    if ((await gitOperation(cwd))?.kind === kind && await hasUnmergedPaths(cwd)) return;
    throw new Error(gitErrorText(e), { cause: e });
  }
}

const hasUnmergedPaths = async (cwd: string) => (await git(['ls-files', '--unmerged'], cwd)).trim() !== '';

/** Abort a merge, rebase, cherry-pick or revert: the branch goes back to how
 *  it was before it started. */
export async function abortGitOperation(cwd: string, kind: GitOperation['kind']): Promise<void> {
  const op = await gitOperation(cwd);
  if (op?.kind !== kind) throw new Error(`There is no ${kind} to abort: it may have finished already.`);
  // git's would only stop, warning "You seem to have moved HEAD", and not
  // fail. The strip offers no Abort then; this is for a stale one.
  if (op.byHand) throw new Error(`A commit was made by hand part way, so git won't take the branch back. Run git ${kind} --quit in the terminal to stop here.`);
  try {
    await git([kind, '--abort'], cwd);
  } catch (e) {
    throw new Error(gitErrorText(e), { cause: e });
  }
}

/** The branch HEAD points at, or null when detached. */
export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const name = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim();
    return name && name !== 'HEAD' ? name : null;
  } catch {
    return null;
  }
}

/** Branches checked out in this checkout since `sinceMs` (epoch ms), most
 *  recent first, from the HEAD reflog. Each worktree keeps its own HEAD
 *  reflog, so this only sees switches made inside that worktree. Detached
 *  checkouts (SHAs) are skipped. */
export async function recentCheckouts(cwd: string, sinceMs: number): Promise<string[]> {
  try {
    const raw = await git(['reflog', 'show', '--date=unix', '--format=%gd%x09%gs', 'HEAD'], cwd);
    return parseCheckoutBranches(raw, sinceMs);
  } catch {
    return [];
  }
}

const REFLOG_CHECKOUT = /^HEAD@\{(\d+)\}\tcheckout: moving from (\S+) to (\S+)$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

/** Parse `git reflog show --date=unix --format=%gd%x09%gs HEAD` output into
 *  the distinct branch names checked out at or after `sinceMs`, most recent
 *  first. Both sides of a checkout count: the "from" branch was checked out
 *  during the window too. */
export function parseCheckoutBranches(raw: string, sinceMs: number): string[] {
  const sinceSec = Math.floor(sinceMs / 1000);
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string) => {
    if (name === 'HEAD' || FULL_SHA.test(name) || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  for (const line of raw.split('\n')) {
    const m = REFLOG_CHECKOUT.exec(line.trim());
    if (!m) continue;
    if (parseInt(m[1], 10) < sinceSec) continue;
    add(m[3]);
    add(m[2]);
  }
  return out;
}

/** Local branch position vs its upstream — no network access, so `behind`
 *  reflects the last fetch. No upstream → the branch was never pushed. */
export async function syncStatus(cwd: string): Promise<GitSyncStatus> {
  let upstream: string | null = null;
  try {
    upstream = (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd)).trim() || null;
  } catch { /* no upstream configured */ }
  if (!upstream) return { upstream: null, ahead: 0, behind: 0 };
  try {
    const counts = await git(['rev-list', '--left-right', '--count', '@{u}...HEAD'], cwd);
    const [behind, ahead] = counts.trim().split(/\s+/).map((n) => parseInt(n, 10));
    return { upstream, ahead: ahead || 0, behind: behind || 0 };
  } catch {
    return { upstream, ahead: 0, behind: 0 };
  }
}

/** Commits on HEAD that aren't on the base branch, newest first. The base
 *  is the local branch or origin/<base>, whichever is further ahead. */
export async function branchCommits(cwd: string, base: string): Promise<BranchCommit[]> {
  // The local base or origin/<base>, whichever is further ahead (see resolveMergeBase).
  const resolved = await resolveMergeBase(cwd, base);
  if (!resolved) return [];
  try {
    return parseBranchCommits(await git(['log', '--format=%s%x1f%b%x1e', `${resolved.ref}..HEAD`], cwd));
  } catch {
    return [];
  }
}

export function parseBranchCommits(raw: string): BranchCommit[] {
  return raw
    .split('\x1e')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const sep = chunk.indexOf('\x1f');
      if (sep === -1) return { subject: chunk.trim(), body: '' };
      return { subject: chunk.slice(0, sep).trim(), body: chunk.slice(sep + 1).trim() };
    });
}

/** MIME type for an image extension (for building data URLs); octet-stream when unknown. */
export function mimeForImageExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'ico': return 'image/x-icon';
    case 'avif': return 'image/avif';
    default: return 'application/octet-stream';
  }
}

/** Heuristic: a file is binary if a NUL byte appears in its leading bytes. */
export function looksBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8000);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** A text file's lines, or null when it looks binary. A final newline ends
 *  the last line rather than starting another. */
export function textLines(buf: Buffer): string[] | null {
  if (looksBinary(buf)) return null;
  const lines = buf.toString('utf-8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Build an all-add unified diff for an untracked file from its content. */
export function synthesizeUntrackedDiff(relPath: string, content: string): string {
  const lines = content.split('\n');
  // A final newline ends the last line rather than starting another (as git counts)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  // An empty file has no lines to show, as in git's diff of one
  if (lines.length === 0) return '';
  const posix = relPath.replace(/\\/g, '/');
  const header = `--- /dev/null\n+++ b/${posix}\n@@ -0,0 +1,${lines.length} @@\n`;
  return header + lines.map(l => `+${l}`).join('\n');
}

/** Read the user's effective git identity. Null unless both user.name and
 *  user.email are set, so callers never commit under a made-up author. */
export async function getGitIdentity(cwd: string): Promise<{ name: string; email: string } | null> {
  let name = '';
  let email = '';
  try {
    name = (await git(['config', 'user.name'], cwd)).trim();
  } catch { /* not set */ }
  try {
    email = (await git(['config', 'user.email'], cwd)).trim();
  } catch { /* not set */ }
  return name && email ? { name, email } : null;
}
