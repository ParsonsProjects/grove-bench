/**
 * Claude Code adapter — wraps the @anthropic-ai/claude-agent-sdk.
 */
import type { ControlDescriptor, ControlOption, McpServerInfo, McpConfiguredServer, McpAddServerOpts, McpConfigScope, McpElicitationRequest, McpServerContextCost, McpServerManager, McpSupport, ImageMediaType, PermissionMode, ProviderUsage, SkillDefinition, ThinkingLevel, ToolCategory, UsageWindow } from '../../shared/types.js';
import { CONTROL_IDS, THINKING_LEVELS } from '../../shared/types.js';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentQueryHandle,
  AdapterConfig,
  AdapterEvent,
  AdapterPrerequisiteStatus,
  ApiKeyDescriptor,
  CliSignInDescriptor,
  ModelInfo,
  PermissionResponse,
  ToolImageData,
  UserMessage,
} from './types.js';
import { getApiKey } from '../credentials.js';
import { loadModelCatalog, saveModelCatalog } from '../app-state.js';
import { z } from 'zod';
import { cleanEnv, isPathInside, checkToolRules, toolCallSpecifier, readableStreamToAsyncIterable } from '../agent-utils.js';
import { createMemoryMcpServer, GROVE_MEMORY_TOOL_NAMES } from './memory-mcp-server.js';
import { createPreviewMcpServer, GROVE_PREVIEW_READ_TOOL_NAMES } from './preview-mcp-server.js';
import * as skillsModule from '../skills.js';
import { logger } from '../logger.js';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

// ─── SDK dynamic import (ESM-only module in a CJS Electron main process) ───

type Query = import('@anthropic-ai/claude-agent-sdk').Query;
type SDKMessage = import('@anthropic-ai/claude-agent-sdk').SDKMessage;
type SDKUserMessage = Extract<SDKMessage, { type: 'user' }>;
type SpawnOptions = import('@anthropic-ai/claude-agent-sdk').SpawnOptions;
type SpawnedProcess = import('@anthropic-ai/claude-agent-sdk').SpawnedProcess;
type SdkElicitationRequest = import('@anthropic-ai/claude-agent-sdk').ElicitationRequest;

/**
 * Custom spawn used for the SDK's `spawnClaudeCodeProcess` hook.
 *
 * By default the SDK launches its bundled CLI as `node <…/cli.js>`, relying on a
 * `node` binary being on PATH. A GUI-launched Electron app on Windows frequently
 * inherits a minimal PATH with no `node`, so that spawn fails with ENOENT —
 * surfaced confusingly as "Claude Code executable not found at …cli.js. Is
 * options.pathToClaudeCodeExecutable set?". Electron's own binary runs as a plain
 * Node process when ELECTRON_RUN_AS_NODE=1, and `process.execPath` is always a
 * valid path in both dev and packaged builds — so we redirect the `node`
 * invocation to ourselves and drop the PATH dependency entirely. Non-node
 * commands (e.g. a native `claude` binary) are spawned unchanged.
 */
/** Tool results are kept only for display, replay and memory extraction — the
 *  model already received the full text. Cap what we retain so a test suite
 *  or build printing tens of MB doesn't live in main-process history, the
 *  JSONL log and renderer state for the rest of the session. */
const MAX_TOOL_RESULT_CHARS = 200_000;
const TOOL_RESULT_HEAD_CHARS = 150_000;

export function capToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  const tailChars = MAX_TOOL_RESULT_CHARS - TOOL_RESULT_HEAD_CHARS;
  const omitted = content.length - TOOL_RESULT_HEAD_CHARS - tailChars;
  return `${content.slice(0, TOOL_RESULT_HEAD_CHARS)}\n\n… [${omitted.toLocaleString()} characters omitted] …\n\n${content.slice(content.length - tailChars)}`;
}

function spawnClaudeCodeProcess(
  opts: SpawnOptions,
  onStderr?: (data: string) => void,
): SpawnedProcess & { readonly pid?: number } {
  const isNode = /^node(\.exe)?$/i.test(path.basename(opts.command));
  const command = isNode ? process.execPath : opts.command;
  const env = isNode
    ? { ...opts.env, ELECTRON_RUN_AS_NODE: '1' }
    : opts.env;
  const child = spawn(command, opts.args, {
    cwd: opts.cwd,
    env,
    signal: opts.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (onStderr) {
    child.stderr?.on('data', (d: Buffer) => onStderr(d.toString()));
  }
  return child as unknown as SpawnedProcess & { readonly pid?: number };
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@anthropic-ai/claude-agent-sdk')>;

let _sdk: typeof import('@anthropic-ai/claude-agent-sdk') | undefined;
async function getSdk() {
  if (!_sdk) {
    _sdk = await dynamicImport('@anthropic-ai/claude-agent-sdk');
  }
  return _sdk;
}

async function getQuery() {
  return (await getSdk()).query;
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
    case 'PowerShell':
      return 'bash';
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'NotebookRead':
      return 'read';
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

/** File-writing tools mapped to the input field that holds the target path. */
const WRITE_TOOL_PATH_FIELD: Record<string, string> = {
  Edit: 'file_path',
  Write: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

// Re-exported so existing importers (tests) keep working after the move to
// agent-utils, where non-adapter modules can share it.
export { isPathInside };

// ─── SDKMessage → AgentEvent transform ───

/**
 * Context carried through the message-handling loop. The adapter's `start()`
 * method creates one of these per query and the event generator mutates it.
 */
interface MessageContext {
  /** Maps toolUseId → toolName for matching tool_results back to their tool. */
  toolUseMap: Map<string, string>;
  /** Grove Bench-level permission mode. 'readSafe' is not an SDK mode — the
   *  SDK runs in 'acceptEdits' while Grove is in 'readSafe', so SDK-reported
   *  'acceptEdits' mode_syncs are translated back to 'readSafe'. */
  groveMode?: PermissionMode;
}

/** Strip ANSI escape sequences from provider-authored text before it is
 *  shown in the UI (the SDK warns that decision reasons may carry them). */
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/** Map Grove Bench permission modes to what the SDK understands. 'readSafe'
 *  is implemented app-side (read-only auto-approval in the permission
 *  handler); at the SDK level it behaves like acceptEdits so worktree edits
 *  don't prompt. 'auto' is the SDK's own classifier mode and passes through. */
export function toSdkPermissionMode(mode: PermissionMode): 'default' | 'plan' | 'acceptEdits' | 'auto' {
  return mode === 'readSafe' ? 'acceptEdits' : mode;
}

/** Translate an SDK-reported mode back to the Grove-level mode for mode_sync
 *  events: while Grove is in 'readSafe', the SDK legitimately reports
 *  'acceptEdits' — surface that as 'readSafe' so the UI doesn't flip to Edit. */
export function fromSdkSyncMode(mode: PermissionMode, ctx: MessageContext): PermissionMode {
  return mode === 'acceptEdits' && ctx.groveMode === 'readSafe' ? 'readSafe' : mode;
}

const IMAGE_MEDIA_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** The base64 images in a tool result's content: API image blocks (Read on an
 *  image file) or MCP ones (`data` + `mimeType`), in case they arrive unconverted. */
export function toolResultImages(content: unknown[]): ToolImageData[] {
  const images: ToolImageData[] = [];
  for (const c of content as any[]) {
    if (c?.type !== 'image') continue;
    const data = c.source?.type === 'base64' ? c.source.data : c.data;
    const mediaType = c.source?.type === 'base64' ? c.source.media_type : c.mimeType;
    if (typeof data === 'string' && data && IMAGE_MEDIA_TYPES.has(mediaType)) {
      images.push({ data, mediaType: mediaType as ImageMediaType });
    }
  }
  return images;
}

/**
 * Transform a single SDKMessage into zero or more AgentEvents.
 * This is a pure function (given a context bag) extracted from the former
 * `AgentSessionManager.handleMessage()`.
 */
export function transformMessage(
  message: SDKMessage,
  ctx: MessageContext,
): AdapterEvent[] {
  const events: AdapterEvent[] = [];

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
          events.push({ type: 'mode_sync', mode: fromSdkSyncMode(modeValue, ctx), source: 'sdk' });
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
            events.push({ type: 'mode_sync', mode: fromSdkSyncMode('acceptEdits', ctx), source: 'sdk' });
          }
        }
      } else if (message.subtype === 'task_started') {
        const m = message as any;
        // Ambient tasks (live-update watchers, skip_transcript work) are not
        // activity; the SDK asks hosts to keep them out of activity indicators.
        if (m.ambient) return events;
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
        if (m.ambient) return events;
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
      } else if (message.subtype === 'background_tasks_changed') {
        const m = message as any;
        const tasks: any[] = Array.isArray(m.tasks) ? m.tasks : [];
        events.push({
          type: 'background_tasks_changed',
          tasks: tasks.filter((t) => !t.ambient).map((t) => ({
            taskId: t.task_id ?? '',
            taskType: t.task_type,
            description: t.description ?? '',
          })),
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
      } else if (message.subtype === 'permission_denied') {
        // A tool call denied without a prompt (auto-mode classifier, deny
        // rule, ...). The CLI shows a notification for these; surface the
        // same so a blocked action in auto mode isn't silent.
        const m = message as any;
        const reason = typeof m.decision_reason === 'string' ? stripAnsi(m.decision_reason).trim() : '';
        const who = m.decision_reason_type === 'classifier' ? 'Auto mode blocked' : 'Blocked';
        events.push({ type: 'status', message: `${who} ${m.tool_name ?? 'a tool call'}${reason ? `: ${reason}` : ''}` });
      } else {
        // Try to extract permission mode from any unhandled system message
        const m = message as any;
        const modeVal = m.permissionMode ?? m.permission_mode ?? m.mode;
        if (modeVal && typeof modeVal === 'string') {
          events.push({ type: 'mode_sync', mode: fromSdkSyncMode(modeVal as PermissionMode, ctx), source: 'sdk' });
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
      // Only track token usage from the main conversation — subagent messages
      // carry a parent_tool_use_id and would cause the status-bar values to
      // fluctuate wildly as their smaller contexts overwrite the main context size.
      const isSubagent = !!(message as any).parent_tool_use_id;
      const usage = (message.message as any)?.usage;
      if (usage && !isSubagent) {
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
            const imageData = Array.isArray(block.content) ? toolResultImages(block.content) : [];
            events.push({
              type: 'tool_result',
              toolUseId: block.tool_use_id,
              content: capToolResult(resultContent),
              isError: block.is_error,
              ...(imageData.length > 0 && { imageData }),
            });
          }
        }
      }
      break;
    }

    case 'result': {
      // modelUsage can contain entries for helper models (e.g. Haiku used
      // internally for title generation) alongside the session's main model.
      // Pick the entry that did the bulk of the token work — the first key is
      // not reliably the conversation model, and helper entries would report
      // the wrong context window (e.g. Haiku's 200k for an Opus session).
      const modelUsage = (message as any).modelUsage as Record<string, {
        contextWindow?: number;
        inputTokens?: number;
        outputTokens?: number;
        cacheReadInputTokens?: number;
        cacheCreationInputTokens?: number;
      }> | undefined;
      const mainUsage = modelUsage
        ? Object.values(modelUsage).reduce<(typeof modelUsage)[string] | undefined>((best, u) => {
            const total = (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
              + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
            const bestTotal = best
              ? (best.inputTokens ?? 0) + (best.outputTokens ?? 0)
                + (best.cacheReadInputTokens ?? 0) + (best.cacheCreationInputTokens ?? 0)
              : -1;
            return total > bestTotal ? u : best;
          }, undefined)
        : undefined;
      const contextWindow = mainUsage?.contextWindow;
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

// ─── 1M context window ───

/** SDK beta flag that unlocks the 1M-token context window for capable models. */
export const CONTEXT_1M_BETA = 'context-1m-2025-08-07';

/**
 * Whether to request the 1M-token context window for `model`.
 *
 * The Claude Code CLI gates the 1M window behind CONTEXT_1M_BETA — without it,
 * even 1M-capable models (Opus, Sonnet) report the 200k default in modelUsage,
 * which is what the status bar then shows. Haiku is 200k-only, so we skip the
 * beta there rather than send an unsupported beta header. When the model is
 * unset the SDK uses its own default (currently a 1M-capable model), so we
 * opt in.
 */
export function supportsLargeContext(model: string | null | undefined): boolean {
  if (!model) return true;
  return !/haiku/i.test(model);
}

/**
 * Thinking level → max thinking tokens for the Claude SDK's runtime control
 * (`setMaxThinkingTokens`). 0 disables thinking; null clears the limit
 * (provider default/maximum — which on adaptive-capable models means the
 * model decides when and how much to think, so 'adaptive' also maps to null).
 * The low/medium budgets mirror Claude Code's own "think" / "megathink" tiers.
 */
export const THINKING_LEVEL_TOKENS: Record<ThinkingLevel, number | null> = {
  off: 0,
  low: 4_000,
  medium: 10_000,
  high: null,
  adaptive: null,
};

/**
 * Thinking level → the SDK's query-start `thinking` config, which (unlike the
 * deprecated runtime token control) can express adaptive thinking explicitly.
 * Returns null for 'high' (and unset) so the provider default applies.
 */
export function thinkingConfigFor(
  level: ThinkingLevel | null | undefined,
): { type: 'adaptive' } | { type: 'disabled' } | { type: 'enabled'; budgetTokens: number } | null {
  if (!level || level === 'high') return null;
  if (level === 'adaptive') return { type: 'adaptive' };
  if (level === 'off') return { type: 'disabled' };
  return { type: 'enabled', budgetTokens: THINKING_LEVEL_TOKENS[level]! };
}

// ─── Session controls ───

/** Claude's effort levels, lowest first (the SDK's `EffortLevel`). */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** What a model accepts for thinking and effort. */
export interface ClaudeModelCaps {
  /** Effort levels offered, lowest first; empty = no effort parameter. */
  effortLevels: readonly EffortLevel[];
  /** The model's own effort default, used when the session has no choice. */
  defaultEffort: EffortLevel | null;
  /** Adaptive thinking (the model decides when and how much to think). */
  adaptiveThinking: boolean;
  /** Thinking can be switched off. Fable 5/5.1 and Opus 5.5 reject it, and
   *  Claude Code keeps thinking on for them regardless of what is sent. */
  thinkingOff: boolean;
}

const ALL_EFFORT = EFFORT_LEVELS;
const NO_XHIGH: readonly EffortLevel[] = ['low', 'medium', 'high', 'max'];

/**
 * Per-model thinking/effort capabilities, from the model catalog in Claude
 * Code 2.1.281 (the CLI bundled with the agent SDK). For models the SDK lists
 * (see modelsFromSdk), its effort levels and adaptive-thinking flag win; this
 * table still supplies each model's default effort and whether thinking can
 * be switched off, which the SDK doesn't report.
 */
const MODEL_CAPS: Record<string, ClaudeModelCaps> = {
  'claude-fable-5': { effortLevels: ALL_EFFORT, defaultEffort: 'high', adaptiveThinking: true, thinkingOff: false },
  'claude-opus-5-5': { effortLevels: ALL_EFFORT, defaultEffort: 'medium', adaptiveThinking: true, thinkingOff: false },
  'claude-opus-5': { effortLevels: ALL_EFFORT, defaultEffort: 'high', adaptiveThinking: true, thinkingOff: true },
  'claude-opus-4-8': { effortLevels: ALL_EFFORT, defaultEffort: 'high', adaptiveThinking: true, thinkingOff: true },
  'claude-opus-4-7': { effortLevels: ALL_EFFORT, defaultEffort: 'xhigh', adaptiveThinking: true, thinkingOff: true },
  'claude-opus-4-6': { effortLevels: NO_XHIGH, defaultEffort: 'high', adaptiveThinking: true, thinkingOff: true },
  'claude-sonnet-4-6': { effortLevels: NO_XHIGH, defaultEffort: 'high', adaptiveThinking: true, thinkingOff: true },
  'claude-haiku-4-5': { effortLevels: [], defaultEffort: null, adaptiveThinking: false, thinkingOff: true },
};

/** Unset or unrecognised model: offer everything and let Claude Code
 *  downgrade what the model can't take. */
const GENERIC_CAPS: ClaudeModelCaps = { effortLevels: ALL_EFFORT, defaultEffort: 'high', adaptiveThinking: true, thinkingOff: true };

/**
 * Capabilities for `model`. Dated and suffixed ids ("claude-opus-5-5-<date>",
 * "[1m]") match by longest known prefix, so "claude-opus-5-5" never falls
 * through to "claude-opus-5".
 *
 * `learned` is what the SDK reported for this model (see modelsFromSdk). It
 * wins for effort levels and adaptive thinking. The SDK doesn't report a
 * model's default effort or whether thinking can be switched off, so those
 * still come from the table above (or the generic fallback).
 */
export function claudeModelCaps(model: string | null | undefined, learned?: LearnedModel): ClaudeModelCaps {
  const base = staticModelCaps(model);
  if (!learned) return base;
  const effortLevels = EFFORT_LEVELS.filter((l) => learned.effortLevels.includes(l));
  const defaultEffort = effortLevels.length === 0 ? null
    : base.defaultEffort && effortLevels.includes(base.defaultEffort) ? base.defaultEffort
    : effortLevels.includes('high') ? 'high'
    : effortLevels[effortLevels.length - 1];
  return { effortLevels, defaultEffort, adaptiveThinking: learned.adaptiveThinking, thinkingOff: base.thinkingOff };
}

function staticModelCaps(model: string | null | undefined): ClaudeModelCaps {
  if (!model) return GENERIC_CAPS;
  const id = Object.keys(MODEL_CAPS)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (id) return MODEL_CAPS[id];
  if (/haiku/i.test(model)) return MODEL_CAPS['claude-haiku-4-5'];
  return GENERIC_CAPS;
}

/**
 * Adaptive thinking (the model decides when and how much to think) exists on
 * the Claude 4.6+ generations; Haiku 4.5 only takes fixed budgets. Unset
 * model = SDK default, which is adaptive-capable.
 */
export function supportsAdaptiveThinking(model: string | null | undefined): boolean {
  return claudeModelCaps(model).adaptiveThinking;
}

/**
 * Fast mode (faster output, same model) is an Opus-only feature from 4.8 on.
 * Unset model = SDK default, which currently qualifies.
 */
export function supportsFastMode(model: string | null | undefined, learned?: LearnedModel): boolean {
  if (learned) return learned.fastMode;
  if (!model) return true;
  return /opus-(4-(8|9)|5)/i.test(model);
}

const PERMISSION_MODE_OPTIONS: ControlOption[] = [
  { value: 'default', label: 'Ask', tone: 'info', description: 'Check with you before each edit or command (reading files and read-only commands run freely)' },
  { value: 'plan', label: 'Plan', tone: 'warning', description: 'Explore and plan without editing files' },
  { value: 'acceptEdits', label: 'Edit', tone: 'accent', description: 'Auto-accept file edits inside the worktree; commands still ask' },
  { value: 'auto', label: 'Auto', tone: 'highlight', description: "Claude's classifier approves or blocks each action instead of asking" },
  // Grove's own mode, listed after Claude's so the divider shows it isn't one
  // of the CLI's.
  { value: 'readSafe', label: 'Read-safe', tone: 'success', group: 'Grove Bench', description: 'Auto-accept edits and read-only commands; everything else asks (sandbox-backed)' },
];

/**
 * Auto mode (a classifier model reviews actions instead of prompting) needs
 * Opus 4.6+, Sonnet 4.6+ or Fable; Haiku is not supported. Unset model = SDK
 * default, which qualifies.
 */
export function supportsAutoMode(model: string | null | undefined, learned?: LearnedModel): boolean {
  if (learned) return learned.autoMode;
  if (!model) return true;
  return !/haiku/i.test(model);
}

// Labels are shown under a "Thinking" heading and in the status-bar subtitle,
// so they carry no prefix.
const THINKING_OPTIONS: Record<ThinkingLevel, ControlOption> = {
  off: { value: 'off', label: 'Off', tone: 'muted', description: 'No extended thinking' },
  low: { value: 'low', label: 'Low', tone: 'accent-soft', description: 'Brief reasoning on hard steps' },
  medium: { value: 'medium', label: 'Medium', tone: 'accent-soft', description: 'Moderate reasoning budget' },
  high: { value: 'high', label: 'High', tone: 'accent', description: 'Provider default / maximum reasoning' },
  adaptive: { value: 'adaptive', label: 'On', tone: 'accent', description: 'Model decides when and how much to think; Effort sets how much' },
};

const EFFORT_OPTIONS: Record<EffortLevel, ControlOption> = {
  low: { value: 'low', label: 'Low', tone: 'muted', description: 'Fastest and cheapest; brief reasoning' },
  medium: { value: 'medium', label: 'Medium', tone: 'accent-soft', description: 'Balanced speed and depth' },
  high: { value: 'high', label: 'High', tone: 'accent', description: 'Deep reasoning' },
  xhigh: { value: 'xhigh', label: 'Extra', tone: 'accent', description: 'Deeper than High; suits long coding and agentic work' },
  max: { value: 'max', label: 'Max', tone: 'highlight', description: 'Uncapped reasoning; slow and token-hungry, for the hardest tasks' },
};

const SPEED_OPTIONS: ControlOption[] = [
  { value: 'standard', label: 'Standard', tone: 'neutral', description: 'Normal output speed' },
  { value: 'fast', label: 'Fast', tone: 'highlight', description: 'Faster output on the same model' },
];

/**
 * Thinking options for a model. Adaptive models are On/Off (effort sets the
 * depth, and Claude Code ignores fixed budgets for them). Haiku keeps fixed
 * budgets because it has no effort parameter. Models that can't turn
 * thinking off get no Thinking control at all.
 */
function thinkingOptionsFor(caps: ClaudeModelCaps): { options: ControlOption[]; default: ThinkingLevel } | null {
  if (!caps.thinkingOff) return null;
  if (caps.adaptiveThinking) {
    return { options: [THINKING_OPTIONS.off, THINKING_OPTIONS.adaptive], default: 'adaptive' };
  }
  return {
    options: THINKING_LEVELS.filter((l) => l !== 'adaptive').map((l) => THINKING_OPTIONS[l]),
    default: 'high',
  };
}

/** Controls the Claude Code adapter exposes for `model`, given what the SDK
 *  reported for it when known. Pure so it can be unit-tested without an SDK. */
export function claudeControlsFor(model?: string | null, learned?: LearnedModel): ControlDescriptor[] {
  const caps = claudeModelCaps(model, learned);
  const modeOptions = PERMISSION_MODE_OPTIONS
    .filter((o) => o.value !== 'auto' || supportsAutoMode(model, learned));
  const controls: ControlDescriptor[] = [
    { id: CONTROL_IDS.permissionMode, label: 'Mode', options: modeOptions, default: 'default' },
  ];
  if (caps.effortLevels.length > 0 && caps.defaultEffort) {
    controls.push({
      id: CONTROL_IDS.effort,
      label: 'Effort',
      options: caps.effortLevels.map((l) => EFFORT_OPTIONS[l]),
      default: caps.defaultEffort,
    });
  }
  const thinking = thinkingOptionsFor(caps);
  if (thinking) {
    controls.push({ id: CONTROL_IDS.thinking, label: 'Thinking', options: thinking.options, default: thinking.default });
  }
  if (supportsFastMode(model, learned)) {
    controls.push({ id: CONTROL_IDS.speed, label: 'Speed', options: SPEED_OPTIONS, default: 'standard' });
  }
  return controls;
}

/**
 * The query-start `thinking` and `effort` options for recorded control values.
 * Models that reject disabled thinking get no Thinking control, so a stale
 * recorded value (e.g. 'off' carried over from another model) is not sent.
 */
export function reasoningOptionsFor(
  model: string | null | undefined,
  controls: Record<string, string> | null | undefined,
  learned?: LearnedModel,
): { thinking: ReturnType<typeof thinkingConfigFor>; effort: EffortLevel | undefined } {
  const thinking = claudeModelCaps(model, learned).thinkingOff
    ? thinkingConfigFor(controls?.[CONTROL_IDS.thinking] as ThinkingLevel | undefined)
    : null;
  return { thinking, effort: effortFor(model, controls?.[CONTROL_IDS.effort], learned) };
}

/** A recorded effort value the model accepts, else undefined (send nothing). */
export function effortFor(model: string | null | undefined, value: string | undefined, learned?: LearnedModel): EffortLevel | undefined {
  const levels = claudeModelCaps(model, learned).effortLevels;
  return levels.includes(value as EffortLevel) ? (value as EffortLevel) : undefined;
}

// ─── Model catalog ───

type SdkModelInfo = import('@anthropic-ai/claude-agent-sdk').ModelInfo;

/**
 * Models this app version knew about, default first. Only used until the SDK
 * reports its own list (see modelsFromSdk), which then replaces this and is
 * cached for the next launch.
 */
export const FALLBACK_MODELS: readonly ModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', family: 'Claude', contextWindow: 1_000_000 },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', family: 'Claude', contextWindow: 1_000_000 },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', family: 'Claude', contextWindow: 1_000_000 },
  { id: 'claude-opus-5', label: 'Opus 5', family: 'Claude', contextWindow: 1_000_000 },
  { id: 'claude-fable-5', label: 'Fable 5', family: 'Claude', contextWindow: 1_000_000 },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', family: 'Claude', contextWindow: 1_000_000 },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', family: 'Claude', contextWindow: 1_000_000 },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', family: 'Claude', contextWindow: 1_000_000 },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', family: 'Claude', contextWindow: 1_000_000 },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', family: 'Claude', contextWindow: 200_000 },
];

/** A model as reported by the SDK, with the capabilities it declares. */
export interface LearnedModel {
  /** The concrete model id (the SDK row's resolvedModel). */
  id: string;
  /** e.g. "Opus 5.5". */
  label: string;
  /** The SDK's alias for the row ("opus", "haiku"), when it had one. */
  alias?: string;
  effortLevels: EffortLevel[];
  adaptiveThinking: boolean;
  fastMode: boolean;
  autoMode: boolean;
}

const learnedModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  alias: z.string().optional(),
  effortLevels: z.array(z.enum(EFFORT_LEVELS)),
  adaptiveThinking: z.boolean(),
  fastMode: z.boolean(),
  autoMode: z.boolean(),
});

/** The family new conversations start on when the user hasn't picked a model:
 *  Opus, as before the list came from the SDK. Its row is listed first. */
const DEFAULT_ALIAS = 'opus';
/** The family background tasks use unless the user picks another model. */
const BACKGROUND_ALIAS = 'haiku';
const FALLBACK_BACKGROUND_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Turn the SDK's model rows (`Query.supportedModels()`) into Grove's list.
 * The SDK lists aliases ("opus", "sonnet", "haiku") with the concrete model
 * each resolves to; Grove keeps the concrete id so saved choices and
 * conversation models keep matching. The "default" row (the account's
 * recommended model) repeats another row and is skipped: Grove has its own
 * Default entry. A boolean the SDK omits means the model lacks it (Haiku's
 * row carries none of them).
 */
export function modelsFromSdk(rows: readonly SdkModelInfo[]): LearnedModel[] {
  const seen = new Set<string>();
  const models: LearnedModel[] = [];
  for (const row of rows) {
    if (row.value === 'default') continue;
    const id = row.resolvedModel || row.value;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // "Opus 5.5 · Best for everyday, complex tasks" names the version; the
    // display name is only the family ("Opus").
    const version = row.description?.includes(' · ') ? row.description.split(' · ')[0].trim() : '';
    models.push({
      id,
      label: version || row.displayName || id,
      ...(row.value !== id ? { alias: row.value } : {}),
      effortLevels: row.supportsEffort ? (row.supportedEffortLevels ?? [...EFFORT_LEVELS]) : [],
      adaptiveThinking: row.supportsAdaptiveThinking === true,
      fastMode: row.supportsFastMode === true,
      autoMode: row.supportsAutoMode === true,
    });
  }
  const preferred = models.findIndex((m) => m.alias === DEFAULT_ALIAS);
  if (preferred > 0) models.unshift(...models.splice(preferred, 1));
  return models;
}

/** A cached list from app-state, or null when absent or malformed. */
export function parseLearnedModels(raw: unknown): LearnedModel[] | null {
  const parsed = z.array(learnedModelSchema).safeParse(raw);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

/** Where the adapter keeps its learned list between launches. */
export interface ModelCatalogStore {
  load(adapterId: string): unknown;
  save(adapterId: string, models: LearnedModel[]): void;
}

const appStateModelStore: ModelCatalogStore = {
  load: (adapterId) => loadModelCatalog(adapterId),
  save: (adapterId, models) => saveModelCatalog(adapterId, models),
};

// ─── Plan usage ───

interface ClaudeUsageWindow { utilization: number | null; resets_at: string | null }

/** Shape of the SDK's experimental `/usage` control response (the parts we read). */
export interface ClaudeUsageResponse {
  subscription_type?: string | null;
  rate_limits_available?: boolean;
  rate_limits?: {
    five_hour?: ClaudeUsageWindow | null;
    seven_day?: ClaudeUsageWindow | null;
    seven_day_opus?: ClaudeUsageWindow | null;
    seven_day_sonnet?: ClaudeUsageWindow | null;
    model_scoped?: Array<ClaudeUsageWindow & { display_name: string }>;
    extra_usage?: (ClaudeUsageWindow & { is_enabled: boolean }) | null;
  } | null;
}

/**
 * Map the SDK's `/usage` response to the neutral ProviderUsage shape. SDK
 * utilization is a 0–100 percentage and resets are ISO strings; the neutral
 * shape uses 0–1 fractions and epoch seconds (matching rate_limit events).
 * Windows without a utilization value are dropped.
 */
export function mapClaudeUsage(res: ClaudeUsageResponse | null | undefined, now = Date.now()): ProviderUsage {
  const plan = res?.subscription_type ?? null;
  const rl = res?.rate_limits;
  if (!res?.rate_limits_available || !rl) return { available: false, plan, windows: [], fetchedAt: now };

  const windows: UsageWindow[] = [];
  const push = (id: string, label: string, w: ClaudeUsageWindow | null | undefined) => {
    if (!w || w.utilization === null || w.utilization === undefined || Number.isNaN(w.utilization)) return;
    const resets = w.resets_at ? Date.parse(w.resets_at) : NaN;
    windows.push({
      id,
      label,
      utilization: Math.max(0, Math.min(1, w.utilization / 100)),
      ...(Number.isNaN(resets) ? {} : { resetsAt: Math.round(resets / 1000) }),
    });
  };
  push('five_hour', '5-hour', rl.five_hour);
  push('seven_day', 'Weekly', rl.seven_day);
  push('seven_day_opus', 'Weekly · Opus', rl.seven_day_opus);
  push('seven_day_sonnet', 'Weekly · Sonnet', rl.seven_day_sonnet);
  for (const m of rl.model_scoped ?? []) push(`model:${m.display_name}`, `Weekly · ${m.display_name}`, m);
  if (rl.extra_usage?.is_enabled) push('extra_usage', 'Extra usage', rl.extra_usage);
  return { available: true, plan, windows, fetchedAt: now };
}

// ─── MCP config CLI helpers ───

/** Server names `claude mcp add` accepts (it is stricter than Grove's own
 *  shell-safety check, validateMcpName). */
const CLAUDE_MCP_NAME_PATTERN = '^[A-Za-z0-9_-]+$';

/** What Grove can offer for Claude Code's MCP servers, and how to word it. */
export const CLAUDE_MCP_SUPPORT: McpSupport = {
  controls: { list: true, reconnect: true, toggle: true, signIn: true, contextCost: true },
  // The CLI saves a disconnect to disabledMcpServers for the project (keyed by
  // the main repo root, so every worktree shares it), not just this conversation.
  disconnectHint: 'Disconnect this server in this project. New conversations here also start without it until you connect it again.',
  config: {
    scopes: [
      { value: 'user', label: 'User', description: 'Available in all projects on this machine' },
      { value: 'project', label: 'Project', description: 'Shared with the team via .mcp.json in the project repository' },
      { value: 'local', label: 'Local', description: 'Only this machine, only the chosen project' },
    ],
    namePattern: CLAUDE_MCP_NAME_PATTERN,
    nameRule: 'Server names can only contain letters, numbers, hyphens and underscores',
    approvalHint: "From this project's .mcp.json. Conversations won't connect it until you approve it. Only approve servers you trust: they run on your machine.",
  },
};

/**
 * Spot servers that `claude mcp list` shows but `claude mcp remove` can't
 * remove, by the names the CLI gives them: `plugin:<plugin>:<server>` for a
 * plugin's servers and `claude.ai <Name>` for claude.ai connectors.
 */
export function mcpServerManager(name: string): McpServerManager | undefined {
  const plugin = name.match(/^plugin:([^:]+):./)?.[1];
  if (plugin) {
    return { label: `${plugin} plugin`, hint: 'To turn it off, disable or uninstall the plugin in the Plugins tab.' };
  }
  if (name.startsWith('claude.ai ')) {
    return { label: 'claude.ai', hint: 'To turn it off, manage your connectors on claude.ai.' };
  }
  return undefined;
}

/** A short label for where a live server comes from. The CLI's `source` is
 *  trusted over the name: sdk (a server Grove registers, e.g. its memory
 *  tools), plugin, or a config scope such as user, project or claudeai. */
export function claudeMcpOrigin(s: { source?: string; scope?: string }): string | undefined {
  const origin = s.source ?? s.scope;
  if (!origin) return undefined;
  if (origin === 'sdk') return 'Grove Bench';
  if (origin === 'claudeai') return 'claude.ai';
  return origin;
}

/**
 * The server part of an MCP tool name (`mcp__<key>__<tool>`), which is how
 * context usage reports a tool's server. Mirrors the CLI's normalization:
 * anything outside `[A-Za-z0-9_-]` becomes `_`, and claude.ai connector names
 * also collapse and trim underscores.
 */
export function mcpToolServerKey(name: string): string {
  const key = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return name.startsWith('claude.ai ') ? key.replace(/_+/g, '_').replace(/^_|_$/g, '') : key;
}

/**
 * Sum context usage's per-tool token counts by server. Tools the CLI defers
 * until the agent searches for them (`isLoaded: false`) don't sit in the
 * context window, so they count separately. Keys that match no known server
 * keep the normalized key as the name.
 */
export function mcpContextCostByServer(
  tools: ReadonlyArray<{ serverName: string; tokens: number; isLoaded?: boolean }>,
  serverNames: readonly string[],
): McpServerContextCost[] {
  const nameByKey = new Map(serverNames.map((n) => [mcpToolServerKey(n), n]));
  const costs = new Map<string, McpServerContextCost>();
  for (const tool of tools) {
    const serverName = nameByKey.get(tool.serverName) ?? tool.serverName;
    const cost = costs.get(serverName) ?? { serverName, tokens: 0, deferredTokens: 0 };
    if (tool.isLoaded === false) cost.deferredTokens += tool.tokens;
    else cost.tokens += tool.tokens;
    costs.set(serverName, cost);
  }
  return [...costs.values()];
}

/** Map the SDK's elicitation request to the neutral shape. The SDK leaves
 *  `mode` unset for plain form requests. */
export function toMcpElicitationRequest(r: SdkElicitationRequest): McpElicitationRequest {
  return {
    serverName: r.serverName,
    message: r.message,
    mode: r.mode === 'url' ? 'url' : 'form',
    ...(r.url ? { url: r.url } : {}),
    ...(r.requestedSchema ? { requestedSchema: r.requestedSchema } : {}),
    ...(r.title ? { title: r.title } : {}),
  };
}

/** Settings keys that record which .mcp.json servers the user approved or
 *  rejected (the CLI's approval prompt writes them to settings.local.json). */
const MCPJSON_APPROVAL_KEYS = ['enabledMcpjsonServers', 'disabledMcpjsonServers', 'enableAllProjectMcpServers'] as const;

/** The .mcp.json approval keys present in a settings object. */
export function mcpjsonApprovalsFrom(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of MCPJSON_APPROVAL_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return out;
}

/** Settings with `name` approved: added to enabledMcpjsonServers and taken
 *  out of disabledMcpjsonServers, as the CLI's own prompt does. */
export function withMcpjsonApproval(settings: Record<string, unknown>, name: string): Record<string, unknown> {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const enabled = list(settings.enabledMcpjsonServers);
  const disabled = list(settings.disabledMcpjsonServers).filter((n) => n !== name);
  const next: Record<string, unknown> = {
    ...settings,
    enabledMcpjsonServers: enabled.includes(name) ? enabled : [...enabled, name],
  };
  if (disabled.length > 0) next.disabledMcpjsonServers = disabled;
  else delete next.disabledMcpjsonServers;
  return next;
}

/** Read a JSON settings file. A missing file reads as `{}`; one that isn't a
 *  JSON object throws, so callers don't overwrite it. */
async function readSettingsFile(file: string): Promise<Record<string, unknown>> {
  const fs = await import('node:fs/promises');
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e: any) {
    if (e?.code === 'ENOENT') return {};
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Could not read ${file}: it isn't valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Could not read ${file}: expected a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Names the CLI accepts and that are safe to pass through a shell. */
export function validateMcpName(name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('Server name may only contain letters, digits, dots, dashes, and underscores');
  }
}

/**
 * Quote a single argument for execFile with `shell: true` (cmd.exe on
 * Windows joins args with spaces and does NOT quote them). Values that could
 * defeat double-quoting (`"`, `%`, control chars) are rejected outright.
 */
export function quoteArg(arg: string): string {
  if (/["%\r\n\0]/.test(arg)) {
    throw new Error(`Unsupported characters in argument: ${arg}`);
  }
  return /^[A-Za-z0-9._\/:@=+,-]+$/.test(arg) ? arg : `"${arg}"`;
}

/**
 * Parse `claude mcp list` output. Lines look like:
 *   `name: https://example.com/mcp (HTTP) - ✔ Connected`
 *   `my-server: npx my-mcp-server - ! Needs authentication`
 * Names may themselves contain `: ` (e.g. `plugin:figma:figma`), so the
 * name/target boundary is the LAST `: ` on the left of the status separator.
 */
export function parseMcpListOutput(stdout: string): McpConfiguredServer[] {
  const servers: McpConfiguredServer[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    const statusSep = line.lastIndexOf(' - ');
    if (statusSep < 0) continue; // banner/blank lines
    const left = line.slice(0, statusSep);
    const statusText = line.slice(statusSep + 3).toLowerCase();

    const nameSep = left.lastIndexOf(': ');
    if (nameSep < 0) continue;
    const name = left.slice(0, nameSep);
    let target = left.slice(nameSep + 2);

    let transport: string | undefined;
    const transportMatch = target.match(/\s+\(([A-Za-z]+)\)$/);
    if (transportMatch) {
      transport = transportMatch[1];
      target = target.slice(0, -transportMatch[0].length);
    }

    // Unapproved .mcp.json servers: "⏸ Pending approval (run `claude` to
    // approve)" and "✘ Rejected (see disabledMcpjsonServers in settings)".
    // Check these first (they also contain "pending" and "disabled"), and
    // only as the label itself, after its symbol, not inside an error text.
    const status: McpConfiguredServer['status'] =
      /^\S*\s*pending approval\b/.test(statusText) ? 'needs-approval'
        : /^\S*\s*rejected\b/.test(statusText) ? 'rejected'
        : statusText.includes('connected') && !statusText.includes('not connected') ? 'connected'
        : statusText.includes('auth') ? 'needs-auth'
        : statusText.includes('pending') ? 'pending'
        : statusText.includes('disabled') ? 'disabled'
        : 'failed';

    const managedBy = mcpServerManager(name);
    servers.push({ name, target, ...(transport ? { transport } : {}), status, ...(managedBy ? { managedBy } : {}) });
  }
  return servers;
}

/** Shape of the CLI's `mcp_authenticate` control response (undocumented). */
interface McpAuthenticateResponse {
  authUrl?: string;
  requiresUserAction?: boolean;
  callbackExpected?: boolean;
  callbackPort?: number;
}

/** Build the `claude mcp add ...` argument list for the given options. */
export function buildMcpAddArgs(opts: McpAddServerOpts): string[] {
  validateMcpName(opts.name);
  const args = ['mcp', 'add', '-s', opts.scope, '-t', opts.transport];
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
    args.push('-e', quoteArg(`${key}=${value}`));
  }
  for (const header of opts.headers ?? []) {
    args.push('-H', quoteArg(header));
  }
  args.push(opts.name);
  if (opts.transport === 'stdio') {
    // `--` stops the CLI from parsing the command's own flags
    args.push('--', quoteArg(opts.commandOrUrl), ...(opts.args ?? []).map(quoteArg));
  } else {
    args.push(quoteArg(opts.commandOrUrl));
  }
  return args;
}

// ─── Credentials ───

/** A GUI-launched `where`/`which` or `claude auth status` can hang (network,
 *  a first-run prompt). Without a limit, the check never settles. */
const CLI_LOOKUP_TIMEOUT_MS = 10_000;
const AUTH_STATUS_TIMEOUT_MS = 15_000;

/** Provider switches the agent reads from the environment
 *  (https://code.claude.com/docs/en/agent-sdk/quickstart). */
const PROVIDER_ENV_FLAGS: ReadonlyArray<[flag: string, method: string]> = [
  ['CLAUDE_CODE_USE_BEDROCK', 'Amazon Bedrock'],
  ['CLAUDE_CODE_USE_ANTHROPIC_AWS', 'Claude Platform on AWS'],
  ['CLAUDE_CODE_USE_VERTEX', 'Google Vertex AI'],
  ['CLAUDE_CODE_USE_FOUNDRY', 'Microsoft Foundry'],
];

/** How the agent will authenticate from the environment alone: an
 *  ANTHROPIC_API_KEY or a third-party provider switch. Null when neither is
 *  set. Cloud provider credentials themselves aren't verified here; a bad one
 *  surfaces as an auth error when the conversation starts. */
export function envAuthMethod(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.ANTHROPIC_API_KEY?.trim()) return 'ANTHROPIC_API_KEY';
  for (const [flag, method] of PROVIDER_ENV_FLAGS) {
    const value = env[flag]?.trim().toLowerCase();
    if (value === '1' || value === 'true') return method;
  }
  return null;
}

// ─── Claude Code Adapter ───

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code';
  // The Agent SDK branding guidelines rule out "Claude Code" as a label in
  // our UI and suggest "Claude Agent" for menus
  // (https://code.claude.com/docs/en/agent-sdk/overview#branding-guidelines).
  readonly displayName = 'Claude Agent';
  readonly authErrorMessage = 'Authentication failed. Add or check your Anthropic API key in Settings > Agent, or run "claude" in a terminal and sign in, then try again.';
  readonly apiKey: ApiKeyDescriptor = {
    envVar: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API key',
    helpUrl: 'https://platform.claude.com/',
    // https://support.claude.com/en/articles/9876003
    billingNote: 'Billed per use by Anthropic, separately from any Claude plan.',
  };
  // Anthropic's own sign-in in its own CLI; Grove only reads `claude auth
  // status` (DESIGN.md, "Allowed: the user's own Claude subscription").
  readonly cliSignIn: CliSignInDescriptor = {
    accountLabel: 'Claude plan',
    accountDetail: 'Pro, Max, Team or Enterprise',
    cliName: 'Claude Code',
    command: 'claude',
    setupUrl: 'https://code.claude.com/docs/en/setup',
  };
  readonly mcp = CLAUDE_MCP_SUPPORT;
  readonly capabilities: AgentCapabilities = {
    permissions: true,
    permissionModes: true,
    resume: true,
    modelSwitching: true,
    thinking: true,
    plugins: true,
    skills: true,
    usage: true,
    imageAttachments: true,
    structuredOutput: true,
    sandbox: true,
  };

  constructor(private readonly modelStore: ModelCatalogStore = appStateModelStore) {}

  // ─── Models ───
  // The list comes from the SDK (`Query.supportedModels()`), read when a
  // conversation starts and cached for the next launch. FALLBACK_MODELS only
  // covers the time before the first read.

  /** undefined until the cache has been read; null when there is none. */
  private learned: LearnedModel[] | null | undefined;
  /** Set once a read has been started this run; cleared if it fails. */
  private modelsRequested = false;
  private modelListeners = new Set<() => void>();

  private learnedModels(): LearnedModel[] | null {
    if (this.learned === undefined) {
      try {
        this.learned = parseLearnedModels(this.modelStore.load(this.id));
      } catch {
        this.learned = null;
      }
    }
    return this.learned;
  }

  /** What the SDK reported for `model`, matching dated or suffixed ids by the
   *  longest known prefix. */
  private learnedFor(model: string | null | undefined): LearnedModel | undefined {
    if (!model) return undefined;
    return (this.learnedModels() ?? [])
      .filter((m) => model.startsWith(m.id))
      .sort((a, b) => b.id.length - a.id.length)[0];
  }

  getModels(): ModelInfo[] {
    const learned = this.learnedModels();
    if (!learned) return [...FALLBACK_MODELS];
    return learned.map((m) => ({
      id: m.id,
      label: m.label,
      family: 'Claude',
      // The SDK doesn't report context size; the turn's usage does, and the
      // status bar prefers that. Until then, follow the 1M-context rule.
      contextWindow: FALLBACK_MODELS.find((f) => f.id === m.id)?.contextWindow
        ?? (supportsLargeContext(m.id) ? 1_000_000 : 200_000),
    }));
  }

  /** The SDK's current Haiku, so background tasks follow new Haiku releases. */
  get backgroundModel(): string {
    return this.learnedModels()?.find((m) => m.alias === BACKGROUND_ALIAS)?.id ?? FALLBACK_BACKGROUND_MODEL;
  }

  getControls(model?: string | null): ControlDescriptor[] {
    return claudeControlsFor(model, this.learnedFor(model));
  }

  onModelsChanged(listener: () => void): () => void {
    this.modelListeners.add(listener);
    return () => { this.modelListeners.delete(listener); };
  }

  /** Record the SDK's model rows. Saves and notifies only when the list
   *  changed. Returns whether it did. */
  learnModels(rows: readonly SdkModelInfo[]): boolean {
    const models = modelsFromSdk(rows);
    if (models.length === 0) return false;
    if (JSON.stringify(models) === JSON.stringify(this.learnedModels())) return false;
    this.learned = models;
    try {
      this.modelStore.save(this.id, models);
    } catch (err) {
      logger.warn('[ClaudeCodeAdapter] could not cache the model list:', err);
    }
    for (const listener of this.modelListeners) listener();
    return true;
  }

  /** Read the model list from a live query, once per run. The list only
   *  changes when the bundled CLI or the account does. */
  private refreshModelsFrom(q: Query): void {
    // Never let the model list get in the way of starting a conversation.
    if (this.modelsRequested || typeof q.supportedModels !== 'function') return;
    this.modelsRequested = true;
    q.supportedModels()
      .then((rows) => { this.learnModels(rows); })
      .catch((err) => {
        this.modelsRequested = false;
        logger.debug('[ClaudeCodeAdapter] supportedModels failed:', err);
      });
  }

  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> {
    // Try to locate the claude CLI binary.  On Windows, Electron processes
    // launched from Start Menu / desktop shortcuts often inherit a minimal
    // PATH that does not include user-level directories such as
    // %USERPROFILE%\.local\bin or npm global bin.  We therefore try
    // `where.exe` / `which` first, and if that fails, probe well-known
    // install locations before giving up.
    let claudePath: string | undefined;
    try {
      const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(cmd, ['claude'], { shell: true, timeout: CLI_LOOKUP_TIMEOUT_MS });
      claudePath = stdout.trim().split(/\r?\n/)[0];
    } catch {
      // `where`/`which` failed — try known Windows install locations
      if (process.platform === 'win32') {
        const fs = await import('node:fs');
        const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
        const candidates = [
          path.join(home, '.local', 'bin', 'claude.exe'),
          path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          path.join(home, 'AppData', 'Roaming', 'npm', 'claude'),
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            claudePath = c;
            break;
          }
        }
      }
    }

    // Conversations run on the SDK's bundled binary, not the installed CLI,
    // so credentials in the environment are enough on their own. The CLI is
    // only needed to sign in and for MCP / plugin configuration.
    const envMethod = envAuthMethod();

    if (!claudePath) {
      return {
        available: false,
        authenticated: envMethod !== null,
        ...(envMethod ? { authMethod: envMethod } : {}),
        errorMessage: 'Claude Code CLI not found',
        installInstructions: 'Install Claude Code: https://code.claude.com/docs/en/setup',
      };
    }

    if (envMethod) {
      return { available: true, path: claudePath, authenticated: true, authMethod: envMethod };
    }

    try {
      const { stdout: authJson } = await execFileAsync(claudePath, ['auth', 'status', '--json'], { shell: true, timeout: AUTH_STATUS_TIMEOUT_MS });
      const auth = JSON.parse(authJson.trim());
      return {
        available: true,
        path: claudePath,
        authenticated: auth.loggedIn === true,
        authMethod: auth.authMethod,
        email: auth.email,
      };
    } catch {
      return { available: true, path: claudePath, authenticated: false };
    }
  }

  /** The API key saved in the app, as env for the agent process. Spread after
   *  the inherited env so it wins over a stale shell ANTHROPIC_API_KEY. */
  private savedKeyEnv(): Record<string, string> {
    const key = getApiKey(this.id);
    return key ? { [this.apiKey.envVar]: key } : {};
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

    // Browser tools for the conversation's Preview tab. Looking runs without
    // a prompt; clicking and typing ask like other action tools.
    if (config.previewOperations) {
      const previewServer = await createPreviewMcpServer(config.previewOperations);
      mcpServers = { ...(mcpServers ?? {}), 'grove-preview': previewServer };
      for (const t of GROVE_PREVIEW_READ_TOOL_NAMES) {
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
    let agentProcess: ReturnType<typeof spawnClaudeCodeProcess> | undefined;

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

      // Settings rules are written in neutral terms (shell(...), edit(...),
      // read(...), ...) or with Claude's tool names; both match here.
      // Chained shell commands are split first, so an allow rule has to
      // match every command in the chain (see checkToolRules). shell(...)
      // covers PowerShell too, split by PowerShell's own syntax.
      const category = categorizeToolName(toolName);
      const specifier = toolCallSpecifier(toolName, input, category);
      const shellSyntax = toolName === 'PowerShell' ? 'powershell' : 'bash';
      const ruleVerdict = checkToolRules(
        config.toolAllowRules, config.toolDenyRules, toolName, specifier, category, shellSyntax,
      );
      if (ruleVerdict?.behavior === 'deny') {
        return { behavior: 'deny' as const, message: `Denied by settings rule: ${ruleVerdict.pattern}` };
      }
      if (ruleVerdict?.behavior === 'allow') {
        return { behavior: 'allow' as const, updatedInput: input };
      }

      // Sandbox auto-approve Bash — only when the sandbox config opts in,
      // matching SDK semantics. Read-safe mode's sandbox deliberately does
      // NOT opt in: there the sandbox is an enforcement backstop and Bash
      // approval stays with the read-only classifier in the session's
      // permission handler.
      const sandboxConfig = config.sandbox as { autoAllowBashIfSandboxed?: boolean } | null | undefined;
      if (sandboxConfig?.autoAllowBashIfSandboxed && toolName === 'Bash') {
        return { behavior: 'allow' as const, updatedInput: input };
      }

      // Sandbox: validate file-writing tool paths against allowWrite
      if (config.sandbox) {
        const pathField = WRITE_TOOL_PATH_FIELD[toolName];
        const filePath = pathField ? (input as any)[pathField] : undefined;
        if (filePath && typeof filePath === 'string') {
          const allowWrite = (config.sandbox as any)?.filesystem?.allowWrite as string[] | undefined;
          if (allowWrite && allowWrite.length > 0) {
            const resolved = path.resolve(config.cwd, filePath);
            const allowed = allowWrite.some((dir: string) => isPathInside(path.resolve(config.cwd, dir), resolved));
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

    const learned = this.learnedFor(config.model);
    const { thinking, effort } = reasoningOptionsFor(config.model, config.controls, learned);
    const fastMode = config.controls?.[CONTROL_IDS.speed] === 'fast' && supportsFastMode(config.model, learned);

    const q: Query = queryFn({
      prompt: readableStreamToAsyncIterable(inputStream),
      options: {
        cwd: config.cwd,
        abortController,
        includePartialMessages: true,
        // We render a per-task stop control (see stopTask below), so an
        // interrupt only aborts the current turn and leaves background
        // tasks running. Without this the CLI fails closed and kills them.
        perTaskStopAffordance: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt,
        permissionMode: toSdkPermissionMode(config.permissionMode),
        ...(config.model ? { model: config.model } : {}),
        ...(supportsLargeContext(config.model) ? { betas: [CONTEXT_1M_BETA] } : {}),
        ...(config.skills ? { skills: config.skills } : {}),
        ...(config.outputFormat ? { outputFormat: config.outputFormat } : {}),
        ...(thinking ? { thinking } : {}),
        ...(effort ? { effort } : {}),
        ...(fastMode ? { settings: { fastMode: true } } : {}),
        ...(config.sandbox ? { sandbox: config.sandbox } : {}),
        ...(mcpServers ? { mcpServers } : {}),
        ...(config.resumeSessionId ? { resume: config.resumeSessionId } : {}),
        // Truncating resume (rewind): keep the conversation up to and including
        // the given chain-entry uuid and fork to a new session id, so the old
        // (pre-rewind) session stays intact on disk.
        ...(config.resumeSessionId && config.resumeAtUuid
          ? { resumeSessionAt: config.resumeAtUuid, forkSession: true }
          : {}),
        canUseTool: canUseTool as any,
        // Without a handler the SDK declines every elicitation.
        ...(config.onElicitation ? {
          onElicitation: async (request: SdkElicitationRequest, { signal }: { signal: AbortSignal }) => {
            const { action, content } = await config.onElicitation!(toMcpElicitationRequest(request), signal);
            return { action, ...(action === 'accept' && content ? { content } : {}) };
          },
        } : {}),
        spawnClaudeCodeProcess: (o: SpawnOptions) => {
          agentProcess = spawnClaudeCodeProcess(o, (data) => logger.debug(`[ClaudeCodeAdapter] SDK stderr: ${data}`));
          return agentProcess;
        },
        env: {
          ...cleanEnv(),
          CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
          ...this.savedKeyEnv(),
          ...(config.extraEnv ?? {}),
        },
        stderr: (data: string) => {
          logger.debug(`[ClaudeCodeAdapter] SDK stderr: ${data}`);
        },
      },
    });

    // Learn the current model list from the CLI (once per run).
    this.refreshModelsFrom(q);

    // Message context for the transform function
    const ctx: MessageContext = {
      toolUseMap: new Map(),
      groveMode: config.permissionMode,
    };

    // Create the async event generator
    async function* eventGenerator(): AsyncGenerator<AdapterEvent> {
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

      async interrupt() {
        // Cancels the in-flight turn via a control request but leaves the
        // process running, so a follow-up message resumes instantly.
        await q.interrupt();
      },

      async stopTask(taskId: string) {
        // Stops one background task; the SDK follows up with a
        // task_notification (status 'stopped') for it.
        await q.stopTask(taskId);
      },

      close() {
        try { inputController?.close(); } catch { /* may already be closed */ }
        try { q.close(); } catch { /* may already be closed */ }
      },

      getSessionId() {
        return sessionId;
      },

      processId() {
        // Only while it runs: once it has exited, Windows can give its PID to
        // an unrelated process.
        const running = agentProcess?.exitCode === null && agentProcess.signalCode == null;
        return running ? agentProcess?.pid : undefined;
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
        ctx.groveMode = mode;
        q.setPermissionMode(toSdkPermissionMode(mode));
      },

      async setControl(controlId: string, value: string) {
        switch (controlId) {
          case CONTROL_IDS.thinking:
            // The runtime token control can't express 'adaptive'; null clears
            // the limit so the provider default (adaptive on capable models)
            // applies until the next query start passes the full config.
            await q.setMaxThinkingTokens(THINKING_LEVEL_TOKENS[value as ThinkingLevel] ?? null);
            return;
          case CONTROL_IDS.effort:
            // Session-scoped; 'max' is accepted here though never persisted
            // to Claude Code's own settings files.
            await q.applyFlagSettings({ effortLevel: value as EffortLevel });
            return;
          case CONTROL_IDS.speed:
            await q.applyFlagSettings({ fastMode: value === 'fast' });
            return;
          default:
            throw new Error(`Unknown control "${controlId}" for Claude Code`);
        }
      },

      async getUsage(): Promise<ProviderUsage | null> {
        // The SDK marks this control as experimental and says the name will
        // change. Probe for it so an SDK bump degrades to "no usage" instead
        // of throwing from the status bar.
        const fn = (q as unknown as Record<string, unknown>)['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'];
        if (typeof fn !== 'function') return null;
        const res = await (fn as () => Promise<ClaudeUsageResponse>).call(q);
        return mapClaudeUsage(res);
      },

      async listMcpServers(): Promise<McpServerInfo[]> {
        const statuses = await q.mcpServerStatus();
        return statuses.map((s) => ({
          name: s.name,
          status: s.status,
          ...(s.error ? { error: s.error } : {}),
          ...(s.scope ? { scope: s.scope } : {}),
          ...(claudeMcpOrigin(s) ? { origin: claudeMcpOrigin(s) } : {}),
          ...(s.tools ? {
            toolCount: s.tools.length,
            tools: s.tools.map((t) => ({
              name: t.name,
              ...(t.description ? { description: t.description } : {}),
              ...(t.annotations?.readOnly ? { readOnly: true } : {}),
              ...(t.annotations?.destructive ? { destructive: true } : {}),
            })),
          } : {}),
        }));
      },

      async getMcpContextCost(): Promise<McpServerContextCost[]> {
        // 'summary' estimates locally instead of calling the token-count API
        // for every category; close enough for a per-server figure.
        const [usage, statuses] = await Promise.all([
          q.getContextUsage({ detail: 'summary' }),
          q.mcpServerStatus(),
        ]);
        return mcpContextCostByServer(usage.mcpTools ?? [], statuses.map((s) => s.name));
      },

      async reconnectMcpServer(serverName: string) {
        await q.reconnectMcpServer(serverName);
      },

      async setMcpServerEnabled(serverName: string, enabled: boolean) {
        await q.toggleMcpServer(serverName, enabled);
      },

      async authenticateMcpServer(serverName: string) {
        // `mcpAuthenticate` is shipped in the SDK bundle but missing from its
        // public typings. It asks the CLI to start the OAuth flow with browser
        // opening suppressed and returns the URL for the host to open.
        const authenticate = (q as unknown as {
          mcpAuthenticate?: (name: string, redirectUri?: string) => Promise<McpAuthenticateResponse | undefined>;
        }).mcpAuthenticate;
        if (typeof authenticate !== 'function') {
          throw new Error('MCP sign-in is not supported by this version of the Claude Agent SDK');
        }
        const res = await authenticate.call(q, serverName);
        return {
          ...(res?.authUrl ? { authUrl: res.authUrl } : {}),
          callbackExpected: res?.callbackExpected === true,
        };
      },
    };

    return handle;
  }

  // ─── Skill management (native format: .claude/skills/<name>/SKILL.md) ───

  async listSkills(worktreePath: string) {
    return skillsModule.listSkills(worktreePath);
  }

  async addSkill(worktreePath: string, def: SkillDefinition) {
    return skillsModule.writeSkill(worktreePath, def);
  }

  // ─── MCP server configuration (delegates to `claude mcp` CLI) ───

  async listConfiguredMcpServers(cwd?: string): Promise<McpConfiguredServer[]> {
    // `claude mcp list` health-checks each server, so this can take seconds.
    const { stdout } = await execFileAsync('claude', ['mcp', 'list'], {
      shell: true,
      ...(cwd ? { cwd } : {}),
      timeout: 60_000,
    });
    return parseMcpListOutput(stdout);
  }

  async addConfiguredMcpServer(opts: McpAddServerOpts): Promise<void> {
    const args = buildMcpAddArgs(opts);
    await execFileAsync('claude', args, {
      shell: true,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      timeout: 30_000,
    });
  }

  async removeConfiguredMcpServer(name: string, scope?: McpConfigScope, cwd?: string): Promise<void> {
    const managedBy = mcpServerManager(name);
    if (managedBy) {
      throw new Error(`${name} can't be removed from Grove Bench (${managedBy.label}). ${managedBy.hint}`);
    }
    validateMcpName(name);
    const args = ['mcp', 'remove', ...(scope ? ['-s', scope] : []), quoteArg(name)];
    await execFileAsync('claude', args, {
      shell: true,
      ...(cwd ? { cwd } : {}),
      timeout: 30_000,
    });
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

  async generateText(systemPrompt: string, userMessage: string, options?: { cwd?: string; abortSignal?: AbortSignal; model?: string }): Promise<string> {
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
    const keyEnv = this.savedKeyEnv();
    const q = queryFn({
      prompt: readableStreamToAsyncIterable(inputStream),
      options: {
        cwd: options?.cwd ?? process.cwd(),
        abortController,
        systemPrompt,
        permissionMode: 'plan',
        maxTurns: 1,
        ...(options?.model ? { model: options.model } : {}),
        // `env` replaces the inherited environment rather than merging, so
        // only pass it when there is a saved key to add.
        ...(Object.keys(keyEnv).length > 0 ? { env: { ...process.env, ...keyEnv } } : {}),
        spawnClaudeCodeProcess: (o: SpawnOptions) => spawnClaudeCodeProcess(o),
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

  // ─── Conversation title ───

  async getConversationTitle(providerSessionId: string, cwd: string): Promise<string | null> {
    const sdk = await getSdk();
    const info = await sdk.getSessionInfo(providerSessionId, { dir: cwd });
    // customTitle is the transcript's own title: a /rename title, else the
    // one Claude Code generates from the conversation (its ai-title entry).
    // `summary` falls back to prompt text, which Grove derives itself.
    return info?.customTitle?.replace(/\s+/g, ' ').trim() || null;
  }

  // ─── Worktree configuration ───

  async generateWorktreeSettings(wtPath: string, repoPath?: string): Promise<void> {
    const fs = await import('node:fs/promises');
    const claudeDir = path.join(wtPath, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.local.json');

    // The worktree gets its own settings.local.json, so carry over the
    // project's .mcp.json approvals or its servers stay pending in every
    // conversation (an SDK session can't show the CLI's approval prompt).
    const approvals = repoPath
      ? mcpjsonApprovalsFrom(await readSettingsFile(path.join(repoPath, '.claude', 'settings.local.json')).catch(() => ({})))
      : {};

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
          ...approvals,
        },
        null,
        2
      )
    );
  }

  async approveProjectMcpServer(name: string, dirs: string[]): Promise<void> {
    if (!name) throw new Error('Server name is required');
    const fs = await import('node:fs/promises');
    for (const dir of dirs) {
      const claudeDir = path.join(dir, '.claude');
      const settingsPath = path.join(claudeDir, 'settings.local.json');
      // A file we can't parse is the user's to fix; overwriting it would lose their settings.
      const current = await readSettingsFile(settingsPath);
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify(withMcpjsonApproval(current, name), null, 2));
    }
  }
}
