import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { isUnchecked, needsChecks } from './ci-needs-checks.mjs';

describe('isUnchecked', () => {
  it('leaves out the landing site, top-level Markdown and top-level docs', () => {
    expect(isUnchecked('landing/src/sections/content.js')).toBe(true);
    expect(isUnchecked('README.md')).toBe(true);
    expect(isUnchecked('TODO.md')).toBe(true);
    expect(isUnchecked('docs/projects-plan.md')).toBe(true);
  });

  it('checks the in-app help, other docs files and everything else', () => {
    expect(isUnchecked('docs/help/settings.md')).toBe(false);
    expect(isUnchecked('docs/brand/logo.svg')).toBe(false);
    expect(isUnchecked('src/main/usage-ledger.ts')).toBe(false);
    expect(isUnchecked('src/renderer/README.md')).toBe(false);
    expect(isUnchecked('.github/workflows/ci.yml')).toBe(false);
    expect(isUnchecked('package.json')).toBe(false);
    expect(isUnchecked('landing-notes.txt')).toBe(false);
  });
});

describe('needsChecks', () => {
  it('skips a change to only unchecked files', () => {
    expect(needsChecks(['README.md', 'TODO.md', 'landing/src/sections/content.js'])).toBe(false);
  });

  it('checks once any file needs it', () => {
    expect(needsChecks(['README.md', 'src/main/ipc.ts'])).toBe(true);
  });

  it('checks when no files are listed', () => {
    expect(needsChecks([])).toBe(true);
  });
});

describe('ci.yml', () => {
  it('ignores the same paths on push as the script does on pull requests', () => {
    const yml = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf-8');
    const push = yml.slice(yml.indexOf('push:'), yml.indexOf('pull_request:'));
    const ignored = [...push.matchAll(/^\s+- '([^']+)'$/gm)].map((m) => m[1]);
    expect(ignored).toEqual(['landing/**', '*.md', 'docs/*.md']);
    // A file each pattern matches is one the script leaves out too.
    expect(['landing/x/y.js', 'README.md', 'docs/plan.md'].every(isUnchecked)).toBe(true);
  });

  it('starts the jobs on every pull request', () => {
    const yml = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf-8');
    const pr = yml.slice(yml.indexOf('pull_request:'), yml.indexOf('jobs:'));
    expect(pr).not.toMatch(/paths/);
  });
});
