/**
 * Mistral adapter — drives Mistral Vibe, Mistral's open-source CLI coding
 * agent (https://github.com/mistralai/mistral-vibe), over the Agent Client
 * Protocol via the `vibe-acp` binary it ships with.
 *
 * Grove is the ACP client: it spawns `vibe-acp` per session, negotiates
 * capabilities with `initialize`, opens a session rooted at the worktree, and
 * maps ACP `session/update` notifications onto Grove's adapter-agnostic
 * AgentEvent stream. Vibe owns the agent loop, tools, MCP servers, and
 * skills; permission prompts flow back through `session/request_permission`
 * into Grove's standard permission pipeline.
 */
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentEvent, PermissionMode, SkillDefinition, SkillInfo, ToolCategory } from '../../shared/types.js';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentQueryHandle,
  AdapterConfig,
  AdapterPrerequisiteStatus,
  ModelInfo,
  UserMessage,
} from './types.js';
import { cleanEnv, matchToolRule } from '../agent-utils.js';
import { scanSkillsDir, validateSkillName, skillManifestContent } from '../skills.js';
import { logger } from '../logger.js';
import { AcpConnection, AsyncEventQueue } from './acp-client.js';

const execFileAsync = promisify(execFile);

export const VIBE_INSTALL_INSTRUCTIONS =
  'Install with: uv tool install mistral-vibe (or pip install mistral-vibe)';

// ─── Permission modes ↔ vibe agent profiles ───

/**
 * Grove permission modes mapped to vibe's built-in agent profiles (exposed
 * over ACP as session modes). Grove's 'default' asks before edits AND shell
 * commands, which matches vibe's 'ask' profile; 'accept-edits' auto-approves
 * file edits only, mirroring Grove's acceptEdits.
 */
export const PERMISSION_MODE_TO_VIBE_MODE: Record<PermissionMode, string> = {
  default: 'ask',
  plan: 'plan',
  acceptEdits: 'accept-edits',
};

export const VIBE_MODE_TO_PERMISSION_MODE: Record<string, PermissionMode> = {
  ask: 'default',
  plan: 'plan',
  'accept-edits': 'acceptEdits',
};

// ─── Tool categorization ───

/**
 * Map an ACP tool-call `kind` (the spec's read/edit/execute/fetch/… taxonomy)
 * to Grove's adapter-agnostic categories, falling back to name sniffing on
 * the title for agents that omit the kind.
 */
export function categorizeToolKind(kind?: string, title?: string): ToolCategory {
  switch (kind) {
    case 'edit':
    case 'delete':
    case 'move':
      return 'edit';
    case 'execute':
      return 'bash';
    case 'fetch':
      return 'web_fetch';
    default: {
      const t = (title ?? '').toLowerCase();
      if (/\b(bash|shell|command|execute)\b/.test(t)) return 'bash';
      if (/\b(write|edit|patch)\b/.test(t)) return 'edit';
      if (/\b(fetch|http|web)\b/.test(t)) return 'web_fetch';
      if (/\b(task|agent|subagent)\b/.test(t)) return 'agent';
      return 'other';
    }
  }
}

// ─── ACP session/update → AgentEvent transform ───

/** Context carried through one query's update stream. */
export interface VibeMessageContext {
  /** toolCallId → tool name (ACP title), for permission and result matching. */
  toolNames: Map<string, string>;
  /** toolCallIds whose terminal tool_result has been emitted already. */
  reportedTools: Set<string>;
  /** Streamed assistant text not yet finalized into an assistant_text event. */
  pendingText: string;
  /** Streamed thought text not yet finalized into a thinking event. */
  pendingThought: string;
  /** True while a session/load replay is in flight — replayed updates are
   *  dropped because Grove restores its own persisted event history. */
  suppress: boolean;
}

export function createVibeContext(): VibeMessageContext {
  return { toolNames: new Map(), reportedTools: new Set(), pendingText: '', pendingThought: '', suppress: false };
}

/** Finalize buffered thought/text into complete thinking / assistant_text
 *  events — called at block boundaries (a tool call arrives, the turn ends). */
export function flushPending(ctx: VibeMessageContext): AgentEvent[] {
  const events: AgentEvent[] = [];
  if (ctx.pendingThought) {
    events.push({ type: 'thinking', thinking: ctx.pendingThought, uuid: crypto.randomUUID() });
    ctx.pendingThought = '';
  }
  if (ctx.pendingText) {
    events.push({ type: 'assistant_text', text: ctx.pendingText, uuid: crypto.randomUUID() });
    ctx.pendingText = '';
  }
  return events;
}

/** Extract display text from an ACP content block (text blocks only — image
 *  and resource blocks render as a placeholder). */
function contentBlockText(block: unknown): string {
  const b = block as { type?: string; text?: string } | undefined;
  if (!b) return '';
  if (b.type === 'text' && typeof b.text === 'string') return b.text;
  return b.type ? `[${b.type}]` : '';
}

/** Render ACP ToolCallContent entries (content / diff / terminal) as text for
 *  Grove's tool_result event. */
export function toolCallContentToString(content: unknown[] | undefined, rawOutput?: unknown): string {
  const parts: string[] = [];
  for (const item of content ?? []) {
    const c = item as Record<string, unknown>;
    if (c.type === 'content') {
      parts.push(contentBlockText(c.content));
    } else if (c.type === 'diff') {
      const p = typeof c.path === 'string' ? c.path : '';
      parts.push(`[diff${p ? ` ${p}` : ''}]\n${typeof c.newText === 'string' ? c.newText : ''}`);
    } else if (c.type === 'terminal') {
      parts.push('[terminal output]');
    }
  }
  if (parts.length === 0 && rawOutput !== undefined) {
    parts.push(typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput));
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * Transform one ACP `session/update` payload into zero or more AgentEvents.
 * Pure (given the context bag) so it can be tested against fixtures, like the
 * Claude adapter's transformMessage.
 */
export function transformSessionUpdate(update: unknown, ctx: VibeMessageContext): AgentEvent[] {
  if (ctx.suppress) return [];
  const u = update as Record<string, any>;
  const events: AgentEvent[] = [];

  switch (u?.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = contentBlockText(u.content);
      if (text) {
        if (!ctx.pendingText && !ctx.pendingThought) events.push({ type: 'activity', activity: 'generating' });
        ctx.pendingText += text;
        events.push({ type: 'partial_text', text });
      }
      break;
    }

    case 'agent_thought_chunk': {
      const text = contentBlockText(u.content);
      if (text) {
        if (!ctx.pendingThought) events.push({ type: 'activity', activity: 'thinking' });
        ctx.pendingThought += text;
        events.push({ type: 'partial_thinking', text });
      }
      break;
    }

    case 'tool_call': {
      events.push(...flushPending(ctx));
      const toolName = typeof u.title === 'string' && u.title ? u.title : (u.kind ?? 'tool');
      ctx.toolNames.set(u.toolCallId, toolName);
      events.push({ type: 'activity', activity: 'tool_starting', toolName });
      events.push({
        type: 'assistant_tool_use',
        toolName,
        toolInput: u.rawInput ?? {},
        toolUseId: u.toolCallId,
        uuid: crypto.randomUUID(),
        toolCategory: categorizeToolKind(u.kind, toolName),
      });
      // Some agents report a tool call already completed in one update.
      if ((u.status === 'completed' || u.status === 'failed') && !ctx.reportedTools.has(u.toolCallId)) {
        ctx.reportedTools.add(u.toolCallId);
        events.push({
          type: 'tool_result',
          toolUseId: u.toolCallId,
          content: toolCallContentToString(u.content, u.rawOutput),
          isError: u.status === 'failed',
        });
      }
      break;
    }

    case 'tool_call_update': {
      if ((u.status === 'completed' || u.status === 'failed') && !ctx.reportedTools.has(u.toolCallId)) {
        ctx.reportedTools.add(u.toolCallId);
        events.push({
          type: 'tool_result',
          toolUseId: u.toolCallId,
          content: toolCallContentToString(u.content, u.rawOutput),
          isError: u.status === 'failed',
        });
      }
      break;
    }

    case 'current_mode_update': {
      const mapped = VIBE_MODE_TO_PERMISSION_MODE[u.currentModeId as string];
      if (mapped) events.push({ type: 'mode_sync', mode: mapped, source: 'sdk' });
      break;
    }

    // Plan and command-list updates have no Grove counterpart yet.
    default:
      break;
  }

  return events;
}

// ─── Auth helpers ───

/** Parse a KEY=value line out of dotenv-style content (vibe stores its key in
 *  ~/.vibe/.env). Handles optional `export ` prefixes and simple quoting. */
export function parseDotEnvKey(content: string, key: string): string | undefined {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || match[1] !== key) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value || undefined;
  }
  return undefined;
}

/** Grove settings key, falling back to the environment and vibe's own
 *  credential file. Settings are imported lazily so this module stays loadable
 *  outside Electron (unit tests). */
async function getMistralApiKey(): Promise<string | undefined> {
  try {
    const settings = await import('../settings.js');
    const fromSettings = settings.getSettings().mistralApiKey;
    if (fromSettings) return fromSettings;
  } catch { /* not running under Electron */ }
  if (process.env.MISTRAL_API_KEY) return process.env.MISTRAL_API_KEY;
  try {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(path.join(os.homedir(), '.vibe', '.env'), 'utf8');
    return parseDotEnvKey(content, 'MISTRAL_API_KEY');
  } catch {
    return undefined;
  }
}

// ─── ACP wire types (the subset this adapter touches) ───

interface AcpInitializeResult {
  protocolVersion?: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
  };
}

interface AcpSessionResult {
  sessionId?: string;
  models?: { availableModels?: Array<{ modelId: string; name?: string }>; currentModelId?: string };
  modes?: { currentModeId?: string; availableModes?: Array<{ id: string; name?: string }> };
}

interface AcpPermissionParams {
  sessionId?: string;
  toolCall?: { toolCallId?: string; title?: string; kind?: string; rawInput?: Record<string, unknown> };
  options?: Array<{ optionId: string; name?: string; kind?: string }>;
}

/** Pick the ACP permission option matching an allow/deny decision. */
export function selectPermissionOption(
  options: Array<{ optionId: string; kind?: string }>,
  behavior: 'allow' | 'deny',
): string | undefined {
  const preferred = behavior === 'allow' ? 'allow_once' : 'reject_once';
  const family = behavior === 'allow' ? 'allow' : 'reject';
  return options.find((o) => o.kind === preferred)?.optionId
    ?? options.find((o) => o.kind?.startsWith(family))?.optionId;
}

// ─── The adapter ───

export class MistralVibeAdapter implements AgentAdapter {
  readonly id = 'mistral-vibe';
  readonly displayName = 'Mistral';
  readonly authErrorMessage =
    'No Mistral API key found. Set it in Settings, or run "vibe --setup" (keys at https://console.mistral.ai/).';
  readonly capabilities: AgentCapabilities = {
    permissions: true,
    permissionModes: true,
    resume: true,          // via ACP session/load when the agent advertises it
    modelSwitching: true,  // via ACP session/set_model when advertised
    thinking: false,
    mcpControl: false,
    plugins: false,
    skills: true,          // vibe implements the same SKILL.md spec (.vibe/skills, .agents/skills)
    imageAttachments: false,
    structuredOutput: false,
    sandbox: false,
  };

  // TODO: Hardcoded model list — same caveat as the Claude adapter (TODO.md).
  getModels(): ModelInfo[] {
    return [
      { id: 'devstral-2512', label: 'Devstral 2', family: 'Mistral', contextWindow: 256_000 },
      { id: 'mistral-large-2512', label: 'Mistral Large 3', family: 'Mistral', contextWindow: 256_000 },
      { id: 'codestral-2508', label: 'Codestral', family: 'Mistral', contextWindow: 256_000 },
      { id: 'magistral-medium-2509', label: 'Magistral Medium', family: 'Mistral', contextWindow: 128_000 },
      { id: 'mistral-medium-latest', label: 'Mistral Medium', family: 'Mistral', contextWindow: 128_000 },
    ];
  }

  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> {
    // Locate the vibe-acp binary. Same Windows caveat as the Claude adapter:
    // GUI-launched Electron often misses user-level PATH entries, so probe
    // uv/pip's default install location before giving up.
    let vibePath: string | undefined;
    try {
      const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(cmd, ['vibe-acp'], { shell: true });
      vibePath = stdout.trim().split(/\r?\n/)[0] || undefined;
    } catch {
      const fs = await import('node:fs');
      const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
      const candidates = process.platform === 'win32'
        ? [
            path.join(home, '.local', 'bin', 'vibe-acp.exe'),
            path.join(home, '.local', 'bin', 'vibe-acp'),
          ]
        : [path.join(home, '.local', 'bin', 'vibe-acp')];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          vibePath = c;
          break;
        }
      }
    }

    if (!vibePath) {
      return {
        available: false,
        errorMessage: 'Mistral Vibe CLI not found',
        installInstructions: VIBE_INSTALL_INSTRUCTIONS,
      };
    }

    const apiKey = await getMistralApiKey();
    return {
      available: true,
      path: vibePath,
      authenticated: !!apiKey,
      authMethod: 'api_key',
    };
  }

  async start(config: AdapterConfig): Promise<AgentQueryHandle> {
    const queue = new AsyncEventQueue<AgentEvent>();
    const ctx = createVibeContext();
    let sessionId: string | null = null;
    let currentModel: string | null = config.model ?? null;
    let closed = false;

    if (config.memoryOperations) {
      // Grove memory tools are an in-process MCP server; an external ACP agent
      // can't reach it. Memory content still reaches vibe via the system-
      // prompt append injected into the first message below.
      logger.debug('[MistralVibeAdapter] memoryOperations not supported over ACP — memory tools disabled');
    }

    // ── Permission pipeline (mirrors the Claude adapter's canUseTool) ──
    const decidePermission = async (params: AcpPermissionParams): Promise<{ optionId?: string; cancelled?: boolean }> => {
      const options = params.options ?? [];
      const toolCall = params.toolCall ?? {};
      const toolName = (toolCall.toolCallId && ctx.toolNames.get(toolCall.toolCallId))
        ?? toolCall.title ?? toolCall.kind ?? 'tool';
      const input = toolCall.rawInput ?? {};

      const allow = () => ({ optionId: selectPermissionOption(options, 'allow') });
      const deny = () => {
        const optionId = selectPermissionOption(options, 'deny');
        return optionId ? { optionId } : { cancelled: true };
      };

      if (config.allowedTools && !config.allowedTools.has(toolName)) return deny();

      const toolCallStr = typeof (input as any)?.command === 'string'
        ? `${toolName}(${(input as any).command})`
        : toolName;
      for (const rule of config.toolDenyRules) {
        if (matchToolRule(rule.pattern, toolName, toolCallStr)) return deny();
      }
      for (const rule of config.toolAllowRules) {
        if (matchToolRule(rule.pattern, toolName, toolCallStr)) return allow();
      }
      if (config.alwaysAllowedTools.has(toolName)) return allow();

      const response = await config.onPermissionRequest({
        requestId: '',
        toolName,
        toolUseId: toolCall.toolCallId ?? '',
        toolInput: input,
        toolCategory: categorizeToolKind(toolCall.kind, toolName),
      });
      return response.behavior === 'allow' ? allow() : deny();
    };

    const env = {
      ...cleanEnv(),
      ...(await getMistralApiKey().then((k) => (k ? { MISTRAL_API_KEY: k } : {}))),
      ...(config.extraEnv ?? {}),
    };

    const conn = new AcpConnection({
      command: 'vibe-acp',
      cwd: config.cwd,
      env,
      onStderr: (data) => logger.debug(`[MistralVibeAdapter] stderr: ${data}`),
      onExit: (code) => {
        if (closed) return;
        closed = true;
        queue.push({ type: 'process_exit', exitCode: code ?? undefined });
        queue.end();
      },
      onNotification: (method, params) => {
        if (method !== 'session/update') return;
        const p = params as { sessionId?: string; update?: unknown };
        if (sessionId && p.sessionId && p.sessionId !== sessionId) return;
        for (const event of transformSessionUpdate(p.update, ctx)) queue.push(event);
      },
      onRequest: async (method, params) => {
        if (method === 'session/request_permission') {
          const decision = await decidePermission(params as AcpPermissionParams);
          return decision.cancelled || !decision.optionId
            ? { outcome: { outcome: 'cancelled' } }
            : { outcome: { outcome: 'selected', optionId: decision.optionId } };
        }
        // fs/* and terminal/* are not advertised in our client capabilities.
        throw new Error(`Method not supported by this client: ${method}`);
      },
    });

    // ── Handshake + session ──
    let init: AcpInitializeResult = {};
    try {
      init = await conn.request<AcpInitializeResult>('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      });

      let session: AcpSessionResult | null = null;
      if (config.resumeSessionId && init.agentCapabilities?.loadSession) {
        try {
          // session/load replays history as session/update notifications;
          // Grove restores its own persisted history, so drop the replay.
          ctx.suppress = true;
          session = await conn.request<AcpSessionResult>('session/load', {
            sessionId: config.resumeSessionId,
            cwd: config.cwd,
            mcpServers: [],
          });
          sessionId = config.resumeSessionId;
        } catch (e: any) {
          logger.warn(`[MistralVibeAdapter] session/load failed (${e?.message}); starting fresh`);
          session = null;
        } finally {
          ctx.suppress = false;
        }
      }
      if (!session || !sessionId) {
        session = await conn.request<AcpSessionResult>('session/new', { cwd: config.cwd, mcpServers: [] });
        sessionId = session.sessionId ?? null;
      }
      if (!sessionId) throw new Error('ACP agent returned no session id');

      currentModel = session.models?.currentModelId ?? currentModel;

      // Align vibe's agent profile with Grove's permission mode (best effort —
      // older agents may not expose modes).
      const targetMode = PERMISSION_MODE_TO_VIBE_MODE[config.permissionMode];
      const availableModes = session.modes?.availableModes ?? [];
      if (targetMode && session.modes?.currentModeId !== targetMode
        && availableModes.some((m) => m.id === targetMode)) {
        await conn.request('session/set_mode', { sessionId, modeId: targetMode }).catch((e: any) =>
          logger.debug(`[MistralVibeAdapter] session/set_mode failed: ${e?.message}`));
      }

      // Apply the requested model when the agent supports selection.
      if (config.model && session.models && session.models.currentModelId !== config.model) {
        try {
          await conn.request('session/set_model', { sessionId, modelId: config.model });
          currentModel = config.model;
        } catch (e: any) {
          logger.debug(`[MistralVibeAdapter] session/set_model failed: ${e?.message}`);
        }
      }
    } catch (e) {
      conn.close();
      throw e;
    }

    queue.push({
      type: 'system_init',
      sessionId,
      model: currentModel ?? '',
      tools: [],
    });

    // ── Prompt turns ──
    // ACP allows one prompt turn at a time per session; serialize sends.
    let promptChain: Promise<void> = Promise.resolve();
    let firstPrompt = true;
    const imageSupport = init.agentCapabilities?.promptCapabilities?.image === true;

    const runPrompt = async (message: UserMessage) => {
      const blocks: Array<Record<string, unknown>> = [];
      let text = message.text;
      if (firstPrompt) {
        // ACP has no system-prompt parameter — deliver Grove's session
        // instructions (path rules, project memory, caveman mode, user
        // append) as a preamble on the first message.
        const instructions = config.customSystemPrompt ?? config.appendSystemPrompt;
        if (instructions) {
          text = `<session-instructions>\n${instructions}\n</session-instructions>\n\n${text}`;
        }
        firstPrompt = false;
      }
      if (imageSupport && message.images) {
        for (const img of message.images) {
          blocks.push({ type: 'image', data: img.data, mimeType: img.mediaType });
        }
      }
      blocks.push({ type: 'text', text });

      const startedAt = Date.now();
      try {
        const result = await conn.request<{ stopReason?: string }>('session/prompt', {
          sessionId,
          prompt: blocks,
        });
        for (const event of flushPending(ctx)) queue.push(event);
        const stopReason = result?.stopReason ?? 'end_turn';
        queue.push({
          type: 'result',
          subtype: stopReason,
          durationMs: Date.now() - startedAt,
          isError: stopReason === 'refusal',
        });
      } catch (e: any) {
        if (closed) return;
        for (const event of flushPending(ctx)) queue.push(event);
        queue.push({ type: 'error', message: e?.message ?? String(e) });
        queue.push({
          type: 'result',
          subtype: 'error',
          durationMs: Date.now() - startedAt,
          isError: true,
          errors: [e?.message ?? String(e)],
        });
      }
    };

    const handle: AgentQueryHandle = {
      events: queue as AsyncIterable<AgentEvent>,

      sendMessage(message: UserMessage) {
        promptChain = promptChain.then(() => runPrompt(message));
      },

      abort() {
        if (sessionId) conn.notify('session/cancel', { sessionId });
        closed = true;
        conn.close();
        queue.end();
      },

      async interrupt() {
        // Cancels the in-flight turn; the pending session/prompt resolves
        // with stopReason 'cancelled' and the process stays alive.
        if (sessionId) conn.notify('session/cancel', { sessionId });
      },

      close() {
        closed = true;
        conn.close();
        queue.end();
      },

      getSessionId() {
        return sessionId;
      },

      async setModel(model: string) {
        await conn.request('session/set_model', { sessionId, modelId: model });
        currentModel = model;
      },

      setPermissionMode(mode: PermissionMode) {
        const modeId = PERMISSION_MODE_TO_VIBE_MODE[mode];
        if (!modeId || !sessionId) return;
        conn.request('session/set_mode', { sessionId, modeId }).catch((e: any) =>
          logger.debug(`[MistralVibeAdapter] session/set_mode failed: ${e?.message}`));
      },
    };

    return handle;
  }

  // ─── Skill management (SKILL.md spec: .vibe/skills + .agents/skills) ───

  async listSkills(worktreePath: string): Promise<SkillInfo[]> {
    const project = [
      ...scanSkillsDir(path.join(worktreePath, '.vibe', 'skills'), 'project'),
      ...scanSkillsDir(path.join(worktreePath, '.agents', 'skills'), 'project'),
    ];
    const user = [
      ...scanSkillsDir(path.join(os.homedir(), '.vibe', 'skills'), 'user'),
      ...scanSkillsDir(path.join(os.homedir(), '.agents', 'skills'), 'user'),
    ];
    // Project skills shadow user skills of the same name (matches vibe's
    // discovery order); later duplicates within a scope are dropped.
    const seen = new Set<string>();
    const merged: SkillInfo[] = [];
    for (const skill of [...project, ...user]) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      merged.push(skill);
    }
    return merged;
  }

  async addSkill(worktreePath: string, def: SkillDefinition): Promise<SkillInfo> {
    validateSkillName(def.name);
    const fs = await import('node:fs');
    const root = def.scope === 'user' ? os.homedir() : worktreePath;
    const skillDir = path.join(root, '.vibe', 'skills', def.name);
    const manifestPath = path.join(skillDir, 'SKILL.md');
    if (fs.existsSync(manifestPath)) {
      throw new Error(`Skill "${def.name}" already exists`);
    }
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(manifestPath, skillManifestContent(def));
    return { name: def.name, description: def.description, source: def.scope === 'user' ? 'user' : 'project', path: manifestPath };
  }

  // ─── Text generation (memory extraction, commit messages) ───

  async generateText(systemPrompt: string, userMessage: string, options?: { cwd?: string; abortSignal?: AbortSignal }): Promise<string> {
    const apiKey = await getMistralApiKey();
    if (!apiKey) throw new Error('No Mistral API key configured');

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: options?.abortSignal ?? null,
    });
    if (!response.ok) {
      throw new Error(`Mistral API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }
}
