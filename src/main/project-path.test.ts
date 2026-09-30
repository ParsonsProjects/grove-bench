import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { inspectProjectFolder, projectKind } from './project-path.js';

// Real git in a temp folder: what counts as "in a repository" is git's call.

let root: string;
let savedEnv: Record<string, string | undefined>;
const ENV_KEYS = ['GIT_CEILING_DIRECTORIES', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TEST_ASSUME_DIFFERENT_OWNER'];

beforeEach(async () => {
  // realpath: git reports long, resolved paths (Windows 8.3 temp names, macOS /private).
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-project-')));
  // Stop git looking above the temp folder, in case it sits inside a repo
  // (a dotfiles home, a checkout used as TMPDIR).
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(root);
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe('inspectProjectFolder', () => {
  it('keeps a repository\'s top-level folder as picked', async () => {
    await execa('git', ['init', '-q'], { cwd: root });
    expect(await inspectProjectFolder(root)).toEqual({ kind: 'git', path: root });
  });

  it('turns a folder inside a repository into its top-level folder', async () => {
    await execa('git', ['init', '-q'], { cwd: root });
    const sub = path.join(root, 'src', 'lib');
    fs.mkdirSync(sub, { recursive: true });
    const picked = await inspectProjectFolder(sub);
    expect(picked.kind).toBe('git');
    expect(path.resolve(picked.path)).toBe(path.resolve(root));
  });

  it('adds a folder outside any repository as a plain folder', async () => {
    expect(await inspectProjectFolder(root)).toEqual({ kind: 'folder', path: root });
  });

  it('turns down a .git folder and says to pick the folder that contains it', async () => {
    await execa('git', ['init', '-q'], { cwd: root });
    await expect(inspectProjectFolder(path.join(root, '.git'))).rejects.toThrow(/inside a \.git folder/);
    await expect(inspectProjectFolder(path.join(root, '.git', 'hooks'))).rejects.toThrow(/inside a \.git folder/);
  });

  it('still accepts a bare repository, as before', async () => {
    await execa('git', ['init', '-q', '--bare'], { cwd: root });
    expect(await inspectProjectFolder(root)).toEqual({ kind: 'git', path: root });
  });

  it('passes on git\'s own words when it refuses a real repository', async () => {
    await execa('git', ['init', '-q'], { cwd: root });
    // git's own switch for testing its ownership check.
    process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = '1';
    await expect(inspectProjectFolder(root)).rejects.toThrow(/Git won't open this repository\. Detected dubious ownership.*safe\.directory/s);
  });
});

describe('projectKind', () => {
  it('tells a repository, a plain folder and a missing path apart', async () => {
    expect(await projectKind(root)).toBe('folder');
    await execa('git', ['init', '-q'], { cwd: root });
    expect(await projectKind(root)).toBe('git');
    expect(await projectKind(path.join(root, 'gone'))).toBe('missing');
  });

  it('keeps a repository git refuses as a git project, so its error shows instead of editing in place', async () => {
    await execa('git', ['init', '-q'], { cwd: root });
    process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = '1';
    expect(await projectKind(root)).toBe('git');
  });
});
