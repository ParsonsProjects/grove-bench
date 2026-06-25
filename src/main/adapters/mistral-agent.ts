/**
 * Mistral adapter for Grove Bench
 */
import type { AgentEvent, ToolCategory } from '../../shared/types.js';
import type { AgentAdapter, AgentCapabilities, AgentQueryHandle, AdapterConfig, AdapterPrerequisiteStatus, ModelInfo } from './types.js';
import { cleanEnv, matchToolRule } from '../agent-utils.js';
import { createMemoryMcpServer, GROVE_MEMORY_TOOL_NAMES } from './memory-mcp-server.js';
import { logger } from '../logger.js';

type MistralClient = import('@mistralai/mistralai').Mistral;
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<typeof import('@mistralai/mistralai')>;
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

interface MessageContext { toolUseMap: Map<string, string>; detectedPorts: Set<number>; }

export function transformMistralEvent(event: any, ctx: MessageContext): AgentEvent[] {
  const events: AgentEvent[] = [];
  switch (event.type) {
    case 'message_start': events.push({ type: 'activity', activity: 'generating' }); break;
    case 'message_delta':
      const delta = event.delta;
      if (delta?.type === 'text_delta' && delta.text) events.push({ type: 'partial_text', text: delta.text });
      else if (delta?.type === 'thinking_delta' && delta.thinking) events.push({ type: 'partial_thinking', text: delta.thinking });
      break;
    case 'tool_call':
      const tc = event.tool_call;
      if (tc) {
        ctx.toolUseMap.set(tc.id, tc.name);
        events.push({ type: 'assistant_tool_use', toolName: tc.name, toolInput: tc.arguments ? JSON.parse(tc.arguments) : {}, toolUseId: tc.id, uuid: '', toolCategory: categorizeToolName(tc.name) });
      }
      break;
    case 'tool_result':
      const tr = event.tool_result;
      if (tr) events.push({ type: 'tool_result', toolUseId: tr.tool_call_id, content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content), isError: tr.is_error });
      break;
    case 'error': events.push({ type: 'error', message: event.error?.message || 'Unknown error' }); break;
    case 'usage': events.push({ type: 'usage', inputTokens: event.usage?.input_tokens ?? 0, outputTokens: event.usage?.output_tokens ?? 0 }); break;
    case 'rate_limit': events.push({ type: 'rate_limit', status: event.status ?? 'allowed', resetsAt: event.resets_at, utilization: event.utilization, rateLimitType: event.rate_limit_type }); break;
    default: logger.debug('[MistralAdapter] Unhandled event: ' + event.type); break;
  }
  return events;
}

export class MistralAdapter implements AgentAdapter {
  readonly id = 'mistral';
  readonly displayName = 'Mistral';
  readonly authErrorMessage = 'Authentication failed. Please set MISTRAL_API_KEY environment variable.';
  readonly capabilities: AgentCapabilities = {
    permissions: true, permissionModes: false, resume: true, modelSwitching: true,
    thinking: true, plugins: false, imageAttachments: true, structuredOutput: true, sandbox: false
  };

  getModels(): ModelInfo[] {
    return [
      { id: 'mistral-large-latest', label: 'Mistral Large', family: 'Mistral' },
      { id: 'mistral-small-latest', label: 'Mistral Small', family: 'Mistral' },
      { id: 'codestral-latest', label: 'Codestral', family: 'Mistral' },
      { id: 'mistral-medium-latest', label: 'Mistral Medium', family: 'Mistral' }
    ];
  }

  async checkPrerequisites(): Promise<AdapterPrerequisiteStatus> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      return { available: false, errorMessage: 'Mistral API key not found', installInstructions: 'Set MISTRAL_API_KEY from https://console.mistral.ai/' };
    }
    try {
      const m = await getMistral();
      await m.models.list();
      return { available: true, authenticated: true, authMethod: 'api_key' };
    } catch (e: any) {
      const msg = e?.message || 'Auth failed';
      return { available: true, authenticated: false, authMethod: 'api_key', errorMessage: msg.includes('Invalid') ? 'Invalid API key' : msg };
    }
  }

  async start(config: AdapterConfig): Promise<AgentQueryHandle> {
    const mistral = await getMistral();
    let mcpServers: Record<string, any> | undefined;
    if (config.memoryOperations) {
      const ms = await createMemoryMcpServer(config.memoryOperations);
      mcpServers = { 'grove-memory': ms };
      for (const t of GROVE_MEMORY_TOOL_NAMES) config.alwaysAllowedTools.add(t);
    }

    const abortCtrl = new AbortController();
    let sessionId: string | null = null;
    let currentModel = config.model || 'codestral-latest';

    const canUseTool = async (toolName: string, input: Record<string, unknown>, toolCallId: string) => {
      if (config.allowedTools && !config.allowedTools.has(toolName)) return { behavior: 'deny' as const, message: 'Tool not allowed' };
      const tc = typeof (input as any)?.command === 'string' ? toolName + '(' + (input as any).command + ')' : toolName;
      for (const rule of config.toolDenyRules) if (matchToolRule(rule.pattern, toolName, tc)) return { behavior: 'deny' as const, message: 'Denied by rule: ' + rule.pattern };
      for (const rule of config.toolAllowRules) if (matchToolRule(rule.pattern, toolName, tc)) return { behavior: 'allow' as const, updatedInput: input };
      if (config.alwaysAllowedTools.has(toolName)) return { behavior: 'allow' as const, updatedInput: input };
      const resp = await config.onPermissionRequest({ requestId: '', toolName, toolUseId: toolCallId, toolInput: input, toolCategory: categorizeToolName(toolName) });
      return resp.behavior === 'allow' ? { behavior: 'allow' as const, updatedInput: resp.updatedInput } : { behavior: 'deny' as const, message: resp.message };
    };

    const stream = await mistral.agents.stream({ model: currentModel, messages: [], tools: [], responseFormat: { type: 'text' } });
    const ctx: MessageContext = { toolUseMap: new Map(), detectedPorts: new Set() };
    let sysInitSent = false;

    async function* eventGenerator(): AsyncGenerator<AgentEvent> {
      for await (const event of stream) {
        if (abortCtrl.signal.aborted) break;
        if (!sessionId && event.type === 'message_start') {
          sessionId = 'mistral-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          yield { type: 'system_init', sessionId, model: currentModel, tools: [], mcpServers: mcpServers ? Object.keys(mcpServers).map(n => ({ name: n, status: 'connected' })) : undefined };
          sysInitSent = true;
        }
        for (const evt of transformMistralEvent(event, ctx)) yield evt;
      }
      if (!sysInitSent) yield { type: 'system_init', sessionId: sessionId || 'mistral-' + Date.now(), model: currentModel, tools: [], mcpServers: mcpServers ? Object.keys(mcpServers).map(n => ({ name: n, status: 'connected' })) : undefined };
    }

    return {
      events: eventGenerator(),
      sendMessage(m: any) { logger.debug('[MistralAdapter] sendMessage'); },
      abort() { abortCtrl.abort(); },
      close() { try { (stream as any).return(); } catch {} },
      getSessionId() { return sessionId; },
      async setModel(model: string) { currentModel = model; },
      setPermissionMode() {}
    };
  }

  async generateText(systemPrompt: string, userMessage: string, opts?: { cwd?: string; abortSignal?: AbortSignal }): Promise<string> {
    const m = await getMistral();
    let result = '';
    const s = await m.chat.stream({ model: 'codestral-latest', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }] });
    for await (const e of s) if (e.type === 'message_delta' && e.delta?.content) result += e.delta.content;
    return result;
  }

  async generateWorktreeSettings(wtPath: string): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = path.join(wtPath, '.mistral');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ adapter: 'mistral', createdAt: new Date().toISOString() }, null, 2));
  }

  async listPlugins() { return { installed: [], available: [] }; }
  async installPlugin(id: string, s?: string) { logger.debug('[Mistral] installPlugin: ' + id); }
  async uninstallPlugin(id: string) { logger.debug('[Mistral] uninstallPlugin: ' + id); }
  async enablePlugin(id: string) { logger.debug('[Mistral] enablePlugin: ' + id); }
  async disablePlugin(id: string) { logger.debug('[Mistral] disablePlugin: ' + id); }
  async dispose() { _mistral = null; }
}