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
  write('README.md', 'readme\n');
  run('add', '.');
  run('commit', '-qm', 'base');
});

afterEach(() => {
  // Retried: on Windows a git process that just exited can still hold the folder.
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('stagedDiff', () => {
  it('gives the whole staged diff when it fits', async () => {
    write('src/a.ts', 'export const a = 1;\n');
    run('add', '.');
    const { diff, left } = await stagedDiff(repo);
    expect(diff).toContain('+export const a = 1;');
    expect(left).toEqual([]);
  });

  it('leaves out a lockfile that would fill the prompt, keeping the change around it', async () => {
    // About 300 KB, and it sorts before src/.
    write('package-lock.json', Array.from({ length: 6000 }, (_, i) => `    "node_modules/pkg-${i}": { "version": "1.0.${i}" },`).join('\n') + '\n');
    write('src/a.ts', 'export const a = 1;\n');
    // Glob characters in a name: as a plain pathspec, a[1].ts would match a1.ts too.
    write('src/a[1].ts', 'export const b = 2;\n');
    write('src/a1.ts', 'export const c = 3;\n');
    run('add', '.');

    const { diff, left } = await stagedDiff(repo);
    expect(left).toEqual(['package-lock.json']);
    expect(diff).not.toContain('node_modules/pkg-');
    for (const name of ['src/a.ts', 'src/a[1].ts', 'src/a1.ts']) {
      expect(diff.split(`+++ b/${name}\n`)).toHaveLength(2);
    }
    expect(diff.length).toBeLessThanOrEqual(40_000);
  });
});
