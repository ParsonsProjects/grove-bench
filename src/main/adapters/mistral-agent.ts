/**
 * Mistral adapter for Grove Bench
 * Uses the @mistralai/mistralai SDK for chat completions with tool support.
 */
import type { AgentEvent, ToolCategory, ImageAttachment } from '../../shared/types.js';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentQueryHandle,
  AdapterConfig,
  AdapterPrerequisiteStatus,
  ModelInfo,
  PermissionResponse,
  UserMessage,
} from './types.js';
import { cleanEnv, matchToolRule, readableStreamToAsyncIterable } from '../agent-utils.js';
import { createMemoryMcpServer, GROVE_MEMORY_TOOL_NAMES } from './memory-mcp-server.js';
import { logger } from '../logger.js';

type MistralClient = import('@mistralai/mistralai').Mistral;
type ChatMessage = import('@mistralai/mistralai').ChatMessage;
type Tool = import('@mistralai/mistralai').Tool;

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<typeof import('@mistralai/mistralai')>;

let _mistral: MistralClient | null = null;

async function getMistral(): Promise<MistralClient> {
  if (!_mistral) {
    const sdk = await dynamicImport('@mistralai/mistralai');
    _mistral = new sdk.Mistral({ apiKey: process.env.MISTRAL_API_KEY ?? '' });
  }
  return _mistral;
}

function categorizeToolName(toolName: string): ToolCategory {
  if (toolName.includes('read') || toolName.includes('write') || toolName.includes('edit')) return 'edit';
  if (toolName.includes('bash') || toolName.includes('run') || toolName.includes('execute') || toolName.includes('code')) return 'bash';
  if (toolName.includes('ask') || toolName.includes('question')) return 'question';
  if (toolName.includes('fetch') || toolName.includes('web')) return 'web_fetch';
  if (toolName.includes('agent')) return 'agent';
  return 'other';
}

interface MessageContext {
  toolUseMap: Map<string, string>;
  detectedPorts: Set<number>;
  messages: ChatMessage[];
}

/**
 * Transform Mistral streaming events to Grove Bench AgentEvents.
 * Handles both partial deltas and complete messages.
 */
export function transformMistralEvent(event: any, ctx: MessageContext): AgentEvent[] {
  const events: AgentEvent[] = [];

  switch (event.type) {
    case 'message_start':
      events.push({ type: 'activity', activity: 'generating' });
      break;

    case 'message_delta':
      const delta = event.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        events.push({ type: 'partial_text', text: delta.text });
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        events.push({ type: 'partial_thinking', text: delta.thinking });
      }
      break;

    case 'tool_call':
      const tc = event.tool_call;
      if (tc) {
        ctx.toolUseMap.set(tc.id, tc.name);
        events.push({
          type: 'assistant_tool_use',
          toolName: tc.name,
          toolInput: tc.arguments ? JSON.parse(tc.arguments) : {},
          toolUseId: tc.id,
          uuid: '',
          toolCategory: categorizeToolName(tc.name)
        });
      }
      break;

    case 'tool_result':
      const tr = event.tool_result;
      if (tr) {
        events.push({
          type: 'tool_result',
          toolUseId: tr.tool_call_id,
          content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
          isError: tr.is_error
        });
      }
      break;

    case 'error':
      events.push({
        type: 'error',
        message: event.error?.message || 'Unknown error'
      });
      break;

    case 'usage':
      events.push({
        type: 'usage',
        inputTokens: event.usage?.input_tokens ?? 0,
        outputTokens: event.usage?.output_tokens ?? 0
      });
      break;

    case 'rate_limit':
      events.push({
        type: 'rate_limit',
        status: event.status ?? 'allowed',
        resetsAt: event.resets_at,
        utilization: event.utilization,
        rateLimitType: event.rate_limit_type
      });
      break;

    default:
      logger.debug('[MistralAdapter] Unhandled event: ' + event.type);
      break;
  }

  return events;
}

/**
 * Maximum number of retry attempts for API calls.
 */
const MAX_RETRIES = 3;

/**
 * Retry delay in milliseconds with exponential backoff.
 */
function getRetryDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10 seconds
}

/**
 * Sleep for a specified number of milliseconds.
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  operationName: string,
  attempt: number = 0
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (attempt >= MAX_RETRIES) {
      throw error;
    }

    const isRetryable = error?.message?.includes('rate') ||
      error?.message?.includes('timeout') ||
      error?.message?.includes('429') ||
      error?.message?.includes('503') ||
      error?.code === 'ETIMEDOUT' ||
      error?.code === 'ECONNRESET';

    if (isRetryable) {
      const delay = getRetryDelay(attempt);
      logger.warn(`[MistralAdapter] ${operationName} failed, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}): ${error.message}`);
      await sleep(delay);
      return withRetry(fn, operationName, attempt + 1);
    }

    // Non-retryable error, rethrow immediately
    throw error;
  }
}

export class MistralAdapter implements AgentAdapter {
  readonly id = 'mistral';
  readonly displayName = 'Mistral';
  readonly authErrorMessage = 'Authentication failed. Please set MISTRAL_API_KEY environment variable with your API key from https://console.mistral.ai/.';
  readonly capabilities: AgentCapabilities = {
    permissions: true,
    permissionModes: false,
    resume: true,
    modelSwitching: true,
    thinking: true,
    plugins: false,
    imageAttachments: true,
    structuredOutput: true,
    sandbox: false
  };

  /**
   * Default model for new sessions. Can be overridden per-session.
   * Reads from MISTRAL_DEFAULT_MODEL environment variable if set.
   */
  private defaultModel: string;

  constructor() {
    this.defaultModel = process.env.MISTRAL_DEFAULT_MODEL || 'codestral-latest';
  }

  /**
   * Set the default model for new sessions.
   * Also updates the environment variable for persistence.
   */
  setDefaultModel(model: string): void {
    if (this.getModels().some(m => m.id === model)) {
      this.defaultModel = model;
      process.env.MISTRAL_DEFAULT_MODEL = model;
    } else {
      logger.warn(`[MistralAdapter] Unknown model: ${model}, keeping current default: ${this.defaultModel}`);
    }
  }

  getModels(): ModelInfo[] {
    return [
      { id: 'codestral-latest', label: 'Codestral', family: 'Mistral' },
      { id: 'mistral-large-latest', label: 'Mistral Large', family: 'Mistral' },
      { id: 'mistral-small-latest', label: 'Mistral Small', family: 'Mistral' },
      { id: 'mistral-medium-latest', label: 'Mistral Medium', family: 'Mistral' },
      { id: 'mistral-tiny-latest', label: 'Mistral Tiny', family: 'Mistral' },
    ];
  }

  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      return {
        available: false,
        errorMessage: 'Mistral API key not found',
        installInstructions: 'Set MISTRAL_API_KEY from https://console.mistral.ai/'
      };
    }

    try {
      const m = await getMistral();
      // Test the API key by listing models
      await withRetry(
        () => m.models.list(),
        'checkPrerequisites'
      );
      return { available: true, authenticated: true, authMethod: 'api_key' };
    } catch (e: any) {
      const msg = e?.message || 'Auth failed';
      return {
        available: true,
        authenticated: false,
        authMethod: 'api_key',
        errorMessage: msg.includes('Invalid') || msg.includes('Unauthorized') ? 'Invalid API key' : msg
      };
    }
  }

  async start(config: AdapterConfig): Promise<AgentQueryHandle> {
    const mistral = await getMistral();

    // Register Grove memory operations as MCP tools
    let mcpServers: Record<string, any> | undefined;
    if (config.memoryOperations) {
      const ms = await createMemoryMcpServer(config.memoryOperations);
      mcpServers = { 'grove-memory': ms };
      for (const t of GROVE_MEMORY_TOOL_NAMES) {
        config.alwaysAllowedTools.add(t);
      }
    }

    const abortCtrl = new AbortController();
    let sessionId: string | null = null;
    let currentModel = config.model || this.defaultModel;

    // Build the canUseTool callback from the adapter config
    const canUseTool = async (toolName: string, input: Record<string, unknown>, toolCallId: string) => {
      // Allowlist check
      if (config.allowedTools && !config.allowedTools.has(toolName)) {
        return { behavior: 'deny' as const, message: `Tool "${toolName}" is not allowed in this session` };
      }

      // Build tool call string for pattern matching
      const toolCall = typeof (input as any)?.command === 'string'
        ? `${toolName}(${(input as any).command})`
        : toolName;

      // Deny rules take precedence
      for (const rule of config.toolDenyRules) {
        if (matchToolRule(rule.pattern, toolName, toolCall)) {
          return { behavior: 'deny' as const, message: `Denied by settings rule: ${rule.pattern}` };
        }
      }

      // Allow rules
      for (const rule of config.toolAllowRules) {
        if (matchToolRule(rule.pattern, toolName, toolCall)) {
          return { behavior: 'allow' as const, updatedInput: input };
        }
      }

      // Always-allowed tools (from session state)
      if (config.alwaysAllowedTools.has(toolName)) {
        return { behavior: 'allow' as const, updatedInput: input };
      }

      // Forward to the permission handler (which prompts the user)
      const resp = await config.onPermissionRequest({
        requestId: '',
        toolName,
        toolUseId: toolCallId,
        toolInput: input,
        toolCategory: categorizeToolName(toolName)
      });

      return resp.behavior === 'allow'
        ? { behavior: 'allow' as const, updatedInput: resp.updatedInput }
        : { behavior: 'deny' as const, message: resp.message };
    };

    // Create input stream for multi-turn conversations
    let inputController: ReadableStreamDefaultController<ChatMessage> | null = null;
    const inputStream = new ReadableStream<ChatMessage>({
      start(controller) {
        inputController = controller;
      },
    });

    // Build the initial system message
    const systemMessage: ChatMessage = {
      role: 'system',
      content: config.customSystemPrompt ||
        (config.appendSystemPrompt
          ? `You are a helpful AI assistant. ${config.appendSystemPrompt}`
          : 'You are a helpful AI assistant.')
    };

    // Initial messages with system prompt
    const initialMessages: ChatMessage[] = [systemMessage];

    // Add resume context if available
    if (config.resumeSessionId) {
      // For Mistral, we can't directly resume, but we can pass conversation history
      // This would be handled by the session manager passing previous messages
    }

    // Context for the event generator
    const ctx: MessageContext = {
      toolUseMap: new Map(),
      detectedPorts: new Set(),
      messages: [...initialMessages]
    };

    // Create the async event generator
    async function* eventGenerator(): AsyncGenerator<AgentEvent> {
      try {
        // Generate a session ID for tracking
        sessionId = 'mistral-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        // Yield system init event
        yield {
          type: 'system_init',
          sessionId,
          model: currentModel,
          tools: [],
          mcpServers: mcpServers ? Object.keys(mcpServers).map(n => ({ name: n, status: 'connected' })) : undefined
        };

        // Process messages from the input stream
        for await (const userMessage of readableStreamToAsyncIterable(inputStream)) {
          if (abortCtrl.signal.aborted) break;

          // Add user message to context
          ctx.messages.push(userMessage);

          // Process tools if any
          const tools: Tool[] = [];
          if (config.allowedTools) {
            for (const toolName of config.allowedTools) {
              // For now, we register tools that the adapter knows about
              // In a full implementation, these would be proper function definitions
              tools.push({
                type: 'function',
                function: {
                  name: toolName,
                  description: `Tool: ${toolName}`,
                  parameters: {
                    type: 'object',
                    properties: {},
                    required: []
                  }
                }
              });
            }
          }

          // Call Mistral chat with streaming
          const chatMessages = [...ctx.messages];
          
          const response = await withRetry(
            () => mistral.chat.stream({
              model: currentModel,
              messages: chatMessages,
              tools: tools.length > 0 ? tools : undefined,
              toolChoice: tools.length > 0 ? 'auto' : undefined,
              stream: true
            }),
            'chat.stream'
          );

          // Process the streaming response
          for await (const event of response) {
            if (abortCtrl.signal.aborted) {
              await response.controller.abort();
              break;
            }

            // Transform and yield events
            for (const evt of transformMistralEvent(event, ctx)) {
              yield evt;
            }

            // Handle complete assistant messages
            if (event.type === 'message_stop') {
              // Store the assistant's response in context for conversation history
              // Note: We'd need to reconstruct the full message from deltas
              // For now, we just track that a response was received
            }
          }
        }
      } catch (error: any) {
        if (!abortCtrl.signal.aborted) {
          yield {
            type: 'error',
            message: error.message || 'Mistral API error'
          };
        }
      } finally {
        if (!sessionId) {
          // Ensure system_init is always sent
          sessionId = 'mistral-' + Date.now();
          yield {
            type: 'system_init',
            sessionId,
            model: currentModel,
            tools: [],
            mcpServers: mcpServers ? Object.keys(mcpServers).map(n => ({ name: n, status: 'connected' })) : undefined
          };
        }
      }
    }

    const handle: AgentQueryHandle = {
      events: eventGenerator(),

      sendMessage(message: UserMessage) {
        if (!inputController) {
          logger.warn('[MistralAdapter] sendMessage called but inputController is null — message dropped');
          return;
        }

        // Build the user message content
        let content: string | Array<Record<string, unknown>> = message.text;

        if (message.images && message.images.length > 0) {
          const blocks: Array<Record<string, unknown>> = [];
          for (const img of message.images) {
            blocks.push({
              type: 'image_url',
              image_url: {
                url: `data:${img.mediaType};base64,${img.data}`
              }
            });
          }
          blocks.push({ type: 'text', text: message.text });
          content = blocks;
        }

        // Enqueue the user message
        inputController.enqueue({
          role: 'user',
          content: content
        });
      },

      abort() {
        abortCtrl.abort();
        try {
          inputController?.close();
        } catch { /* may already be closed */ }
      },

      close() {
        try {
          inputController?.close();
          inputController = null;
        } catch { /* may already be closed */ }
      },

      getSessionId() {
        return sessionId;
      },

      async setModel(model: string) {
        if (this.getModels().some(m => m.id === model)) {
          currentModel = model;
        } else {
          logger.warn(`[MistralAdapter] Unknown model: ${model}`);
        }
      },

      closeInput() {
        if (!inputController) return;
        try {
          inputController.close();
          inputController = null;
        } catch { /* may already be closed */ }
      },
    };

    return handle;
  }

  async generateText(systemPrompt: string, userMessage: string, options?: { cwd?: string; abortSignal?: AbortSignal }): Promise<string> {
    const m = await getMistral();
    let result = '';

    const abortCtrl = new AbortController();
    if (options?.abortSignal) {
      options.abortSignal.addEventListener('abort', () => abortCtrl.abort());
    }

    try {
      const response = await withRetry(
        () => m.chat.stream({
          model: this.defaultModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          stream: true
        }),
        'generateText'
      );

      for await (const event of response) {
        if (abortCtrl.signal.aborted) {
          await response.controller.abort();
          break;
        }

        if (event.type === 'message_delta' && event.delta?.content) {
          result += event.delta.content;
        }
      }
    } catch (error: any) {
      logger.error(`[MistralAdapter] generateText failed: ${error.message}`);
      throw error;
    }

    return result;
  }

  async generateWorktreeSettings(wtPath: string): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = path.join(wtPath, '.mistral');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'settings.json'),
      JSON.stringify({
        adapter: 'mistral',
        createdAt: new Date().toISOString()
      }, null, 2)
    );
  }

  async listPlugins() {
    return { installed: [], available: [] };
  }

  async installPlugin(id: string, s?: string) {
    logger.debug('[Mistral] installPlugin: ' + id);
  }

  async uninstallPlugin(id: string) {
    logger.debug('[Mistral] uninstallPlugin: ' + id);
  }

  async enablePlugin(id: string) {
    logger.debug('[Mistral] enablePlugin: ' + id);
  }

  async disablePlugin(id: string) {
    logger.debug('[Mistral] disablePlugin: ' + id);
  }

  async dispose() {
    _mistral = null;
  }
}
