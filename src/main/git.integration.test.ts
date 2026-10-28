/**
 * git.ts helpers against real git, for behaviour that depends on history
 * shape. git.test.ts covers the same functions with scripted output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveMergeBase, squashSince, branchCommits, MissingBaseError, excludeFromGit, fileDiff, blobLines, mergeNoCommit, revertFile, stageFile, MAX_TEXT_FILE_BYTES, gitOperation, continueGitOperation, abortGitOperation } from './git.js';
import { parseGitStatusPorcelain, parseNumstat } from './git-status-parser.js';

// Real git is slow to start on Windows, and each test runs a dozen commands.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let repo: string;

const run = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const commit = (file: string, message: string) => {
  fs.writeFileSync(path.join(repo, file), `${message}\n`);
  run('add', file);
  run('commit', '-qm', message);
  return run('rev-parse', 'HEAD');
};

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-git-'));
  run('init', '-q', '-b', 'main');
  // In the repo's own config, so the app's git calls see them too: a CI
  // machine has no identity, and Git for Windows turns on autocrlf.
  run('config', 'user.name', 't');
  run('config', 'user.email', 't@t');
  run('config', 'core.autocrlf', 'false');
  commit('base.txt', 'base');
});

afterEach(() => {
  // Retried: on Windows a git process that just exited can still hold the folder.
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/**
 * origin/main is two commits ahead of local main (someone pushed; local was
 * never fast-forwarded), and the conversation's branch started from
 * origin/main, as a new worktree does when local main can't be moved.
 */
function staleLocalBase() {
  run('checkout', '-q', '-b', 'upstream');
  commit('up1.txt', 'upstream 1');
  const originMain = commit('up2.txt', 'upstream 2');
  run('update-ref', 'refs/remotes/origin/main', originMain);
  run('checkout', '-q', '-b', 'grove/feat', originMain);
  commit('m1.txt', 'mine 1');
  commit('m2.txt', 'mine 2');
  return originMain;
}

describe('a local base behind origin', () => {
  it('resolveMergeBase uses origin/<base>', async () => {
    const originMain = staleLocalBase();
    expect(await resolveMergeBase(repo, 'main')).toEqual({ ref: 'origin/main', mergeBase: originMain });
  });

  it('squash folds in only the branch\'s own commits', async () => {
    const originMain = staleLocalBase();

    expect(await squashSince(repo, 'main', 'Mine, squashed')).toEqual({ success: true });

    expect(run('rev-parse', 'HEAD~1')).toBe(originMain);
    expect(run('log', '--format=%s', `${originMain}..HEAD`)).toBe('Mine, squashed');
    expect(run('diff', '--name-only', 'HEAD~1', 'HEAD').split('\n')).toEqual(['m1.txt', 'm2.txt']);
  });

  it('branchCommits lists only the branch\'s own commits', async () => {
    staleLocalBase();
    expect((await branchCommits(repo, 'main')).map((c) => c.subject)).toEqual(['mine 2', 'mine 1']);
  });
});

describe('branchCommits that can\'t list them', () => {
  it('says the base is missing when the repository has no such branch', async () => {
    await expect(branchCommits(repo, 'develop')).rejects.toBeInstanceOf(MissingBaseError);
  });

  it('says only that it failed when the folder is gone', async () => {
    const gone = path.join(repo, 'no-such-folder');
    const err = await branchCommits(gone, 'main').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(MissingBaseError);
  });
});

describe('squash', () => {
  it('puts the branch back when the commit is rejected', async () => {
    commit('m1.txt', 'mine 1');
    commit('m2.txt', 'mine 2');
    const before = run('rev-parse', 'HEAD');
    // A commit-msg hook that rejects every message, like a failing commitlint.
    const hook = path.join(repo, '.git', 'hooks', 'commit-msg');
    fs.writeFileSync(hook, '#!/bin/sh\necho "rejected by hook" >&2\nexit 1\n', { mode: 0o755 });

    const result = await squashSince(repo, 'HEAD~2', 'Squashed');

    expect(result.success).toBe(false);
    expect(run('rev-parse', 'HEAD')).toBe(before);
    expect(run('status', '--porcelain')).toBe('');
  });
});

describe('a merge conflict', () => {
  it('names a conflicted file outside ASCII as it is', async () => {
    commit('café.ts', 'one');
    run('checkout', '-q', '-b', 'other');
    commit('café.ts', 'two');
    run('checkout', '-q', 'main');
    commit('café.ts', 'three');

    const result = await mergeNoCommit(repo, 'other');

    expect(result).toEqual({ success: false, conflicts: ['café.ts'] });
  });
});

describe('a file in conflict', () => {
  it('is diffed against HEAD, markers and all, however it conflicts', async () => {
    commit('gone.txt', 'kept');
    run('checkout', '-q', '-b', 'other');
    commit('both.txt', 'theirs');
    commit('gone.txt', 'changed there');
    run('checkout', '-q', 'main');
    commit('both.txt', 'ours');
    run('rm', '-q', 'gone.txt');
    run('commit', '-qm', 'gone here');
    expect(() => run('merge', '-q', 'other')).toThrow();
    expect(parseGitStatusPorcelain(run('status', '--porcelain=v1', '-z')).entries).toEqual([
      { filePath: 'both.txt', status: 'conflicted', staged: false, conflict: 'AA' },
      { filePath: 'gone.txt', status: 'conflicted', staged: false, conflict: 'DU' },
    ]);

    // Plain `git diff` gives a combined diff for one, and no diff for the other.
    const both = await fileDiff(repo, 'both.txt');
    expect(both).toMatch(/^diff --git /);
    expect(both).toContain('\n+<<<<<<< HEAD\n ours\n+=======\n+theirs\n+>>>>>>> other');
    const gone = await fileDiff(repo, 'gone.txt');
    expect(gone).toContain('new file mode');
    expect(gone).toContain('\n+changed there');
  });
});

describe('marking a conflict resolved', () => {
  it('is refused while the file has conflict markers, of any size, and done once they are gone', async () => {
    fs.writeFileSync(path.join(repo, '.gitattributes'), '*.md conflict-marker-size=12\n');
    run('add', '.gitattributes');
    run('commit', '-qm', 'attributes');
    run('checkout', '-q', '-b', 'other');
    commit('both.txt', 'theirs');
    commit('doc.md', 'theirs');
    run('checkout', '-q', 'main');
    commit('both.txt', 'ours');
    commit('doc.md', 'ours');
    expect(() => run('merge', '-q', 'other')).toThrow();
    expect(fs.readFileSync(path.join(repo, 'doc.md'), 'utf8')).toMatch(/^<{12} HEAD$/m);

    await expect(stageFile(repo, 'both.txt')).rejects.toThrow('both.txt still has conflict markers');
    await expect(stageFile(repo, 'doc.md')).rejects.toThrow('doc.md still has conflict markers');
    // Trailing spaces make `git diff --check` fail too, but aren't markers.
    fs.writeFileSync(path.join(repo, 'both.txt'), 'merged   \n');
    await stageFile(repo, 'both.txt');

    expect(run('status', '--porcelain', '--', 'both.txt')).toBe('M  both.txt');
  });

  it('never refuses a file not in conflict, whatever its lines look like', async () => {
    // Tracked and edited: `git diff --check` would call these markers.
    commit('guide.md', 'guide');
    fs.writeFileSync(path.join(repo, 'guide.md'), '<<<<<<< HEAD\nexample\n>>>>>>> main\n');

    await stageFile(repo, 'guide.md');

    expect(run('status', '--porcelain')).toBe('M  guide.md');
  });
});

describe('line counts', () => {
  it('reads a rename and a name outside ASCII as git status names them', () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
    fs.writeFileSync(path.join(repo, 'café.ts'), 'x\n');
    run('add', '.');
    run('commit', '-qm', 'files');
    run('mv', 'a.txt', 'b.txt');
    fs.appendFileSync(path.join(repo, 'b.txt'), 'three\n');
    run('add', 'b.txt');
    fs.appendFileSync(path.join(repo, 'café.ts'), 'y\n');

    const status = parseGitStatusPorcelain(execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: repo, encoding: 'utf8' }));
    const counts = parseNumstat(execFileSync('git', ['diff', 'HEAD', '--numstat', '-z', '--', 'b.txt', 'a.txt', 'café.ts'], { cwd: repo, encoding: 'utf8' }));

    expect(status.entries.map((e) => e.filePath).sort()).toEqual(['b.txt', 'café.ts']);
    expect(counts).toEqual([
      { path: 'b.txt', additions: 1, deletions: 0, binary: false },
      { path: 'café.ts', additions: 1, deletions: 0, binary: false },
    ]);
  });
});

describe('reverting a rename', () => {
  beforeEach(() => commit('a.txt', 'original'));
  const onDisk = () => fs.readdirSync(repo).filter((f) => f !== '.git').sort();

  it('puts a staged rename back as committed, with its edits gone', async () => {
    run('mv', 'a.txt', 'b.txt');
    fs.appendFileSync(path.join(repo, 'b.txt'), 'staged\n');
    run('add', 'b.txt');
    fs.appendFileSync(path.join(repo, 'b.txt'), 'unstaged\n');

    await revertFile(repo, 'b.txt', true, 'a.txt');

    expect(onDisk()).toEqual(['a.txt', 'base.txt']);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('original\n');
    expect(run('status', '--porcelain')).toBe('');
  });

  it('overwrites nothing at the old path: a new file there', async () => {
    run('mv', 'a.txt', 'b.txt');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a new file\n');

    await expect(revertFile(repo, 'b.txt', true, 'a.txt')).rejects.toThrow('something is at a.txt');

    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('a new file\n');
    expect(run('status', '--porcelain')).toBe('R  a.txt -> b.txt\n?? a.txt');
  });

  it('overwrites nothing at the old path: a folder the file was moved into', async () => {
    fs.mkdirSync(path.join(repo, 'a.tmp'));
    run('mv', 'a.txt', 'a.tmp/index.txt');
    fs.renameSync(path.join(repo, 'a.tmp'), path.join(repo, 'a.txt'));
    run('add', '-A');
    fs.writeFileSync(path.join(repo, 'a.txt', 'helper.txt'), 'untracked\n');

    await expect(revertFile(repo, 'a.txt/index.txt', true, 'a.txt')).rejects.toThrow('something is at a.txt');

    expect(fs.readdirSync(path.join(repo, 'a.txt')).sort()).toEqual(['helper.txt', 'index.txt']);
  });

  it('undoes a rename of letter case only where names are case sensitive, and refuses where they are not', async () => {
    run('mv', 'a.txt', 'A.txt');
    const insensitive = fs.existsSync(path.join(repo, 'a.txt'));

    const reverting = revertFile(repo, 'A.txt', true, 'a.txt');

    if (insensitive) {
      // Windows and macOS: the old name opens the renamed file itself.
      await expect(reverting).rejects.toThrow('only changes letter case');
      expect(onDisk()).toEqual(['A.txt', 'base.txt']);
    } else {
      await reverting;
      expect(onDisk()).toEqual(['a.txt', 'base.txt']);
      expect(run('status', '--porcelain')).toBe('');
    }
  });

  it('does nothing when the rename was unstaged after the list was read', async () => {
    run('mv', 'a.txt', 'b.txt');
    run('reset', '-q');

    await expect(revertFile(repo, 'b.txt', true, 'a.txt')).rejects.toThrow('has changed since the list was read');

    expect(onDisk()).toEqual(['b.txt', 'base.txt']);
  });

  it('puts back a file moved and added with git add -N', async () => {
    fs.renameSync(path.join(repo, 'a.txt'), path.join(repo, 'b.txt'));
    run('add', '-N', 'b.txt');

    await revertFile(repo, 'b.txt', false, 'a.txt');

    expect(onDisk()).toEqual(['a.txt', 'base.txt']);
    expect(run('status', '--porcelain')).toBe('');
  });
});

describe('reverting a file added with git add -N', () => {
  it('deletes it, rather than emptying it', async () => {
    fs.writeFileSync(path.join(repo, 'new.txt'), 'new work\n');
    run('add', '-N', 'new.txt');

    await revertFile(repo, 'new.txt', false);

    expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(false);
    expect(run('status', '--porcelain')).toBe('');
  });

  it('deletes one put back with git add -N after git rm --cached, leaving the delete staged', async () => {
    commit('f.txt', 'committed');
    run('rm', '-q', '--cached', 'f.txt');
    fs.appendFileSync(path.join(repo, 'f.txt'), 'edited\n');
    run('add', '-N', 'f.txt');

    await revertFile(repo, 'f.txt', false);

    expect(fs.existsSync(path.join(repo, 'f.txt'))).toBe(false);
    expect(run('status', '--porcelain')).toBe('D  f.txt');
  });
});

describe('reverting a file with a merge conflict', () => {
  it('refuses, on either side, and changes nothing', async () => {
    run('checkout', '-q', '-b', 'other');
    commit('both.txt', 'theirs');
    run('checkout', '-q', 'main');
    commit('both.txt', 'ours');
    expect(() => run('merge', '-q', 'other')).toThrow();
    const before = fs.readFileSync(path.join(repo, 'both.txt'), 'utf8');

    for (const staged of [true, false]) {
      await expect(revertFile(repo, 'both.txt', staged)).rejects.toThrow('has a merge conflict');
    }

    expect(fs.readFileSync(path.join(repo, 'both.txt'), 'utf8')).toBe(before);
    expect(run('status', '--porcelain')).toBe('AA both.txt');
  });
});

describe('a name with pattern characters', () => {
  it('is taken as it is, never as a pattern that names other files', async () => {
    fs.mkdirSync(path.join(repo, 'pages'));
    commit('pages/i.tsx', 'i');
    fs.appendFileSync(path.join(repo, 'pages', 'i.tsx'), 'edited\n');

    // A list read before [id].tsx went: as a pattern it would match i.tsx.
    await expect(revertFile(repo, 'pages/[id].tsx', false)).rejects.toThrow();
    await stageFile(repo, 'pages/[id].tsx').catch(() => {});

    expect(fs.readFileSync(path.join(repo, 'pages', 'i.tsx'), 'utf8')).toBe('i\nedited\n');
    expect(run('status', '--porcelain')).toBe('M pages/i.tsx');
  });
});

describe('a file diff', () => {
  it('stops git once the patch is over the size limit, rather than reading it all', async () => {
    // A 3.9 MB file with every line changed: a patch of about 8 MB.
    const lines = (word: string) => Array.from({ length: 150_000 }, (_, i) => `${word} ${i} padding padding`).join('\n');
    fs.writeFileSync(path.join(repo, 'big.txt'), lines('old'));
    run('add', 'big.txt');
    run('commit', '-qm', 'big');
    fs.writeFileSync(path.join(repo, 'big.txt'), lines('new'));

    expect(await fileDiff(repo, 'big.txt')).toBeNull();
    fs.writeFileSync(path.join(repo, 'base.txt'), 'changed\n');
    expect(await fileDiff(repo, 'base.txt')).toContain('+changed');
  });
});

describe('a blob\'s lines', () => {
  it('reads the index\'s copy and a tree\'s, as the working-tree copy is read', async () => {
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'one\ntwo\n\n');
    fs.writeFileSync(path.join(repo, 'blank.txt'), '\n');
    run('add', 'notes.txt', 'blank.txt');
    // Changed since it was staged: the index's copy is what's read.
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'changed\n');
    expect(await blobLines(repo, '', 'notes.txt')).toEqual(['one', 'two', '']);
    expect(await blobLines(repo, run('write-tree'), 'notes.txt')).toEqual(['one', 'two', '']);
    expect(await blobLines(repo, '', 'blank.txt')).toEqual(['']);
  });

  it('gives null over the size limit, to the byte, or for a binary file', async () => {
    fs.writeFileSync(path.join(repo, 'at.txt'), 'x'.repeat(MAX_TEXT_FILE_BYTES));
    fs.writeFileSync(path.join(repo, 'over.txt'), 'x'.repeat(MAX_TEXT_FILE_BYTES + 1));
    fs.writeFileSync(path.join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    run('add', 'at.txt', 'over.txt', 'logo.png');
    expect(await blobLines(repo, '', 'at.txt')).toHaveLength(1);
    expect(await blobLines(repo, '', 'over.txt')).toBeNull();
    expect(await blobLines(repo, '', 'logo.png')).toBeNull();
  });

  it("refuses a folder, which isn't a file's lines", async () => {
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'a\n');
    run('add', 'src/a.ts');
    await expect(blobLines(repo, run('write-tree'), 'src')).rejects.toThrow();
  });
});

describe('a local base ahead of origin', () => {
  it('keeps the local base', async () => {
    const originMain = run('rev-parse', 'HEAD');
    run('update-ref', 'refs/remotes/origin/main', originMain);
    const localMain = commit('local.txt', 'local only');
    run('checkout', '-q', '-b', 'grove/feat');
    commit('m1.txt', 'mine 1');

    expect(await resolveMergeBase(repo, 'main')).toEqual({ ref: 'main', mergeBase: localMain });
  });
});

describe("Grove's own files in a worktree", () => {
  const SETTINGS = '.claude/settings.local.json';
  let wt: string;

  beforeEach(() => {
    wt = `${repo}-wt`;
    run('worktree', 'add', '-q', '-b', 'feat', wt);
    fs.mkdirSync(path.join(wt, '.claude'));
    fs.writeFileSync(path.join(wt, SETTINGS), '{}\n');
  });

  afterEach(() => {
    fs.rmSync(wt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  const wtStatus = () => execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim();

  it('are kept out of status and git add -A, through the shared exclude file', async () => {
    expect(wtStatus()).toContain('.claude/');
    expect(await excludeFromGit(wt, [SETTINGS])).toEqual([SETTINGS]);
    expect(wtStatus()).toBe('');
    execFileSync('git', ['add', '-A'], { cwd: wt });
    expect(wtStatus()).toBe('');
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('/.claude/settings.local.json');
  });

  it('are added once, however many worktrees ask', async () => {
    await excludeFromGit(wt, [SETTINGS]);
    expect(await excludeFromGit(wt, [SETTINGS])).toEqual([]);
    const lines = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n');
    expect(lines.filter((l) => l === '/.claude/settings.local.json')).toHaveLength(1);
  });

  it('are left alone when the project already ignores them', async () => {
    fs.writeFileSync(path.join(wt, '.gitignore'), '.claude/settings.local.json\n');
    expect(await excludeFromGit(wt, [SETTINGS])).toEqual([]);
  });

  it('are left alone when the project tracks them', async () => {
    execFileSync('git', ['add', SETTINGS], { cwd: wt });
    execFileSync('git', ['commit', '-qm', 'track settings'], { cwd: wt });
    expect(await excludeFromGit(wt, [SETTINGS])).toEqual([]);
  });
});

// Started by the agent or in a terminal: the Changes tab says so and can
// finish or back out of it.
describe('a merge, rebase, cherry-pick or revert stopped part way', () => {
  const write = (file: string, text: string) => fs.writeFileSync(path.join(repo, file), text);
  const tryRun = (...args: string[]) => { try { run(...args); } catch { /* stops on conflicts */ } };
  /** main and feat both change base.txt; feat has `extra` more commits after. */
  const diverge = (extra = 0) => {
    run('checkout', '-q', '-b', 'feat');
    commit('base.txt', 'feat');
    for (let i = 1; i <= extra; i++) { write('base.txt', `feat ${i}\n`); run('commit', '-qam', `feat ${i}`); }
    run('checkout', '-q', 'main');
    commit('base.txt', 'main');
    run('checkout', '-q', 'feat');
  };

  it('reports nothing when none is under way', async () => {
    expect(await gitOperation(repo)).toBeNull();
  });

  it('reports a merge, with what comes in and git\'s message', async () => {
    diverge();
    tryRun('merge', 'main');
    expect(await gitOperation(repo)).toEqual({ kind: 'merge', incoming: 'main', branch: 'feat', message: "Merge branch 'main' into feat" });
  });

  it("reads a merged branch's name that holds a quote", async () => {
    diverge();
    run('branch', "it's-done", 'main');
    tryRun('merge', "it's-done");
    expect(await gitOperation(repo)).toMatchObject({ incoming: "it's-done", message: "Merge branch 'it's-done' into feat" });
  });

  it('reads what git pull merges, from a path with a space, and names a merged commit by its id', async () => {
    const upstream = `${repo} up`;
    execFileSync('git', ['clone', '-q', repo, upstream]);
    try {
      fs.writeFileSync(path.join(upstream, 'base.txt'), 'theirs\n');
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'theirs'], { cwd: upstream });
      commit('base.txt', 'ours');
      tryRun('pull', '-q', '--no-rebase', upstream, 'main');
      // "Merge branch 'main' of /tmp/gb-git-x up"
      expect(await gitOperation(repo)).toMatchObject({ kind: 'merge', incoming: 'main' });
    } finally {
      fs.rmSync(upstream, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    run('merge', '--abort');
    diverge();
    const oid = run('rev-parse', 'main');
    tryRun('merge', oid);
    // "Merge commit '<oid>'"
    expect(await gitOperation(repo)).toMatchObject({ kind: 'merge', incoming: oid.slice(0, 7) });
  });

  it('reports a rebase, with its step', async () => {
    diverge(1);
    tryRun('rebase', 'main');
    expect(await gitOperation(repo)).toEqual({ kind: 'rebase', branch: 'feat', incoming: 'main', step: 1, total: 2 });
  });

  it('reports one in a linked worktree, whose state is in its own git dir', async () => {
    diverge();
    run('checkout', '-q', 'main');
    const wt = path.join(repo, '..', `${path.basename(repo)}-wt`);
    run('worktree', 'add', '-q', wt, 'feat');
    try {
      try { execFileSync('git', ['merge', 'main'], { cwd: wt, stdio: 'ignore' }); } catch { /* conflicts */ }
      expect(await gitOperation(wt)).toMatchObject({ kind: 'merge', incoming: 'main', branch: 'feat' });
      expect(await gitOperation(repo)).toBeNull();
    } finally {
      fs.rmSync(wt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it('continues a rebase step by step, keeping each message, and only once resolved', async () => {
    diverge(1);
    tryRun('rebase', 'main');
    await expect(continueGitOperation(repo, 'rebase')).rejects.toThrow('Mark each conflict resolved first.');

    write('base.txt', 'resolved\n');
    run('add', 'base.txt');
    // The next commit conflicts too: it stops there, which is no failure.
    await continueGitOperation(repo, 'rebase');
    expect(await gitOperation(repo)).toMatchObject({ kind: 'rebase', step: 2, total: 2 });

    write('base.txt', 'resolved again\n');
    run('add', 'base.txt');
    await continueGitOperation(repo, 'rebase');
    expect(await gitOperation(repo)).toBeNull();
    expect(run('log', '--format=%s', '-3').split('\n')).toEqual(['feat 1', 'feat', 'main']);
  });

  it('reports and continues a cherry-pick', async () => {
    diverge();
    const fromMain = run('rev-parse', 'main');
    tryRun('cherry-pick', fromMain);
    expect(await gitOperation(repo)).toEqual({ kind: 'cherry-pick', commit: fromMain.slice(0, 7) });
    write('base.txt', 'both\n');
    run('add', 'base.txt');
    await continueGitOperation(repo, 'cherry-pick');
    expect(await gitOperation(repo)).toBeNull();
    expect(run('log', '-1', '--format=%s')).toBe('main');
  });

  it('drops a cherry-pick resolved to no change, as a rebase does, keeping changes not staged', async () => {
    commit('notes.txt', 'notes');
    diverge();
    const before = run('rev-parse', 'HEAD');
    tryRun('cherry-pick', run('rev-parse', 'main'));
    run('checkout', '--ours', 'base.txt');
    run('add', 'base.txt');
    write('notes.txt', 'my edit\n');

    await continueGitOperation(repo, 'cherry-pick');
    expect(await gitOperation(repo)).toBeNull();
    expect(run('rev-parse', 'HEAD')).toBe(before);
    expect(fs.readFileSync(path.join(repo, 'notes.txt'), 'utf8')).toBe('my edit\n');
  });

  it("won't continue a rebase with changes not staged, and leaves them be", async () => {
    // git would refuse too, saying to "edit all merge conflicts". Its --skip
    // (once tried here when nothing was staged) resets them away.
    commit('notes.txt', 'notes');
    diverge();
    tryRun('rebase', 'main');
    run('checkout', '--ours', 'base.txt');
    run('add', 'base.txt');
    write('notes.txt', 'my edit\n');

    await expect(continueGitOperation(repo, 'rebase')).rejects.toThrow("Stage or undo the changes that aren't staged first: git won't continue a rebase with them.");
    expect(await gitOperation(repo)).toMatchObject({ kind: 'rebase', step: 1 });
    expect(fs.readFileSync(path.join(repo, 'notes.txt'), 'utf8')).toBe('my edit\n');
  });

  it('drops a rebase step resolved to no change, as git does itself', async () => {
    diverge();
    commit('extra.txt', 'extra');
    tryRun('rebase', 'main');
    run('checkout', '--ours', 'base.txt');
    run('add', 'base.txt');

    await continueGitOperation(repo, 'rebase');
    expect(await gitOperation(repo)).toBeNull();
    expect(run('log', '--format=%s', '-3').split('\n')).toEqual(['extra', 'main', 'base']);
  });

  it("leaves skipping one to git with the apply backend, which can't tell it from a step it never applied", async () => {
    diverge();
    tryRun('rebase', '--apply', 'main');
    run('checkout', '--ours', 'base.txt');
    run('add', 'base.txt');

    // git says why, and to run --skip: on stdout, or its hints on stderr in
    // newer versions (2.56 on CI).
    await expect(continueGitOperation(repo, 'rebase')).rejects.toThrow(/No changes[\s\S]*git rebase --skip/);
    expect(await gitOperation(repo)).toMatchObject({ kind: 'rebase' });
  });

  it('reports a commit git never started between picks, which continuing skips', async () => {
    run('checkout', '-q', '-b', 'side');
    commit('a.txt', 'A');
    const b = commit('b.txt', 'B');
    run('checkout', '-q', 'main');
    write('b.txt', 'in the way\n');
    tryRun('cherry-pick', 'side~1', 'side');
    // git's short id for it, from its list of picks.
    const short = (await gitOperation(repo))?.passesOver ?? '';
    expect(short.length).toBeGreaterThanOrEqual(7);
    expect(await gitOperation(repo)).toEqual({ kind: 'cherry-pick', passesOver: b.slice(0, short.length) });
    fs.rmSync(path.join(repo, 'b.txt'));

    // As the strip says ("Skip <commit>"): git's --continue passes over it.
    await continueGitOperation(repo, 'cherry-pick');
    expect(await gitOperation(repo)).toBeNull();
    expect(run('log', '--format=%s', '-2').split('\n')).toEqual(['A', 'base']);
  });

  it('reports picking several commits between two of them, and continues with the rest', async () => {
    diverge();
    run('checkout', '-q', 'main');
    commit('extra.txt', 'extra');
    run('checkout', '-q', 'feat');
    tryRun('cherry-pick', 'main~1', 'main');
    write('base.txt', 'both\n');
    run('add', 'base.txt');
    // Committed by hand: git keeps only the list of picks still to come.
    run('commit', '-q', '--no-edit');
    expect(await gitOperation(repo)).toEqual({ kind: 'cherry-pick', byHand: true });
    // git's abort wouldn't take the branch back now, only stop.
    await expect(abortGitOperation(repo, 'cherry-pick')).rejects.toThrow("A commit was made by hand part way, so git won't take the branch back. Run git cherry-pick --quit in the terminal to stop here.");
    expect(await gitOperation(repo)).toEqual({ kind: 'cherry-pick', byHand: true });

    await continueGitOperation(repo, 'cherry-pick');
    expect(await gitOperation(repo)).toBeNull();
    expect(run('log', '--format=%s', '-3').split('\n')).toEqual(['extra', 'main', 'feat']);
  });

  it('aborts each kind back to where it started', async () => {
    diverge(1);
    const before = run('rev-parse', 'HEAD');
    tryRun('rebase', 'main');
    await abortGitOperation(repo, 'rebase');
    tryRun('merge', 'main');
    await abortGitOperation(repo, 'merge');
    tryRun('revert', '--no-edit', 'HEAD~1');
    expect(await gitOperation(repo)).toMatchObject({ kind: 'revert' });
    await abortGitOperation(repo, 'revert');

    expect(await gitOperation(repo)).toBeNull();
    expect(run('rev-parse', 'HEAD')).toBe(before);
    expect(run('status', '--porcelain')).toBe('');
  });

  it('says so when there is nothing of that kind to continue or abort', async () => {
    await expect(continueGitOperation(repo, 'rebase')).rejects.toThrow('There is no rebase to continue: it may have finished already.');
    await expect(abortGitOperation(repo, 'merge')).rejects.toThrow('There is no merge to abort: it may have finished already.');
  });
});
