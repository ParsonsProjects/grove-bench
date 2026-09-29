import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { projectPathFor } from './project-path.js';

// Real git in a temp folder: what counts as "in a repository" is git's call.

let root: string;

beforeEach(async () => {
  // realpath: git reports long, resolved paths (Windows 8.3 temp names, macOS /private).
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-project-')));
});

afterEach(() => {
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
});
