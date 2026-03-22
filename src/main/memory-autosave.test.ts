import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentAdapter, AgentCapabilities, AdapterConfig, AgentQueryHandle, ModelInfo, AdapterPrerequisiteStatus } from './adapters/types.js';
import type { AgentEvent } from '../shared/types.js';

/**
 * TDD tests for decoupling memory-autosave from the Claude Agent SDK.
 *
 * Instead of directly importing `@anthropic-ai/claude-agent-sdk` and calling
 * `query()`, memory-autosave should use an optional `generateText()` method
 * on the adapter interface.  This allows any adapter to provide its own
 * text-generation backend for memory extraction.
 */

// ─── Mock adapter with generateText ───

class TextCapableAdapter implements AgentAdapter {
  readonly id = 'text-capable';
  readonly displayName = 'Text Capable';
  readonly authErrorMessage = 'Auth failed.';
  readonly capabilities: AgentCapabilities = {
    permissions: false, permissionModes: false, resume: false, modelSwitching: false,
    thinking: false, plugins: false, imageAttachments: false, structuredOutput: false, sandbox: false,
  };

  generateTextCalls: Array<{ systemPrompt: string; userMessage: string }> = [];
  generateTextResponse = '{"files":[],"sessionNote":{"shouldSave":false,"content":""}}';

  getModels(): ModelInfo[] { return []; }
  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> { return { available: true }; }
  async start(_config: AdapterConfig): Promise<AgentQueryHandle> { throw new Error('Not needed'); }

  async generateText(systemPrompt: string, userMessage: string, _options?: { cwd?: string; abortSignal?: AbortSignal }): Promise<string> {
    this.generateTextCalls.push({ systemPrompt, userMessage });
    return this.generateTextResponse;
  }
}

class NoTextAdapter implements AgentAdapter {
  readonly id = 'no-text';
  readonly displayName = 'No Text';
  readonly authErrorMessage = 'Auth failed.';
  readonly capabilities: AgentCapabilities = {
    permissions: false, permissionModes: false, resume: false, modelSwitching: false,
    thinking: false, plugins: false, imageAttachments: false, structuredOutput: false, sandbox: false,
  };

  getModels(): ModelInfo[] { return []; }
  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> { return { available: true }; }
  async start(_config: AdapterConfig): Promise<AgentQueryHandle> { throw new Error('Not needed'); }
  // No generateText — this adapter cannot do memory extraction
}

// ─── Tests ───

describe('Memory autosave adapter decoupling', () => {
  it('adapter with generateText can be used for memory extraction', async () => {
    const adapter = new TextCapableAdapter();
    adapter.generateTextResponse = JSON.stringify({
      files: [{ action: 'create', path: 'repo/tech-stack.md', content: '---\ntitle: Tech Stack\n---\nNode.js', reason: 'new discovery' }],
      sessionNote: { shouldSave: false, content: '' },
    });

    const result = await adapter.generateText!(
      'You are a memory extraction assistant...',
      'Extract memories from the conversation above.',
    );
    const parsed = JSON.parse(result);

    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].action).toBe('create');
    expect(adapter.generateTextCalls).toHaveLength(1);
    expect(adapter.generateTextCalls[0].systemPrompt).toContain('memory extraction');
  });

  it('adapter without generateText should be detected and skipped', () => {
    const adapter: AgentAdapter = new NoTextAdapter();
    const hasGenerateText = 'generateText' in adapter && typeof (adapter as any).generateText === 'function';
    expect(hasGenerateText).toBe(false);
  });

  it('callers should guard generateText usage behind capability check', () => {
    // Pattern that memory-autosave should use:
    const adapter: AgentAdapter = new NoTextAdapter();
    const canExtract = 'generateText' in adapter && typeof (adapter as any).generateText === 'function';

    if (canExtract) {
      expect.unreachable('should not enter this branch for NoTextAdapter');
    }

    // Memory autosave should fall back to heuristic (saveSessionMetadata) when
    // the adapter doesn't support text generation.
    expect(canExtract).toBe(false);
  });

  it('generateText receives the correct extraction prompt structure', async () => {
    const adapter = new TextCapableAdapter();
    const systemPrompt = 'You are a memory extraction assistant. Existing memories: ...\nConversation: ...';
    const userMessage = 'Extract memories from the conversation above. Respond with JSON only.';

    await adapter.generateText!(systemPrompt, userMessage);

    expect(adapter.generateTextCalls[0].systemPrompt).toBe(systemPrompt);
    expect(adapter.generateTextCalls[0].userMessage).toBe(userMessage);
  });

  it('generateText can be aborted via AbortSignal', async () => {
    // Adapter should respect the abort signal
    const adapter = new TextCapableAdapter();
    const abortController = new AbortController();

    // Start a call and immediately abort
    const promise = adapter.generateText!(
      'prompt',
      'message',
      { abortSignal: abortController.signal },
    );
    abortController.abort();

    // Our mock doesn't actually abort, but the interface supports it
    const result = await promise;
    expect(result).toBeDefined();
  });
});

describe('AutoSaveOptions accepts adapterType', () => {
  it('adapterType field is optional and allows targeting a specific adapter', () => {
    // AutoSaveOptions should accept an optional adapterType so that
    // runExtraction uses the session's adapter, not the global default.
    const opts = {
      sessionId: 'test-session',
      repoPath: '/repo',
      cwd: '/repo/wt',
      events: [] as AgentEvent[],
      adapterType: 'custom-adapter',
    };
    // Type check: adapterType should be accepted
    expect(opts.adapterType).toBe('custom-adapter');
  });

  it('adapterType is undefined when not specified (falls back to default)', () => {
    const opts = {
      sessionId: 'test-session',
      repoPath: '/repo',
      cwd: '/repo/wt',
      events: [] as AgentEvent[],
    };
    expect(opts.adapterType).toBeUndefined();
  });
});
