/**
 * Claude Code adapter — wraps the @anthropic-ai/claude-agent-sdk.
 */
import type { AgentEvent, ToolCategory } from '../../shared/types.js';
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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

// ─── SDK dynamic import (ESM-only module in a CJS Electron main process) ───

type Query = import('@anthropic-ai/claude-agent-sdk').Query;
type SDKMessage = import('@anthropic-ai/claude-agent-sdk').SDKMessage;
type SDKUserMessage = Extract<SDKMessage, { type: 'user' }>;

const dynamicImport = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@anthropic-ai/claude-agent-sdk')>;

let _query: typeof import('@anthropic-ai/claude-agent-sdk').query;
async function getQuery() {
  if (!_query) {
    const sdk = await dynamicImport('@anthropic-ai/claude-agent-sdk');
    _query = sdk.query;
  }
  return _query;
}

// ─── Tool category mapping ───

/** Map Claude Code SDK tool names to adapter-agnostic categories. */
function categorizeToolName(toolName: string): ToolCategory {
  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return 'edit';
    case 'Bash':
      return 'bash';
    case 'AskUserQuestion':
      return 'question';
    case 'WebFetch':
      return 'web_fetch';
    case 'Agent':
      return 'agent';
    default:
      // MCP tools with WebFetch prefix
      if (toolName.startsWith('mcp__') && toolName.includes('WebFetch')) return 'web_fetch';
      return 'other';
  }
}

// ─── SDKMessage → AgentEvent transform ───

/**
 * Context carried through the message-handling loop. The adapter's `start()`
 * method creates one of these per query and the event generator mutates it.
 */
interface MessageContext {
  /** Maps toolUseId → toolName for matching tool_results back to their tool. */
  toolUseMap: Map<string, string>;
  /** Ports where dev servers were detected (written by the orchestrator, not here). */
  detectedPorts: Set<number>;
}

/**
 * Transform a single SDKMessage into zero or more AgentEvents.
 * This is a pure function (given a context bag) extracted from the former
 * `AgentSessionManager.handleMessage()`.
 */
export function transformMessage(
  message: SDKMessage,
  ctx: MessageContext,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  switch (message.type) {
    case 'system': {
      if (message.subtype === 'init') {
        events.push({
          type: 'system_init',
          sessionId: message.session_id,
          model: message.model,
          tools: message.tools,
          agents: (message as any).agents,
          skills: (message as any).skills,
          slashCommands: (message as any).slash_commands,
          mcpServers: (message as any).mcp_servers,
        });
      } else if (message.subtype === 'compact_boundary') {
        const meta = (message as any).compact_metadata ?? {};
        events.push({
          type: 'compact_boundary',
          trigger: meta.trigger ?? 'manual',
          preTokens: meta.pre_tokens ?? 0,
        });
      } else if (message.subtype === 'status') {
        const m = message as any;
        if (m.status === 'compacting') {
          events.push({ type: 'status', message: 'Compacting conversation...' });
        }
        const modeValue = m.permissionMode ?? m.permission_mode;
        if (modeValue) {
          events.push({ type: 'mode_sync', mode: modeValue, source: 'sdk' });
        }
      } else if (message.subtype === 'local_command_output') {
        const content = (message as any).content;
        if (content) {
          events.push({ type: 'status', message: content });
          if (/mode.*plan/i.test(content) || /plan mode/i.test(content)) {
            events.push({ type: 'mode_sync', mode: 'plan', source: 'sdk' });
          } else if (/mode.*code/i.test(content) || /code mode/i.test(content) || /default mode/i.test(content)) {
            events.push({ type: 'mode_sync', mode: 'default', source: 'sdk' });
          } else if (/mode.*accept/i.test(content) || /acceptEdits/i.test(content) || /edit mode/i.test(content)) {
            events.push({ type: 'mode_sync', mode: 'acceptEdits', source: 'sdk' });
          }
        }
      } else if (message.subtype === 'task_started') {
        const m = message as any;
        events.push({
          type: 'task_started',
          taskId: m.task_id ?? '',
          toolUseId: m.tool_use_id,
          description: m.description ?? '',
          taskType: m.task_type,
        });
      } else if (message.subtype === 'task_progress') {
        const m = message as any;
        const usage = m.usage ?? {};
        events.push({
          type: 'task_progress',
          taskId: m.task_id ?? '',
          toolUseId: m.tool_use_id,
          description: m.description ?? '',
          summary: m.summary,
          lastToolName: m.last_tool_name,
          totalTokens: usage.total_tokens ?? 0,
          toolUses: usage.tool_uses ?? 0,
          durationMs: usage.duration_ms ?? 0,
        });
      } else if (message.subtype === 'task_notification') {
        const m = message as any;
        const usage = m.usage ?? {};
        events.push({
          type: 'task_notification',
          taskId: m.task_id ?? '',
          toolUseId: m.tool_use_id,
          taskStatus: m.status ?? 'completed',
          summary: m.summary ?? '',
          outputFile: m.output_file ?? '',
          totalTokens: usage.total_tokens,
          toolUses: usage.tool_uses,
          durationMs: usage.duration_ms,
        });
      } else if (message.subtype === 'hook_started') {
        const m = message as any;
        events.push({
          type: 'hook_event',
          subtype: 'started',
          hookId: m.hook_id ?? '',
          hookName: m.hook_name ?? '',
          hookEvent: m.hook_event ?? '',
        });
      } else if (message.subtype === 'hook_progress') {
        const m = message as any;
        events.push({
          type: 'hook_event',
          subtype: 'progress',
          hookId: m.hook_id ?? '',
          hookName: m.hook_name ?? '',
          hookEvent: m.hook_event ?? '',
          output: m.output || m.stdout || m.stderr || '',
        });
      } else if (message.subtype === 'hook_response') {
        const m = message as any;
        events.push({
          type: 'hook_event',
          subtype: 'response',
          hookId: m.hook_id ?? '',
          hookName: m.hook_name ?? '',
          hookEvent: m.hook_event ?? '',
          output: m.output || m.stdout || m.stderr || '',
          outcome: m.outcome ?? 'success',
          exitCode: m.exit_code,
        });
      } else if (message.subtype === 'elicitation_complete') {
        const m = message as any;
        events.push({
          type: 'elicitation_complete',
          serverName: m.mcp_server_name ?? '',
          elicitationId: m.elicitation_id ?? '',
        });
      } else if (message.subtype === 'files_persisted') {
        const m = message as any;
        events.push({
          type: 'files_persisted',
          files: (m.files ?? []).map((f: any) => ({ filename: f.filename, fileId: f.file_id })),
          failed: m.failed ?? [],
        });
      } else {
        // Try to extract permission mode from any unhandled system message
        const m = message as any;
        const modeVal = m.permissionMode ?? m.permission_mode ?? m.mode;
        if (modeVal && typeof modeVal === 'string') {
          events.push({ type: 'mode_sync', mode: modeVal as any, source: 'sdk' });
        }
      }
      break;
    }

    case 'assistant': {
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text') {
            events.push({ type: 'assistant_text', text: block.text, uuid: message.uuid });
          } else if (block.type === 'tool_use') {
            ctx.toolUseMap.set(block.id, block.name);
            events.push({
              type: 'assistant_tool_use',
              toolName: block.name,
              toolInput: block.input,
              toolUseId: block.id,
              uuid: message.uuid,
              toolCategory: categorizeToolName(block.name),
            });
          } else if (block.type === 'thinking') {
            events.push({
              type: 'thinking',
              thinking: (block as any).thinking || '',
              uuid: message.uuid,
            });
          }
        }
      }
      const usage = (message.message as any)?.usage;
      if (usage) {
        events.push({
          type: 'usage',
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens,
          cacheCreationTokens: usage.cache_creation_input_tokens,
        });
      }
      break;
    }

    case 'user': {
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            const resultContent = Array.isArray(block.content)
              ? block.content.map((c: any) => c.text || '').join('')
              : typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
            events.push({
              type: 'tool_result',
              toolUseId: block.tool_use_id,
              content: resultContent,
              isError: block.is_error,
            });
          }
        }
      }
      break;
    }

    case 'result': {
      const modelUsage = (message as any).modelUsage as Record<string, { contextWindow?: number }> | undefined;
      const contextWindow = modelUsage
        ? Object.values(modelUsage)[0]?.contextWindow
        : undefined;
      events.push({
        type: 'result',
        subtype: message.subtype,
        result: 'result' in message ? (message as any).result : undefined,
        structured_output: 'structured_output' in message ? (message as any).structured_output : undefined,
        totalCostUsd: message.total_cost_usd,
        durationMs: message.duration_ms,
        isError: message.is_error,
        errors: 'errors' in message ? (message as any).errors : undefined,
        numTurns: message.num_turns,
        contextWindow,
      });
      break;
    }

    case 'tool_progress': {
      const m = message as any;
      events.push({
        type: 'tool_progress',
        toolName: m.tool_name ?? '',
        toolUseId: m.tool_use_id ?? '',
        elapsedSeconds: m.elapsed_time_seconds ?? 0,
      });
      break;
    }

    case 'stream_event': {
      const event = message.event;
      if (event.type === 'content_block_delta') {
        const delta = (event as any).delta;
        if (delta?.type === 'text_delta' && delta.text) {
          events.push({ type: 'partial_text', text: delta.text });
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          events.push({ type: 'partial_thinking', text: delta.thinking });
        }
      } else if (event.type === 'content_block_start') {
        const block = (event as any).content_block;
        if (block?.type === 'thinking') {
          events.push({ type: 'activity', activity: 'thinking' });
        } else if (block?.type === 'text') {
          events.push({ type: 'activity', activity: 'generating' });
        } else if (block?.type === 'tool_use') {
          events.push({ type: 'activity', activity: 'tool_starting', toolName: block.name });
        }
      } else if (event.type === 'message_start') {
        events.push({ type: 'activity', activity: 'generating' });
      }
      break;
    }

    case 'auth_status': {
      const m = message as any;
      events.push({
        type: 'auth_status',
        isAuthenticating: m.isAuthenticating ?? false,
        output: m.output ?? [],
        authError: m.error,
      });
      break;
    }

    case 'tool_use_summary': {
      const m = message as any;
      events.push({
        type: 'tool_use_summary',
        summary: m.summary ?? '',
        toolUseIds: m.preceding_tool_use_ids ?? [],
      });
      break;
    }

    case 'rate_limit_event': {
      const m = message as any;
      const info = m.rate_limit_info ?? {};
      events.push({
        type: 'rate_limit',
        status: info.status ?? 'allowed',
        resetsAt: info.resets_at ?? info.resetsAt,
        utilization: info.utilization,
        rateLimitType: info.rate_limit_type ?? info.rateLimitType,
      });
      break;
    }

    case 'prompt_suggestion': {
      const m = message as any;
      events.push({
        type: 'prompt_suggestion',
        suggestion: m.suggestion ?? '',
      });
      break;
    }

    default:
      break;
  }

  return events;
}

// ─── Claude Code Adapter ───

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly authErrorMessage = 'Authentication failed. Please run "claude auth login" in your terminal and try again.';
  readonly capabilities: AgentCapabilities = {
    permissions: true,
    permissionModes: true,
    resume: true,
    modelSwitching: true,
    thinking: true,
    plugins: true,
    imageAttachments: true,
    structuredOutput: true,
    sandbox: true,
  };

  // TODO: Hardcoded model list — update when new models are released, or fetch dynamically from the SDK if it exposes a model list.
  getModels(): ModelInfo[] {
    return [
      { id: 'claude-opus-4-6', label: 'Opus 4.6', family: 'Claude' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', family: 'Claude' },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', family: 'Claude' },
    ];
  }

  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> {
    try {
      const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(cmd, ['claude']);
      const firstMatch = stdout.trim().split('\n')[0];

      try {
        const { stdout: authJson } = await execFileAsync('claude', ['auth', 'status', '--json'], { shell: true });
        const auth = JSON.parse(authJson.trim());
        return {
          available: true,
          path: firstMatch,
          authenticated: auth.loggedIn === true,
          authMethod: auth.authMethod,
          email: auth.email,
        };
      } catch {
        return { available: true, path: firstMatch, authenticated: false };
      }
    } catch {
      return {
        available: false,
        errorMessage: 'Claude Code CLI not found',
        installInstructions: 'Install with: npm install -g @anthropic-ai/claude-code',
      };
    }
  }

  async start(config: AdapterConfig): Promise<AgentQueryHandle> {
    const queryFn = await getQuery();

    // Register Grove memory operations as an SDK MCP server
    let mcpServers: Record<string, any> | undefined;
    if (config.memoryOperations) {
      const memoryServer = await createMemoryMcpServer(config.memoryOperations);
      mcpServers = { 'grove-memory': memoryServer };
      // Auto-allow memory tools so they don't trigger permission prompts
      for (const t of GROVE_MEMORY_TOOL_NAMES) {
        config.alwaysAllowedTools.add(t);
      }
    }

    // Create input stream for multi-turn conversations
    let inputController: ReadableStreamDefaultController<SDKUserMessage> | null = null;
    const inputStream = new ReadableStream<SDKUserMessage>({
      start(controller) {
        inputController = controller;
      },
    });

    const abortController = new AbortController();
    let sessionId: string | null = null;

    // Build the canUseTool callback from the adapter config.
    const canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
      options: { toolUseID: string; decisionReason?: string; suggestions?: unknown[] },
    ) => {
      // Allowlist check
      if (config.allowedTools && !config.allowedTools.has(toolName)) {
        return { behavior: 'deny' as const, message: `Tool "${toolName}" is not allowed in this session` };
      }

      // Deny rules
      const toolCall = typeof (input as any)?.command === 'string'
        ? `${toolName}(${(input as any).command})`
        : toolName;
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

      // Sandbox auto-approve Bash
      if (config.sandbox && toolName === 'Bash') {
        return { behavior: 'allow' as const, updatedInput: input };
      }

      // Sandbox: validate Edit/Write paths against allowWrite
      if (config.sandbox && (toolName === 'Edit' || toolName === 'Write')) {
        const filePath = (input as any).file_path;
        if (filePath && typeof filePath === 'string') {
          const allowWrite = (config.sandbox as any)?.filesystem?.allowWrite as string[] | undefined;
          if (allowWrite && allowWrite.length > 0) {
            const resolved = path.resolve(config.cwd, filePath);
            const allowed = allowWrite.some((dir: string) => resolved.startsWith(path.resolve(config.cwd, dir)));
            if (!allowed) {
              return { behavior: 'deny' as const, message: `Path "${filePath}" is outside the allowed write directories` };
            }
          }
        }
      }

      // Always-allowed tools (from session state)
      if (config.alwaysAllowedTools.has(toolName)) {
        return { behavior: 'allow' as const, updatedInput: input };
      }

      // Forward to the permission handler (which prompts the user).
      // The session manager assigns the canonical requestId; we pass an empty
      // placeholder that will be overwritten by onPermissionRequest.
      return config.onPermissionRequest({
        requestId: '',
        toolName,
        toolUseId: options.toolUseID,
        toolInput: input,
        decisionReason: options.decisionReason,
        suggestions: options.suggestions,
        isPlanExecution: toolName === 'ExitPlanMode',
        toolCategory: categorizeToolName(toolName),
        planText: toolName === 'ExitPlanMode' && typeof (input as any)?.plan === 'string'
          ? (input as any).plan
          : undefined,
      });
    };

    // Build SDK query options
    const systemPrompt = config.customSystemPrompt
      ? config.customSystemPrompt
      : config.appendSystemPrompt
        ? { type: 'preset' as const, preset: 'claude_code' as const, append: config.appendSystemPrompt }
        : { type: 'preset' as const, preset: 'claude_code' as const };

    const q: Query = queryFn({
      prompt: readableStreamToAsyncIterable(inputStream),
      options: {
        cwd: config.cwd,
        abortController,
        includePartialMessages: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt,
        permissionMode: config.permissionMode,
        ...(config.outputFormat ? { outputFormat: config.outputFormat } : {}),
        ...(config.sandbox ? { sandbox: config.sandbox } : {}),
        ...(mcpServers ? { mcpServers } : {}),
        ...(config.resumeSessionId ? { resume: config.resumeSessionId } : {}),
        canUseTool: canUseTool as any,
        env: {
          ...cleanEnv(),
          CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
          ...(config.extraEnv ?? {}),
        },
        stderr: (data: string) => {
          logger.debug(`[ClaudeCodeAdapter] SDK stderr: ${data}`);
        },
      },
    });

    // Message context for the transform function
    const ctx: MessageContext = {
      toolUseMap: new Map(),
      detectedPorts: new Set(),
    };

    // Create the async event generator
    async function* eventGenerator(): AsyncGenerator<AgentEvent> {
      for await (const message of q) {
        if (abortController.signal.aborted) break;

        // Capture session ID from system_init
        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id;
        }

        const agentEvents = transformMessage(message, ctx);
        for (const event of agentEvents) {
          yield event;
        }
      }
    }

    const handle: AgentQueryHandle = {
      events: eventGenerator(),

      sendMessage(message: UserMessage) {
        if (!inputController) {
          console.warn('[ClaudeCodeAdapter] sendMessage called but inputController is null — message dropped');
          return;
        }

        let messageContent: string | Array<Record<string, unknown>> = message.text;
        if (message.images && message.images.length > 0) {
          const blocks: Array<Record<string, unknown>> = [];
          for (const img of message.images) {
            blocks.push({
              type: 'image',
              source: { type: 'base64', media_type: img.mediaType, data: img.data },
            });
          }
          blocks.push({ type: 'text', text: message.text });
          messageContent = blocks;
        }

        inputController.enqueue({
          type: 'user',
          session_id: sessionId ?? '',
          message: { role: 'user', content: messageContent },
          parent_tool_use_id: null,
        } as SDKUserMessage);
      },

      abort() {
        abortController.abort();
      },

      close() {
        try { inputController?.close(); } catch { /* may already be closed */ }
        try { q.close(); } catch { /* may already be closed */ }
      },

      getSessionId() {
        return sessionId;
      },

      closeInput() {
        if (!inputController) return;
        try {
          inputController.close();
          inputController = null;
        } catch { /* may already be closed */ }
      },

      async setModel(model: string) {
        await q.setModel(model);
      },

      setPermissionMode(mode) {
        // 'acceptEdits' is an app-level concept — the Claude SDK only knows 'default' and 'plan'
        if (mode === 'default' || mode === 'plan') {
          q.setPermissionMode(mode);
        }
      },

      async setMaxThinkingTokens(tokens: number | null) {
        await q.setMaxThinkingTokens(tokens);
      },
    };

    return handle;
  }

  // ─── Plugin management (delegates to `claude` CLI) ───

  async listPlugins(): Promise<{ installed: Array<{ id: string; name?: string; enabled?: boolean }>; available: unknown[] }> {
    try {
      const { stdout } = await execFileAsync('claude', ['plugin', 'list', '--json', '--available'], { shell: true });
      return JSON.parse(stdout);
    } catch {
      return { installed: [], available: [] };
    }
  }

  async installPlugin(pluginId: string, scope = 'user'): Promise<void> {
    await execFileAsync('claude', ['plugin', 'install', pluginId, '--scope', scope], { shell: true });
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    await execFileAsync('claude', ['plugin', 'uninstall', pluginId], { shell: true });
  }

  async enablePlugin(pluginId: string): Promise<void> {
    await execFileAsync('claude', ['plugin', 'enable', pluginId], { shell: true });
  }

  async disablePlugin(pluginId: string): Promise<void> {
    await execFileAsync('claude', ['plugin', 'disable', pluginId], { shell: true });
  }

  // ─── Text generation (for memory extraction) ───

  async generateText(systemPrompt: string, userMessage: string, options?: { cwd?: string; abortSignal?: AbortSignal }): Promise<string> {
    const queryFn = await getQuery();

    let inputController: ReadableStreamDefaultController<SDKUserMessage> | null = null;
    const inputStream = new ReadableStream<SDKUserMessage>({
      start(c) { inputController = c; },
    });

    inputController!.enqueue({
      type: 'user',
      session_id: '',
      message: { role: 'user', content: userMessage },
      parent_tool_use_id: null,
    } as SDKUserMessage);
    inputController!.close();

    const abortController = new AbortController();
    if (options?.abortSignal) {
      options.abortSignal.addEventListener('abort', () => abortController.abort());
    }

    let resultText = '';
    const q = queryFn({
      prompt: readableStreamToAsyncIterable(inputStream),
      options: {
        cwd: options?.cwd ?? process.cwd(),
        abortController,
        systemPrompt,
        permissionMode: 'plan',
        maxTurns: 1,
      },
    });

    for await (const message of q) {
      if (message.type === 'assistant') {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              resultText += block.text;
            }
          }
        }
      }
    }

    return resultText;
  }

  // ─── Worktree configuration ───

  async generateWorktreeSettings(wtPath: string): Promise<void> {
    const fs = await import('node:fs/promises');
    const claudeDir = path.join(wtPath, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.local.json');

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify(
        {
          permissions: {
            deny: ['Read(../../**)', 'Edit(../../**)'],
          },
          attribution: {
            commit: '',
            pr: '',
          },
        },
        null,
        2
      )
    );
  }
}
