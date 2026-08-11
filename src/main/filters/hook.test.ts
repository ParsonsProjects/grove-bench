import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';

const hookScript = path.resolve(__dirname, '../../../resources/grove-filter-hook.js');

function runHook(payload: Record<string, unknown>): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node "${hookScript}"`, {
      input: JSON.stringify(payload),
      encoding: 'utf-8',
      timeout: 5000,
    });
    return { stdout, exitCode: 0 };
  } catch (e: any) {
    return { stdout: e.stdout || '', exitCode: e.status || 1 };
  }
}

describe('grove-filter-hook.js', () => {
  it('rewrites filterable git status command', () => {
    const { stdout, exitCode } = runHook({
      tool_input: { command: 'git status' },
    });
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.hookSpecificOutput.updatedInput.command).toContain('grove-filter.js');
    expect(output.hookSpecificOutput.updatedInput.command).toContain('git status');
  });

  it('rewrites filterable npm test command', () => {
    const { stdout } = runHook({
      tool_input: { command: 'npm test' },
    });
    const output = JSON.parse(stdout);
    expect(output.hookSpecificOutput.updatedInput.command).toContain('grove-filter.js');
    expect(output.hookSpecificOutput.updatedInput.command).toContain('npm test');
  });

  it('passes through non-filterable commands silently', () => {
    const { stdout, exitCode } = runHook({
      tool_input: { command: 'echo hello' },
    });
    expect(exitCode).toBe(0);
    // No JSON output — just empty
    expect(stdout.trim()).toBe('');
  });

  it('passes through when no command field', () => {
    const { stdout, exitCode } = runHook({
      tool_input: { file_path: '/some/file.ts' },
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('passes through on invalid JSON input', () => {
    try {
      execSync(`echo "not json" | node "${hookScript}"`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
    } catch (e: any) {
      // Should exit 0 (passthrough) even on bad input
      expect(e.status).toBe(0);
    }
  });

  it('rewrites git diff command', () => {
    const { stdout } = runHook({
      tool_input: { command: 'git diff HEAD~1' },
    });
    const output = JSON.parse(stdout);
    expect(output.hookSpecificOutput.updatedInput.command).toContain('git diff HEAD~1');
  });

  it('does not rewrite git add or git commit', () => {
    const { stdout: addOut } = runHook({
      tool_input: { command: 'git add .' },
    });
    expect(addOut.trim()).toBe('');

    const { stdout: commitOut } = runHook({
      tool_input: { command: 'git commit -m "test"' },
    });
    expect(commitOut.trim()).toBe('');
  });
});
