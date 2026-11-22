import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { agentFolders, linkInstructionFiles } from './linked-projects.js';

const p = (...parts: string[]) => path.resolve('/', ...parts);
const link = (repo: string, wt: string) => ({ repoPath: p(repo), path: p(wt), branch: 'feature' });

describe('agentFolders', () => {
  it('lists the linked worktrees, then the setting folders, each once and absolute', () => {
    const folders = agentFolders(p('wt', 'a1'), [p('shared'), 'relative/dir', '  ', p('shared') + path.sep, p('wt', 'b1')], [link('code/b', 'wt/b1')]);
    expect(folders.additionalDirectories).toEqual([p('wt', 'b1'), p('shared')]);
  });

  it("skips folders inside the thread's own, which the agent has already", () => {
    expect(agentFolders(p('wt', 'a1'), [p('wt', 'a1', 'docs'), p('wt', 'a1')], []).additionalDirectories).toEqual([]);
  });

  it("protects each linked project's own folder from edits", () => {
    const folders = agentFolders(p('wt', 'a1'), [], [link('code/b', 'wt/b1'), link('code/c', 'wt/c1')]);
    expect(folders.protectedEditRoots).toEqual([p('code', 'b'), p('code', 'c')]);
  });

  it('leaves a project folder unprotected when its worktree, or the thread, is inside it', () => {
    // A worktree folder set inside the project (Settings > Git).
    expect(agentFolders(p('wt', 'a1'), [], [link('code/b', 'code/b/.wt/b1')]).protectedEditRoots).toEqual([]);
    expect(agentFolders(p('code', 'b', 'sub'), [], [link('code/b', 'wt/b1')]).protectedEditRoots).toEqual([]);
  });

  it('has nothing to add for a thread with no links and no setting folders', () => {
    expect(agentFolders(p('wt', 'a1'), [], [])).toEqual({ additionalDirectories: [], protectedEditRoots: [] });
  });
});

describe('linkInstructionFiles', () => {
  const has = (...names: string[]) => (p: string) => names.includes(path.basename(p));

  it("names only an AGENTS.md standing in for CLAUDE.md to an agent that loads CLAUDE.md itself", () => {
    expect(linkInstructionFiles('/wt/b1', true, has('AGENTS.md'))).toEqual(['AGENTS.md']);
    expect(linkInstructionFiles('/wt/b1', true, has('CLAUDE.md', 'AGENTS.md'))).toEqual([]);
    expect(linkInstructionFiles('/wt/b1', true, has())).toEqual([]);
  });

  it('names both to any other agent', () => {
    expect(linkInstructionFiles('/wt/b1', false, has('CLAUDE.md', 'AGENTS.md'))).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(linkInstructionFiles('/wt/b1', false, has('CLAUDE.md'))).toEqual(['CLAUDE.md']);
  });
});
