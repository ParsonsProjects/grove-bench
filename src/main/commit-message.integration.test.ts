/**
 * stagedDiff against real git: what goes into the commit message prompt when
 * the staged diff is over its limit. commit-message.test.ts covers the same
 * with scripted output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stagedDiff } from './commit-message.js';

// Real git is slow to start on Windows.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let repo: string;
const run = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), content);
};

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-commit-'));
  run('init', '-q', '-b', 'main');
  run('config', 'user.name', 't');
  run('config', 'user.email', 't@t');
  run('config', 'core.autocrlf', 'false');
  run('config', 'commit.gpgsign', 'false');
  write('README.md', 'readme\n');
  run('add', '.');
  run('commit', '-qm', 'base');
});

afterEach(() => {
  // Retried: on Windows a git process that just exited can still hold the folder.
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('stagedDiff', () => {
  const lockfile = () => Array.from({ length: 6000 }, (_, i) => `    "node_modules/pkg-${i}": { "version": "1.0.${i}" },`).join('\n') + '\n';

  it('gives the whole staged diff when it fits', async () => {
    write('src/a.ts', 'export const a = 1;\n');
    run('add', '.');
    const { diff, left } = await stagedDiff(repo);
    expect(diff).toContain('+export const a = 1;');
    expect(left).toEqual([]);
  });

  it('keeps the small changes whole and cuts a lockfile that would fill the prompt', async () => {
    // About 300 KB, and it sorts before src/.
    write('package-lock.json', lockfile());
    write('src/a.ts', 'export const a = 1;\n');
    write('src/a[1].ts', 'export const b = 2;\n');
    write('src/a1.ts', 'export const c = 3;\n');
    run('add', '.');

    const { diff, left } = await stagedDiff(repo);
    expect(left).toEqual([]);
    for (const [name, line] of [['src/a.ts', 'a = 1'], ['src/a[1].ts', 'b = 2'], ['src/a1.ts', 'c = 3']]) {
      expect(diff.split(`+++ b/${name}\n`)).toHaveLength(2);
      expect(diff).toContain(`+export const ${line};`);
    }
    expect(diff).toContain('+++ b/package-lock.json');
    expect(diff).toContain('... (cut short)');
    expect(diff.length).toBeLessThanOrEqual(40_000);
  });

  it('shows how a change that is one large file starts', async () => {
    write('src/big.ts', Array.from({ length: 4000 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');
    run('add', '.');
    const { diff, left } = await stagedDiff(repo);
    expect(left).toEqual([]);
    expect(diff).toContain('+export const v0 = 0;');
    expect(diff.length).toBeLessThanOrEqual(40_000);
  });

  it("doesn't run a textconv program on the content", async () => {
    // git-crypt's textconv decrypts; its output mustn't go to a model.
    write('.gitattributes', 'secret.txt diff=reveal\n');
    run('config', 'diff.reveal.textconv', 'sed s/sealed/DECRYPTED/');
    write('secret.txt', 'sealed\n');
    run('add', '.');
    const { diff } = await stagedDiff(repo);
    expect(diff).toContain('+sealed');
    expect(diff).not.toContain('DECRYPTED');
  });

  it('reads a diff over 4 MB again without the lockfile, keeping the change beside it', async () => {
    write('package-lock.json', Array.from({ length: 70_000 }, (_, i) => `    "node_modules/some-package-${i}": { "version": "1.0.${i}" },`).join('\n') + '\n');
    write('app/x.ts', 'export const fixed = true;\n');
    run('add', '.');
    const { diff, left, overLimit } = await stagedDiff(repo);
    expect(overLimit).toBeUndefined();
    expect(left).toEqual(['package-lock.json']);
    expect(diff).toContain('+export const fixed = true;');
    expect(diff).not.toContain('some-package');
  });

  it('keeps a moved file a rename, plain whatever the colour config, from any folder', async () => {
    write('src/util.ts', Array.from({ length: 600 }, (_, i) => `export const u${i} = ${i};`).join('\n') + '\n');
    run('add', '.');
    run('commit', '-qm', 'util');
    fs.mkdirSync(path.join(repo, 'lib'));
    run('mv', 'src/util.ts', 'lib/util.ts');
    write('package-lock.json', lockfile());
    run('add', '.');
    run('config', 'color.ui', 'always');

    const { diff } = await stagedDiff(path.join(repo, 'lib'));
    expect(diff).toContain('rename from src/util.ts');
    expect(diff).not.toContain('+export const u1 = 1;');
    expect(diff).not.toContain('\x1b[');
  });
});
