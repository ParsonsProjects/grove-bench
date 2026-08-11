import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Integration tests for the Claude Code adapter's configureOutputFiltering.
 * We test the actual file writing by calling the method on a temp directory.
 */

// Import the adapter class directly — we need the real implementation
// The adapter requires mocked electron, so we dynamically import
let ClaudeCodeAdapter: any;

describe('configureOutputFiltering', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-filter-test-'));
    // Dynamic import to get the adapter (electron is mocked in test setup)
    const mod = await import('../adapters/claude-code.js');
    ClaudeCodeAdapter = mod.ClaudeCodeAdapter;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes hooks config to settings.local.json', async () => {
    const adapter = new ClaudeCodeAdapter();
    const filterScript = '/path/to/grove-filter.js';
    const hookScript = '/path/to/grove-filter-hook.js';

    // First create base settings (as generateWorktreeSettings would)
    await adapter.generateWorktreeSettings(tmpDir);

    // Then configure output filtering
    await adapter.configureOutputFiltering(tmpDir, filterScript, hookScript);

    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    // Should have PreToolUse hook
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Bash');
    expect(settings.hooks.PreToolUse[0].hooks[0].type).toBe('command');
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain('grove-filter-hook.js');

    // Should preserve existing permissions
    expect(settings.permissions).toBeDefined();
    expect(settings.permissions.deny).toContain('Read(../../**)');
  });

  it('creates settings with hooks even if no prior settings exist', async () => {
    const adapter = new ClaudeCodeAdapter();

    await adapter.configureOutputFiltering(tmpDir, '/filter.js', '/hook.js');

    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Bash');
  });

  it('uses forward slashes in hook command path', async () => {
    const adapter = new ClaudeCodeAdapter();

    await adapter.configureOutputFiltering(tmpDir, 'C:\\path\\filter.js', 'C:\\path\\hook.js');

    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    const command = settings.hooks.PreToolUse[0].hooks[0].command;
    expect(command).not.toContain('\\');
    expect(command).toContain('C:/path/hook.js');
  });
});
