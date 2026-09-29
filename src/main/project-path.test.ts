import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { projectPathFor } from './project-path.js';

// Real git in a temp folder: what counts as "in a repository" is git's call.

let root: string;
let savedCeiling: string | undefined;

beforeEach(async () => {
  // realpath: git reports long, resolved paths (Windows 8.3 temp names, macOS /private).
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-project-')));
  // Stop git looking above the temp folder, in case it sits inside a repo
  // (a dotfiles home, a checkout used as TMPDIR).
  savedCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(root);
});

afterEach(() => {
  if (savedCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
  else process.env.GIT_CEILING_DIRECTORIES = savedCeiling;
  delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('projectPathFor', () => {
  it('keeps a repository\'s top-level folder as picked', async () => {
    await execa('git', ['init', '-q'], { cwd: root });
    expect(await projectPathFor(root)).toBe(root);
  });

  it('turns a folder inside a repository into its top-level folder', async () => {
    await execa('git', ['init', '-q'], { cwd: root });
    const sub = path.join(root, 'src', 'lib');
    fs.mkdirSync(sub, { recursive: true });
    expect(path.resolve(await projectPathFor(sub))).toBe(path.resolve(root));
  });

  it('says what to do with a folder that is not in a repository', async () => {
    await expect(projectPathFor(root)).rejects.toThrow(/isn't in a git repository.*git init/);
  });

  it('turns down a .git folder and says to pick the folder that contains it', async () => {
    await execa('git', ['init', '-q'], { cwd: root });
    await expect(projectPathFor(path.join(root, '.git'))).rejects.toThrow(/inside a \.git folder/);
    await expect(projectPathFor(path.join(root, '.git', 'hooks'))).rejects.toThrow(/inside a \.git folder/);
  });

  it('still accepts a bare repository, as before', async () => {
    await execa('git', ['init', '-q', '--bare'], { cwd: root });
    expect(await projectPathFor(root)).toBe(root);
  });

  it('passes on git\'s own words when it refuses a real repository', async () => {
    await execa('git', ['init', '-q'], { cwd: root });
    // git's own switch for testing its ownership check.
    process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = '1';
    await expect(projectPathFor(root)).rejects.toThrow(/Git won't open this repository\. Detected dubious ownership.*safe\.directory/s);
  });
});
