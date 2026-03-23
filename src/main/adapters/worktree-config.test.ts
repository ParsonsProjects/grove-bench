import { describe, it, expect, vi } from 'vitest';
import type { AgentAdapter, AgentCapabilities, AdapterConfig, AgentQueryHandle, ModelInfo, AdapterPrerequisiteStatus } from './types.js';

/**
 * TDD tests for worktree configuration delegation through adapter.
 *
 * Instead of hardcoding `.claude/settings.local.json` generation in
 * worktree-manager.ts, adapters should provide an optional
 * `generateWorktreeSettings(wtPath: string)` method to create
 * their own agent-specific config files in the worktree.
 */

// ─── Mock adapters ───

class ClaudeConfigAdapter implements AgentAdapter {
  readonly id = 'claude-config';
  readonly displayName = 'Claude Config';
  readonly authErrorMessage = 'Auth failed.';
  readonly capabilities: AgentCapabilities = {
    permissions: true, permissionModes: true, resume: true, modelSwitching: true,
    thinking: true, plugins: true, imageAttachments: true, structuredOutput: true, sandbox: true,
  };

  generatedPaths: string[] = [];

  getModels(): ModelInfo[] { return []; }
  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> { return { available: true }; }
  async start(_config: AdapterConfig): Promise<AgentQueryHandle> { throw new Error('Not needed'); }

  async generateWorktreeSettings(wtPath: string): Promise<void> {
    this.generatedPaths.push(wtPath);
    // In real implementation: creates .claude/settings.local.json
  }
}

class MinimalAdapter implements AgentAdapter {
  readonly id = 'minimal';
  readonly displayName = 'Minimal';
  readonly authErrorMessage = 'Auth failed.';
  readonly capabilities: AgentCapabilities = {
    permissions: false, permissionModes: false, resume: false, modelSwitching: false,
    thinking: false, plugins: false, imageAttachments: false, structuredOutput: false, sandbox: false,
  };

  getModels(): ModelInfo[] { return []; }
  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> { return { available: true }; }
  async start(_config: AdapterConfig): Promise<AgentQueryHandle> { throw new Error('Not needed'); }
  // No generateWorktreeSettings — this adapter has no config to generate
}

// ─── Tests ───

describe('Worktree config delegation through adapter', () => {
  it('adapter with generateWorktreeSettings creates config for a worktree path', async () => {
    const adapter = new ClaudeConfigAdapter();
    await adapter.generateWorktreeSettings!('/fake/worktree/path');

    expect(adapter.generatedPaths).toEqual(['/fake/worktree/path']);
  });

  it('adapter without generateWorktreeSettings can be detected', () => {
    const adapter: AgentAdapter = new MinimalAdapter();
    const hasMethod = 'generateWorktreeSettings' in adapter &&
      typeof (adapter as any).generateWorktreeSettings === 'function';
    expect(hasMethod).toBe(false);
  });

  it('worktree-manager pattern: call if available, skip otherwise', async () => {
    // Pattern that worktree-manager.ts should use:
    const adapters: AgentAdapter[] = [new ClaudeConfigAdapter(), new MinimalAdapter()];

    for (const adapter of adapters) {
      if ('generateWorktreeSettings' in adapter && typeof (adapter as any).generateWorktreeSettings === 'function') {
        await (adapter as any).generateWorktreeSettings('/some/path');
      }
      // No error thrown for adapters without the method
    }

    const claude = adapters[0] as ClaudeConfigAdapter;
    expect(claude.generatedPaths).toEqual(['/some/path']);
  });

  it('generateWorktreeSettings can be called multiple times for different worktrees', async () => {
    const adapter = new ClaudeConfigAdapter();
    await adapter.generateWorktreeSettings!('/wt/1');
    await adapter.generateWorktreeSettings!('/wt/2');
    await adapter.generateWorktreeSettings!('/wt/3');

    expect(adapter.generatedPaths).toEqual(['/wt/1', '/wt/2', '/wt/3']);
  });
});
