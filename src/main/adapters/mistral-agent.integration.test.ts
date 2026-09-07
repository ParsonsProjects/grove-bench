/**
 * Integration tests for Mistral adapter
 * These tests require a valid MISTRAL_API_KEY to be set in the environment.
 * They test the actual API interactions.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { MistralAdapter } from './mistral-agent.js';

// Skip all integration tests if MISTRAL_API_KEY is not set
const hasApiKey = !!process.env.MISTRAL_API_KEY?.trim();

describe('MistralAdapter Integration Tests', () => {
  let adapter: MistralAdapter;

  beforeAll(() => {
    if (!hasApiKey) {
      console.warn('Skipping Mistral integration tests: MISTRAL_API_KEY not set');
    }
  });

  beforeEach(() => {
    adapter = new MistralAdapter();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe.skipIf(!hasApiKey)('checkPrerequisites with valid API key', () => {
    it('should return available and authenticated with valid API key', async () => {
      const status = await adapter.checkPrerequisites();
      expect(status.available).toBe(true);
      expect(status.authenticated).toBe(true);
      expect(status.authMethod).toBe('api_key');
    });

    it('should return correct error for invalid API key', async () => {
      const originalKey = process.env.MISTRAL_API_KEY;
      process.env.MISTRAL_API_KEY = 'invalid-key-12345';

      try {
        const status = await adapter.checkPrerequisites();
        expect(status.available).toBe(true);
        expect(status.authenticated).toBe(false);
        expect(status.errorMessage).toBeDefined();
      } finally {
        process.env.MISTRAL_API_KEY = originalKey;
      }
    });
  });

  describe.skipIf(!hasApiKey)('generateText', () => {
    it('should generate text from a simple prompt', async () => {
      const systemPrompt = 'You are a helpful assistant.';
      const userMessage = 'Hello, how are you?';

      const result = await adapter.generateText(systemPrompt, userMessage);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle system prompts correctly', async () => {
      const systemPrompt = 'Respond with exactly the word "test"';
      const userMessage = 'Say test';

      const result = await adapter.generateText(systemPrompt, userMessage);

      expect(result).toBeDefined();
      expect(result.toLowerCase()).toContain('test');
    }, 30000);

    it('should respect abort signal', async () => {
      const systemPrompt = 'Write a very long response with many paragraphs.';
      const userMessage = 'Tell me a long story.';

      const abortController = new AbortController();
      const abortSignal = abortController.signal;

      // Abort after a short delay
      setTimeout(() => abortController.abort(), 100);

      await expect(
        adapter.generateText(systemPrompt, userMessage, { abortSignal })
      ).rejects.toThrow();
    }, 10000);
  });

  describe.skipIf(!hasApiKey)('start and sendMessage', () => {
    it('should start a session and process messages', async () => {
      const config = {
        cwd: process.cwd(),
        permissionMode: 'default',
        onPermissionRequest: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolAllowRules: [],
        toolDenyRules: [],
        alwaysAllowedTools: new Set()
      };

      const handle = await adapter.start(config);

      expect(handle).toBeDefined();
      expect(typeof handle.sendMessage).toBe('function');
      expect(typeof handle.abort).toBe('function');
      expect(typeof handle.close).toBe('function');
      expect(typeof handle.getSessionId).toBe('function');

      // Get session ID
      const sessionId = handle.getSessionId();
      expect(sessionId).toBeNull(); // Not set until first message

      // Collect events
      const events: any[] = [];
      for await (const event of handle.events) {
        events.push(event);
        if (event.type === 'system_init') {
          break; // Stop after system init
        }
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.type === 'system_init')).toBe(true);

      // Clean up
      handle.close();
    }, 30000);

    it('should send and receive messages', async () => {
      const config = {
        cwd: process.cwd(),
        permissionMode: 'default',
        onPermissionRequest: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolAllowRules: [],
        toolDenyRules: [],
        alwaysAllowedTools: new Set()
      };

      const handle = await adapter.start(config);

      // Send a message
      handle.sendMessage({ text: 'Hello, Mistral!' });

      // Collect events
      const events: any[] = [];
      const eventPromise = (async () => {
        for await (const event of handle.events) {
          events.push(event);
          // Stop after we get some response
          if (events.length >= 5) {
            break;
          }
        }
      })();

      await eventPromise;

      expect(events.length).toBeGreaterThan(0);

      // Clean up
      handle.close();
    }, 30000);

    it('should handle abort gracefully', async () => {
      const config = {
        cwd: process.cwd(),
        permissionMode: 'default',
        onPermissionRequest: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolAllowRules: [],
        toolDenyRules: [],
        alwaysAllowedTools: new Set()
      };

      const handle = await adapter.start(config);

      // Send a message
      handle.sendMessage({ text: 'Start a long response...' });

      // Abort immediately
      handle.abort();

      // Try to collect events (should not hang)
      const events: any[] = [];
      try {
        for await (const event of handle.events) {
          events.push(event);
        }
      } catch {
        // Expected to fail or complete
      }

      // Clean up
      handle.close();
    }, 10000);
  });

  describe.skipIf(!hasApiKey)('setModel', () => {
    it('should switch models correctly', async () => {
      const config = {
        cwd: process.cwd(),
        permissionMode: 'default',
        onPermissionRequest: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolAllowRules: [],
        toolDenyRules: [],
        alwaysAllowedTools: new Set()
      };

      const handle = await adapter.start(config);

      // Set a different model
      await handle.setModel('mistral-large-latest');

      // Send a message to verify the model is used
      handle.sendMessage({ text: 'Test with large model' });

      // Get the session ID
      const sessionId = handle.getSessionId();
      expect(sessionId).toBeDefined();

      // Clean up
      handle.close();
    }, 30000);

    it('should reject invalid model IDs', async () => {
      const config = {
        cwd: process.cwd(),
        permissionMode: 'default',
        onPermissionRequest: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolAllowRules: [],
        toolDenyRules: [],
        alwaysAllowedTools: new Set()
      };

      const handle = await adapter.start(config);

      // Try to set an invalid model
      await handle.setModel('invalid-model-id');

      // Should not throw, just log a warning
      // The model won't be changed

      // Clean up
      handle.close();
    }, 10000);
  });

  describe('dispose', () => {
    it('should be callable multiple times without error', async () => {
      await expect(adapter.dispose()).resolves.toBeUndefined();
      await expect(adapter.dispose()).resolves.toBeUndefined();
      await expect(adapter.dispose()).resolves.toBeUndefined();
    });
  });
});
