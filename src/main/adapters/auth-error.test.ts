import { describe, it, expect } from 'vitest';
import type { AgentAdapter, AgentCapabilities, AdapterConfig, AgentQueryHandle, ModelInfo, AdapterPrerequisiteStatus } from './types.js';

/**
 * TDD tests for adapter-provided auth error messages.
 *
 * Instead of hardcoding "Please run 'claude auth login'" in agent-session.ts,
 * each adapter should provide its own auth error message via the
 * `authErrorMessage` property on the adapter interface.
 */

class ClaudeLikeAdapter implements AgentAdapter {
  readonly id = 'claude-like';
  readonly displayName = 'Claude-Like';
  readonly authErrorMessage = 'Authentication failed. Please run "claude auth login" in your terminal and try again.';
  readonly capabilities: AgentCapabilities = {
    permissions: true, permissionModes: true, resume: true, modelSwitching: true,
    thinking: true, plugins: true, imageAttachments: true, structuredOutput: true, sandbox: true,
  };
  getModels(): ModelInfo[] { return []; }
  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> { return { available: true }; }
  async start(_config: AdapterConfig): Promise<AgentQueryHandle> { throw new Error('Not needed'); }
}

class CodexLikeAdapter implements AgentAdapter {
  readonly id = 'codex-like';
  readonly displayName = 'Codex-Like';
  readonly authErrorMessage = 'Authentication failed. Please set the OPENAI_API_KEY environment variable.';
  readonly capabilities: AgentCapabilities = {
    permissions: false, permissionModes: false, resume: false, modelSwitching: false,
    thinking: false, plugins: false, imageAttachments: false, structuredOutput: false, sandbox: false,
  };
  getModels(): ModelInfo[] { return []; }
  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> { return { available: true }; }
  async start(_config: AdapterConfig): Promise<AgentQueryHandle> { throw new Error('Not needed'); }
}

describe('Adapter authErrorMessage', () => {
  it('claude-like adapter provides Claude-specific auth instructions', () => {
    const adapter = new ClaudeLikeAdapter();
    expect(adapter.authErrorMessage).toContain('claude auth login');
  });

  it('codex-like adapter provides OpenAI-specific auth instructions', () => {
    const adapter = new CodexLikeAdapter();
    expect(adapter.authErrorMessage).toContain('OPENAI_API_KEY');
  });

  it('auth error message is a non-empty string on all adapters', () => {
    const adapters = [new ClaudeLikeAdapter(), new CodexLikeAdapter()];
    for (const adapter of adapters) {
      expect(typeof adapter.authErrorMessage).toBe('string');
      expect(adapter.authErrorMessage.length).toBeGreaterThan(0);
    }
  });

  it('agent-session can use adapter.authErrorMessage instead of hardcoded string', () => {
    // Simulates what agent-session.ts should do:
    const adapter: AgentAdapter = new CodexLikeAdapter();
    const errMsg = 'Unauthorized: invalid API key';
    const isAuthError = /auth|unauthorized|401|403|invalid.*key|not.*logged|credential/i.test(errMsg);
    const message = isAuthError ? adapter.authErrorMessage : errMsg;

    expect(message).toBe('Authentication failed. Please set the OPENAI_API_KEY environment variable.');
    expect(message).not.toContain('claude'); // Should NOT contain claude-specific instructions
  });
});
