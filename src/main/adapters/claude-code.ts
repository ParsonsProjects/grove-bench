/**
 * Claude Code adapter — wraps the @anthropic-ai/claude-agent-sdk.
 */
import type { AgentEvent, McpServerInfo, McpConfiguredServer, McpAddServerOpts, McpConfigScope, ThinkingLevel, ToolCategory } from '../../shared/types.js';
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
function spawnClaudeCodeProcess(
  opts: SpawnOptions,
  onStderr?: (data: string) => void,
): SpawnedProcess {
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
  return child as unknown as SpawnedProcess;
}

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

/** File-writing tools mapped to the input field that holds the target path. */
const WRITE_TOOL_PATH_FIELD: Record<string, string> = {
  Edit: 'file_path',
  Write: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

/**
 * True if `child` resolves to a location inside (or equal to) `parent`.
 * Uses path.relative rather than string-prefix matching, so "/repo/src-secret"
 * is correctly treated as OUTSIDE "/repo/src". path.relative on win32 compares
 * case-insensitively and returns an absolute path across drives, both of which
 * this handles.
 */
export function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

// ─── SDKMessage → AgentEvent transform ───

/**
 * Context carried through the message-handling loop. The adapter's `start()`
 * method creates one of these per query and the event generator mutates it.
 */
interface MessageContext {
  /** Maps toolUseId → toolName for matching tool_results back to their tool. */
  toolUseMap: Map<string, string>;
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

// ─── MCP config CLI helpers ───

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

    const status: McpConfiguredServer['status'] =
      statusText.includes('connected') && !statusText.includes('not connected') ? 'connected'
        : statusText.includes('auth') ? 'needs-auth'
        : statusText.includes('pending') ? 'pending'
        : statusText.includes('disabled') ? 'disabled'
        : 'failed';

    servers.push({ name, target, ...(transport ? { transport } : {}), status });
  }
  return servers;
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
    mcpControl: true,
    plugins: true,
    imageAttachments: true,
    structuredOutput: true,
    sandbox: true,
  };

  // TODO: Hardcoded model list — update when new models are released, or fetch dynamically from the SDK if it exposes a model list.
  getModels(): ModelInfo[] {
    return [
      { id: 'claude-opus-5', label: 'Opus 5', family: 'Claude', contextWindow: 1_000_000 },
      { id: 'claude-fable-5', label: 'Fable 5', family: 'Claude', contextWindow: 1_000_000 },
      { id: 'claude-opus-4-8', label: 'Opus 4.8', family: 'Claude', contextWindow: 1_000_000 },
      { id: 'claude-opus-4-7', label: 'Opus 4.7', family: 'Claude', contextWindow: 1_000_000 },
      { id: 'claude-opus-4-6', label: 'Opus 4.6', family: 'Claude', contextWindow: 1_000_000 },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', family: 'Claude', contextWindow: 1_000_000 },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', family: 'Claude', contextWindow: 200_000 },
    ];
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
      const { stdout } = await execFileAsync(cmd, ['claude'], { shell: true });
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

    if (!claudePath) {
      return {
        available: false,
        errorMessage: 'Claude Code CLI not found',
        installInstructions: 'Install with: npm install -g @anthropic-ai/claude-code',
      };
    }

    try {
      const { stdout: authJson } = await execFileAsync(claudePath, ['auth', 'status', '--json'], { shell: true });
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

    const thinking = thinkingConfigFor(config.thinkingLevel);

    const q: Query = queryFn({
      prompt: readableStreamToAsyncIterable(inputStream),
      options: {
        cwd: config.cwd,
        abortController,
        includePartialMessages: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt,
        permissionMode: config.permissionMode,
        ...(config.model ? { model: config.model } : {}),
        ...(supportsLargeContext(config.model) ? { betas: [CONTEXT_1M_BETA] } : {}),
        ...(config.skills ? { skills: config.skills } : {}),
        ...(config.outputFormat ? { outputFormat: config.outputFormat } : {}),
        ...(thinking ? { thinking } : {}),
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
        spawnClaudeCodeProcess: (o: SpawnOptions) =>
          spawnClaudeCodeProcess(o, (data) => logger.debug(`[ClaudeCodeAdapter] SDK stderr: ${data}`)),
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

      async interrupt() {
        // Cancels the in-flight turn via a control request but leaves the
        // process running, so a follow-up message resumes instantly.
        await q.interrupt();
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
        q.setPermissionMode(mode);
      },

      async setThinkingLevel(level: ThinkingLevel) {
        await q.setMaxThinkingTokens(THINKING_LEVEL_TOKENS[level]);
      },

      async listMcpServers(): Promise<McpServerInfo[]> {
        const statuses = await q.mcpServerStatus();
        return statuses.map((s) => ({
          name: s.name,
          status: s.status,
          ...(s.error ? { error: s.error } : {}),
          ...(s.scope ? { scope: s.scope } : {}),
          ...(s.tools ? { toolCount: s.tools.length } : {}),
        }));
      },

      async reconnectMcpServer(serverName: string) {
        await q.reconnectMcpServer(serverName);
      },

      async setMcpServerEnabled(serverName: string, enabled: boolean) {
        await q.toggleMcpServer(serverName, enabled);
      },
    };

    return handle;
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
