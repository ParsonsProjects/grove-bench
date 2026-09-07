/**
 * Tests for Mistral adapter
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { MistralAdapter, transformMistralEvent } from './mistral-agent.js';
import type { AgentEvent } from '../../shared/types.js';

// Mock the logger module to prevent file system access during tests
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('MistralAdapter', () => {
  describe('constructor', () => {
    it('should have correct id and display name', () => {
      const adapter = new MistralAdapter();
      expect(adapter.id).toBe('mistral');
      expect(adapter.displayName).toBe('Mistral');
    });

    it('should have correct capabilities', () => {
      const adapter = new MistralAdapter();
      expect(adapter.capabilities.permissions).toBe(true);
      expect(adapter.capabilities.permissionModes).toBe(false);
      expect(adapter.capabilities.resume).toBe(true);
      expect(adapter.capabilities.modelSwitching).toBe(true);
      expect(adapter.capabilities.thinking).toBe(true);
      expect(adapter.capabilities.plugins).toBe(false);
      expect(adapter.capabilities.imageAttachments).toBe(true);
      expect(adapter.capabilities.structuredOutput).toBe(true);
      expect(adapter.capabilities.sandbox).toBe(false);
    });

    it('should have correct auth error message', () => {
      const adapter = new MistralAdapter();
      expect(adapter.authErrorMessage).toContain('MISTRAL_API_KEY');
      expect(adapter.authErrorMessage).toContain('https://console.mistral.ai/');
    });
  });

  describe('getModels', () => {
    it('should return Mistral models', () => {
      const adapter = new MistralAdapter();
      const models = adapter.getModels();
      expect(models).toBeDefined();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'codestral-latest')).toBe(true);
      expect(models.some(m => m.id === 'mistral-large-latest')).toBe(true);
      expect(models.some(m => m.id === 'mistral-small-latest')).toBe(true);
      expect(models.some(m => m.id === 'mistral-medium-latest')).toBe(true);
      expect(models.some(m => m.id === 'mistral-tiny-latest')).toBe(true);
    });

    it('should return models with correct family', () => {
      const adapter = new MistralAdapter();
      const models = adapter.getModels();
      expect(models.every(m => m.family === 'Mistral')).toBe(true);
    });
  });

  describe('setDefaultModel', () => {
    it('should accept valid model IDs', () => {
      const adapter = new MistralAdapter();
      expect(() => adapter.setDefaultModel('codestral-latest')).not.toThrow();
      expect(() => adapter.setDefaultModel('mistral-large-latest')).not.toThrow();
    });

    it('should reject invalid model IDs', () => {
      const adapter = new MistralAdapter();
      const originalModel = 'codestral-latest';
      adapter.setDefaultModel(originalModel);
      
      // Should log a warning but not throw
      expect(() => adapter.setDefaultModel('invalid-model')).not.toThrow();
    });
  });

  describe('checkPrerequisites', () => {
    it('should return unavailable when MISTRAL_API_KEY is not set', async () => {
      const adapter = new MistralAdapter();
      const originalEnv = process.env.MISTRAL_API_KEY;
      delete process.env.MISTRAL_API_KEY;

      try {
        const status = await adapter.checkPrerequisites();
        expect(status.available).toBe(false);
        expect(status.errorMessage).toContain('not found');
        expect(status.installInstructions).toContain('https://console.mistral.ai/');
      } finally {
        process.env.MISTRAL_API_KEY = originalEnv;
      }
    });

    it('should return unavailable when MISTRAL_API_KEY is empty', async () => {
      const adapter = new MistralAdapter();
      const originalEnv = process.env.MISTRAL_API_KEY;
      process.env.MISTRAL_API_KEY = '   ';

      try {
        const status = await adapter.checkPrerequisites();
        expect(status.available).toBe(false);
      } finally {
        process.env.MISTRAL_API_KEY = originalEnv;
      }
    });

    it('should return unavailable when MISTRAL_API_KEY is whitespace', async () => {
      const adapter = new MistralAdapter();
      const originalEnv = process.env.MISTRAL_API_KEY;
      process.env.MISTRAL_API_KEY = '\n\t  \n';

      try {
        const status = await adapter.checkPrerequisites();
        expect(status.available).toBe(false);
      } finally {
        process.env.MISTRAL_API_KEY = originalEnv;
      }
    });
  });

  describe('transformMistralEvent', () => {
    const ctx: { toolUseMap: Map<string, string>; detectedPorts: Set<number>; messages: any[] } = {
      toolUseMap: new Map(),
      detectedPorts: new Set(),
      messages: []
    };

    it('should transform message_start event', () => {
      const event = { type: 'message_start' };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({ type: 'activity', activity: 'generating' });
    });

    it('should transform message_delta with text', () => {
      const event = { type: 'message_delta', delta: { type: 'text_delta', text: 'Hello' } };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({ type: 'partial_text', text: 'Hello' });
    });

    it('should transform message_delta with thinking', () => {
      const event = { type: 'message_delta', delta: { type: 'thinking_delta', thinking: 'Thinking...' } };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({ type: 'partial_thinking', text: 'Thinking...' });
    });

    it('should transform tool_call event', () => {
      const event = {
        type: 'tool_call',
        tool_call: { id: '123', name: 'read_resource', arguments: '{"uri":"file.txt"}' }
      };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({
        type: 'assistant_tool_use',
        toolName: 'read_resource',
        toolInput: { uri: 'file.txt' },
        toolUseId: '123',
        toolCategory: 'edit',
        uuid: ''
      });
      expect(ctx.toolUseMap.get('123')).toBe('read_resource');
    });

    it('should transform tool_result event', () => {
      const event = {
        type: 'tool_result',
        tool_result: { tool_call_id: '123', content: 'File content', is_error: false }
      };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({
        type: 'tool_result',
        toolUseId: '123',
        content: 'File content',
        isError: false
      });
    });

    it('should transform tool_result with object content', () => {
      const event = {
        type: 'tool_result',
        tool_result: { tool_call_id: '123', content: { data: 'value' }, is_error: false }
      };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({
        type: 'tool_result',
        toolUseId: '123',
        content: '{"data":"value"}',
        isError: false
      });
    });

    it('should transform error event', () => {
      const event = { type: 'error', error: { message: 'Test error' } };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({ type: 'error', message: 'Test error' });
    });

    it('should transform error event with no message', () => {
      const event = { type: 'error', error: {} };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({ type: 'error', message: 'Unknown error' });
    });

    it('should transform usage event', () => {
      const event = { type: 'usage', usage: { input_tokens: 100, output_tokens: 50 } };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({ type: 'usage', inputTokens: 100, outputTokens: 50 });
    });

    it('should transform rate_limit event', () => {
      const event = {
        type: 'rate_limit',
        status: 'allowed',
        resets_at: 1234567890,
        utilization: 0.5,
        rate_limit_type: 'tokens'
      };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({
        type: 'rate_limit',
        status: 'allowed',
        resetsAt: 1234567890,
        utilization: 0.5,
        rateLimitType: 'tokens'
      });
    });

    it('should handle unknown event types', () => {
      const event = { type: 'unknown_event' };
      const result = transformMistralEvent(event, ctx);
      expect(result.length).toBe(0);
    });

    it('should handle empty event', () => {
      const event = {};
      const result = transformMistralEvent(event, ctx);
      expect(result.length).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should be callable without error', async () => {
      const adapter = new MistralAdapter();
      await expect(adapter.dispose()).resolves.toBeUndefined();
    });
  });

  describe('plugin methods', () => {
    const adapter = new MistralAdapter();

    it('listPlugins should return empty arrays', async () => {
      const result = await adapter.listPlugins();
      expect(result).toEqual({ installed: [], available: [] });
    });

    it('installPlugin should not throw', async () => {
      await expect(adapter.installPlugin('test-plugin')).resolves.toBeUndefined();
    });

    it('uninstallPlugin should not throw', async () => {
      await expect(adapter.uninstallPlugin('test-plugin')).resolves.toBeUndefined();
    });

    it('enablePlugin should not throw', async () => {
      await expect(adapter.enablePlugin('test-plugin')).resolves.toBeUndefined();
    });

    it('disablePlugin should not throw', async () => {
      await expect(adapter.disablePlugin('test-plugin')).resolves.toBeUndefined();
    });
  });
});
