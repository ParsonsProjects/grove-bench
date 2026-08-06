/**
 * Tests for Mistral adapter
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MistralAdapter, transformMistralEvent } from './mistral-agent.js';
import type { AgentEvent } from '../../shared/types.js';

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
  });

  describe('getModels', () => {
    it('should return Mistral models', () => {
      const adapter = new MistralAdapter();
      const models = adapter.getModels();
      expect(models).toBeDefined();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'codestral-latest')).toBe(true);
      expect(models.some(m => m.id === 'mistral-large-latest')).toBe(true);
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
  });

  describe('transformMistralEvent', () => {
    const ctx: { toolUseMap: Map<string, string>; detectedPorts: Set<number> } = {
      toolUseMap: new Map(),
      detectedPorts: new Set(),
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
        toolUseId: '123',
        toolCategory: 'edit'
      });
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

    it('should transform error event', () => {
      const event = { type: 'error', error: { message: 'Test error' } };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({ type: 'error', message: 'Test error' });
    });

    it('should transform usage event', () => {
      const event = { type: 'usage', usage: { input_tokens: 100, output_tokens: 50 } };
      const result = transformMistralEvent(event, ctx);
      expect(result).toContainEqual({ type: 'usage', inputTokens: 100, outputTokens: 50 });
    });

    it('should handle unknown event types', () => {
      const event = { type: 'unknown_event' };
      const result = transformMistralEvent(event, ctx);
      expect(result.length).toBe(0);
    });
  });
});
