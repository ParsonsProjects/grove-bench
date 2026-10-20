import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { shell } from 'electron';
import { normalizeAgentPath, openWorktreeFile, resolveWorktreeFile, worktreeImageResponse } from './worktree-files.js';

// A 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let base: string;
let worktree: string;
let outside: string;

function write(dir: string, rel: string, data: Buffer | string): string {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
}

/** Reported as skipped, not passed, where these checks can't run. */
const NO_SYMLINKS = 'this machine cannot make symlinks';

/** A symlink, or false where the OS won't make one (Windows without rights).
 *  Any other error is a broken fixture, so it fails the test. */
function trySymlink(target: string, at: string): boolean {
  try {
    fs.symlinkSync(target, at);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') return false;
    throw e;
  }
}

beforeEach(() => {
  // .native, like the fs.promises.realpath the code uses: on Windows it also
  // expands short names (RUNNER~1) that the JS realpathSync keeps.
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wtf-')));
  worktree = path.join(base, 'wt');
  outside = path.join(base, 'elsewhere');
  fs.mkdirSync(worktree);
  fs.mkdirSync(outside);
  vi.mocked(shell.openPath).mockClear().mockResolvedValue('');
  vi.mocked(shell.showItemInFolder).mockClear();
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('resolveWorktreeFile', () => {
  it('finds a file by a path relative to the worktree, an absolute one, or a file:// URL', async () => {
    const shot = write(worktree, 'shots/home.png', PNG);
    expect(await resolveWorktreeFile(worktree, 'shots/home.png')).toBe(shot);
    expect(await resolveWorktreeFile(worktree, './shots/../shots/home.png')).toBe(shot);
    expect(await resolveWorktreeFile(worktree, shot)).toBe(shot);
    expect(await resolveWorktreeFile(worktree, pathToFileURL(shot).href)).toBe(shot);
  });

  it('refuses a path outside the worktree', async () => {
    const secret = write(outside, 'secret.png', PNG);
    expect(await resolveWorktreeFile(worktree, secret)).toBeNull();
    expect(await resolveWorktreeFile(worktree, '../elsewhere/secret.png')).toBeNull();
    expect(await resolveWorktreeFile(worktree, pathToFileURL(secret).href)).toBeNull();
  });

  it('refuses a link inside the worktree that leads out of it', async ({ skip }) => {
    const secret = write(outside, 'secret.png', PNG);
    if (!trySymlink(secret, path.join(worktree, 'innocent.png'))) skip(NO_SYMLINKS);
    expect(await resolveWorktreeFile(worktree, 'innocent.png')).toBeNull();
  });

  it('is null for a missing file, an empty path or no worktree', async () => {
    expect(await resolveWorktreeFile(worktree, 'nope.png')).toBeNull();
    expect(await resolveWorktreeFile(worktree, '  ')).toBeNull();
    expect(await resolveWorktreeFile('', 'shots/home.png')).toBeNull();
  });

});

describe('normalizeAgentPath', () => {
  it('reads a Git Bash drive path (/c/...) as a Windows one, on Windows only', () => {
    expect(normalizeAgentPath('/c/Users/me/wt/shot.png', 'win32')).toBe('c:/Users/me/wt/shot.png');
    expect(normalizeAgentPath('/c/Users/me/wt/shot.png', 'linux')).toBe('/c/Users/me/wt/shot.png');
    expect(normalizeAgentPath('/opt/wt/shot.png', 'win32')).toBe('/opt/wt/shot.png');
  });

  it('turns a file:// URL into a path, and refuses a bad one or an empty path', () => {
    const abs = path.resolve('a b.png');
    expect(normalizeAgentPath(pathToFileURL(abs).href, 'linux')).toBe(abs);
    // An encoded slash can't be a path on any OS.
    expect(normalizeAgentPath('file:///a%2Fb.png', 'linux')).toBeNull();
    expect(normalizeAgentPath('   ', 'linux')).toBeNull();
  });
});

describe('worktreeImageResponse', () => {
  it('serves an image with its type, checked again on every load', async () => {
    write(worktree, 'chart.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    write(worktree, 'shot.png', PNG);

    const png = await worktreeImageResponse(worktree, 'shot.png');
    expect(png.status).toBe(200);
    expect(png.headers.get('Content-Type')).toBe('image/png');
    expect(png.headers.get('Cache-Control')).toBe('no-cache');
    expect(Buffer.from(await png.arrayBuffer()).equals(PNG)).toBe(true);

    const svg = await worktreeImageResponse(worktree, 'chart.svg');
    expect(svg.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(svg.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('serves only images', async () => {
    write(worktree, '.env', 'KEY=secret');
    write(worktree, 'notes.txt', 'hi');
    expect((await worktreeImageResponse(worktree, '.env')).status).toBe(404);
    expect((await worktreeImageResponse(worktree, 'notes.txt')).status).toBe(404);
  });

  it('refuses a link named like an image that leads to another file', async ({ skip }) => {
    write(worktree, '.env', 'KEY=secret');
    if (!trySymlink(path.join(worktree, '.env'), path.join(worktree, 'env.png'))) skip(NO_SYMLINKS);
    expect((await worktreeImageResponse(worktree, 'env.png')).status).toBe(404);
  });

  it('is not found for a folder, a missing file or one outside the worktree', async () => {
    fs.mkdirSync(path.join(worktree, 'dir.png'));
    write(outside, 'secret.png', PNG);
    expect((await worktreeImageResponse(worktree, 'dir.png')).status).toBe(404);
    expect((await worktreeImageResponse(worktree, 'gone.png')).status).toBe(404);
    expect((await worktreeImageResponse(worktree, '../elsewhere/secret.png')).status).toBe(404);
  });
});

describe('openWorktreeFile', () => {
  it('hands a web page back to open in the Preview tab', async () => {
    const page = write(worktree, 'report/index.html', '<h1>hi</h1>');
    expect(await openWorktreeFile(worktree, 'report/index.html')).toEqual({ kind: 'preview', url: pathToFileURL(page).href });
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it('hands a Markdown file\'s text back to read in the Focus panel', async () => {
    write(worktree, 'docs/plan.md', '# Plan\n\n1. Fix');
    expect(await openWorktreeFile(worktree, 'docs/plan.md')).toEqual({ kind: 'markdown', content: '# Plan\n\n1. Fix' });
    expect(shell.openPath).not.toHaveBeenCalled();
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it('shows a Markdown file too large to draw in its folder instead', async () => {
    const p = write(worktree, 'huge.md', 'x'.repeat(1024 * 1024 + 1));
    expect(await openWorktreeFile(worktree, 'huge.md')).toEqual({ kind: 'shown' });
    expect(shell.showItemInFolder).toHaveBeenLastCalledWith(p);
  });

  it('opens viewers’ types in their default app', async () => {
    for (const rel of ['r.pdf', 'demo.mp4', 'data.csv', 'deck.pptx', 'shot.png']) {
      const p = write(worktree, rel, 'x');
      expect(await openWorktreeFile(worktree, rel)).toEqual({ kind: 'opened' });
      expect(shell.openPath).toHaveBeenLastCalledWith(p);
    }
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it('only shows anything else in its folder, so a click never runs it', async () => {
    for (const rel of ['run.bat', 'chart.svg', 'macro.xlsm', 'index.ts']) {
      const p = write(worktree, rel, 'x');
      expect(await openWorktreeFile(worktree, rel)).toEqual({ kind: 'shown' });
      expect(shell.showItemInFolder).toHaveBeenLastCalledWith(p);
    }
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it('shows the file in its folder when no app opens it', async () => {
    vi.mocked(shell.openPath).mockResolvedValue('No application is associated');
    const p = write(worktree, 'r.pdf', 'x');
    expect(await openWorktreeFile(worktree, 'r.pdf')).toEqual({ kind: 'shown' });
    expect(shell.showItemInFolder).toHaveBeenCalledWith(p);
  });

  it('opens a folder', async () => {
    fs.mkdirSync(path.join(worktree, 'test-results'));
    expect(await openWorktreeFile(worktree, 'test-results')).toEqual({ kind: 'opened' });
    expect(shell.openPath).toHaveBeenCalledWith(path.join(worktree, 'test-results'));
  });

  it('is missing for a file that is gone or outside the worktree', async () => {
    write(outside, 'r.pdf', 'x');
    expect(await openWorktreeFile(worktree, 'gone.pdf')).toEqual({ kind: 'missing' });
    expect(await openWorktreeFile(worktree, '../elsewhere/r.pdf')).toEqual({ kind: 'missing' });
    expect(shell.openPath).not.toHaveBeenCalled();
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });
});
