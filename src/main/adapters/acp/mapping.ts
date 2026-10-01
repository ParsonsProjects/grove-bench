/**
 * Pure translations between ACP and Grove: tool calls to tool views and
 * categories, config options and modes to controls, Grove decisions to
 * permission options. No I/O, so it is tested directly.
 */
import path from 'node:path';
import type { ControlDescriptor, ControlOption, ToolCategory } from '../../../shared/types.js';
import type { ToolView, ToolTextEdit } from '../../../shared/tool-view.js';
import type {
  AcpConfigOption, AcpConfigSelectOption, AcpContentBlock, AcpModeState, AcpModelState, AcpPermissionOption,
  AcpPermissionOptionKind, AcpPlanEntry, AcpToolCall, AcpToolKind,
} from './protocol.js';

// ─── Tool calls ───

/** Merge an update into the call as known so far. Absent and null fields
 *  leave the earlier value (the ACP rule for tool_call_update). */
export function mergeToolCall(prev: AcpToolCall | undefined, update: AcpToolCall): AcpToolCall {
  const next: AcpToolCall = { ...(prev ?? { toolCallId: update.toolCallId }) };
  for (const key of ['title', 'name', 'kind', 'status', 'content', 'locations', 'rawInput', 'rawOutput'] as const) {
    const v = update[key];
    if (v !== undefined && v !== null) (next as unknown as Record<string, unknown>)[key] = v;
  }
  return next;
}

export function categoryForKind(kind: AcpToolKind | null | undefined): ToolCategory {
  switch (kind) {
    case 'edit':
    case 'delete':
    case 'move': return 'edit';
    case 'read':
    case 'search': return 'read';
    case 'execute': return 'bash';
    case 'fetch': return 'web_fetch';
    default: return 'other';
  }
}

/** Kinds Grove treats as one tool when the agent sends no name, as it does
 *  Claude Code's: "always allow" on one command allows every command. */
const KIND_WIDE: ReadonlySet<string> = new Set(['execute', 'edit', 'delete', 'move', 'read', 'search', 'fetch', 'think', 'switch_mode']);

/** The name Grove keys the call by (always-allow, rules, display): the
 *  agent's programmatic name when it sends one. Without one (Gemini CLI
 *  sends none) the kinds above use the kind, and anything else, MCP tools
 *  among them, its title: otherwise allowing one MCP tool would allow them
 *  all. */
export function toolNameFor(call: AcpToolCall): string {
  const name = typeof call.name === 'string' ? call.name.trim() : '';
  if (name) return name;
  const kind = call.kind || 'other';
  if (KIND_WIDE.has(kind)) return kind;
  const title = typeof call.title === 'string' ? call.title.trim() : '';
  return title || kind;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

/** The command an execute call runs, when the agent put it in rawInput. A
 *  title is never taken for the command: Read-safe mode checks this string. */
export function commandOf(rawInput: unknown): string | undefined {
  const input = rec(rawInput);
  const cmd = input.command ?? input.cmd;
  if (typeof cmd === 'string' && cmd.trim()) return cmd;
  if (Array.isArray(cmd) && cmd.length > 0 && cmd.every((c) => typeof c === 'string')) {
    // An argv. Quote what a shell would split, for display and rule matching.
    return (cmd as string[]).map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
  }
  return undefined;
}

/** The paths a call names: its locations, its diffs, and common rawInput fields. */
function pathsOf(call: AcpToolCall): string[] {
  const out: string[] = [];
  const add = (p: unknown) => {
    if (typeof p === 'string' && p.trim() && !out.includes(p)) out.push(p);
  };
  for (const loc of call.locations ?? []) add(loc?.path);
  for (const c of call.content ?? []) if (c?.type === 'diff') add(c.path);
  const input = rec(call.rawInput);
  add(firstString(input, 'file_path', 'absolute_path', 'path', 'filePath'));
  return out;
}

/** Text a tool returned, for the tool_result Grove shows. */
export function contentText(content: AcpToolCall['content']): string {
  const parts: string[] = [];
  for (const c of content ?? []) {
    if (c?.type === 'content') {
      const block = c.content as AcpContentBlock;
      if (block?.type === 'text') parts.push(block.text);
      else if (block?.type === 'resource' && typeof block.resource?.text === 'string') parts.push(block.resource.text);
      else if (block?.type === 'resource_link') parts.push(block.uri);
    } else if (c?.type === 'diff') {
      parts.push(`${c.oldText == null ? 'Created' : 'Edited'} ${c.path}`);
    }
  }
  return parts.join('\n');
}

/** Images a tool returned. */
export function contentImages(content: AcpToolCall['content']): Array<{ data: string; mediaType: string }> {
  const out: Array<{ data: string; mediaType: string }> = [];
  for (const c of content ?? []) {
    if (c?.type === 'content' && c.content?.type === 'image') out.push({ data: c.content.data, mediaType: c.content.mimeType });
  }
  return out;
}

/** The text of the first text block, e.g. a plan in a switch_mode call. */
export function firstText(content: AcpToolCall['content']): string | undefined {
  for (const c of content ?? []) {
    if (c?.type === 'content' && c.content?.type === 'text' && c.content.text.trim()) return c.content.text;
  }
  return undefined;
}

/**
 * Grove's view of an ACP tool call (see shared/tool-view.ts). Paths are
 * shown relative to `cwd` when they are inside it, as Claude Code shows them.
 */
export function toolViewFor(call: AcpToolCall, cwd: string): ToolView {
  const rel = (p: string) => {
    if (!path.isAbsolute(p)) return p;
    const r = path.relative(cwd, p);
    return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p;
  };
  const paths = pathsOf(call);
  const title = typeof call.title === 'string' && call.title.trim() ? call.title.trim() : undefined;
  const input = rec(call.rawInput);
  const withPaths = (view: ToolView): ToolView => {
    if (paths.length > 0) view.path = rel(paths[0]);
    if (paths.length > 1) view.morePaths = paths.slice(1).map(rel);
    if (title) view.summary = title;
    return view;
  };

  switch (call.kind) {
    case 'edit':
    case 'delete':
    case 'move': {
      const diffs = (call.content ?? []).filter((c): c is Extract<typeof c, { type: 'diff' }> => c?.type === 'diff');
      const first = diffs[0];
      // The file shown: the first diff's, else the first path named. Every
      // other path stays in morePaths, where Edit mode checks it too.
      const primary = first?.path ?? paths[0];
      const view: ToolView = { kind: 'edit' };
      if (primary) view.path = rel(primary);
      const others = paths.filter((p) => p !== primary);
      if (others.length > 0) view.morePaths = others.map(rel);
      if (title) view.summary = title;
      // That file's diffs: a new file is a whole-file write, else replacements.
      if (first) {
        const same = diffs.filter((d) => d.path === first.path);
        if (same.length === 1 && first.oldText == null) {
          view.write = first.newText;
        } else {
          view.edits = same.map((d): ToolTextEdit => ({ oldText: d.oldText ?? '', newText: d.newText }));
        }
      }
      return view;
    }
    case 'read':
      return withPaths({ kind: 'read' });
    case 'search': {
      const pattern = firstString(input, 'pattern', 'query', 'regex', 'glob');
      return withPaths({ kind: 'search', ...(pattern ? { pattern } : {}) });
    }
    case 'execute': {
      const command = commandOf(call.rawInput);
      // Without the command there's nothing to show as one, or to check.
      return command ? { kind: 'shell', command, ...(title ? { summary: title } : {}) } : withPaths({ kind: 'other' });
    }
    case 'fetch': {
      const url = firstString(input, 'url', 'uri');
      if (url) return { kind: 'fetch', url, ...(title ? { summary: title } : {}) };
      const query = firstString(input, 'query');
      return query ? { kind: 'web_search', query, ...(title ? { summary: title } : {}) } : withPaths({ kind: 'other' });
    }
    case 'switch_mode':
      return { kind: 'plan', ...(title ? { summary: title } : {}) };
    default:
      return withPaths({ kind: 'other' });
  }
}

/** The string Grove's allow/deny rules match for a call (see toolCallSpecifier). */
export function specifierFor(view: ToolView): string {
  // Never the agent's title: it is free text, and a rule matched against it
  // would approve a command Grove never saw.
  return view.command ?? view.path ?? view.url ?? view.pattern ?? '';
}

// ─── Plans ───

export function planText(entries: AcpPlanEntry[]): string {
  const mark = (s?: string) => (s === 'completed' ? '[x]' : s === 'in_progress' ? '[~]' : '[ ]');
  return entries.map((e) => `${mark(e.status)} ${e.content}`).join('\n');
}

export function planSummary(entries: AcpPlanEntry[]): string {
  const done = entries.filter((e) => e.status === 'completed').length;
  const current = entries.find((e) => e.status === 'in_progress')?.content;
  return `Plan: ${done}/${entries.length} done${current ? ` · ${current}` : ''}`;
}

// ─── Permissions ───

/** The option to answer with for a Grove decision: an exact kind first, then
 *  the other kind on the same side (allow or reject). Null when the agent
 *  offered nothing on that side. */
export function pickPermissionOption(
  options: readonly AcpPermissionOption[],
  decision: 'allow' | 'allowAlways' | 'deny',
): AcpPermissionOption | null {
  const order: AcpPermissionOptionKind[] = decision === 'allow' ? ['allow_once', 'allow_always']
    : decision === 'allowAlways' ? ['allow_always', 'allow_once']
      : ['reject_once', 'reject_always'];
  for (const kind of order) {
    const found = options.find((o) => o?.kind === kind);
    if (found) return found;
  }
  return null;
}

// ─── Controls ───

/** Agent controls get this prefix so they never collide with Grove's ids. */
export const AGENT_CONTROL_PREFIX = 'acp:';
/** The agent's own modes (the `modes` API, or a config option in the mode category). */
export const AGENT_MODE_CONTROL = `${AGENT_CONTROL_PREFIX}mode`;

function flatOptions(option: AcpConfigOption): AcpConfigSelectOption[] {
  const out: AcpConfigSelectOption[] = [];
  for (const o of option.options ?? []) {
    if (o && 'group' in o && Array.isArray(o.options)) out.push(...o.options);
    else if (o && 'value' in o) out.push(o as AcpConfigSelectOption);
  }
  return out;
}

function controlOption(value: string, label: string, description?: string | null): ControlOption {
  return { value, label, ...(description ? { description } : {}) };
}

/**
 * Controls for what the agent offers: its config options (select type only,
 * not the model, which Grove shows as its model picker), or its modes when it
 * has no mode config option. Ids are prefixed (AGENT_CONTROL_PREFIX).
 */
export function agentControls(configOptions: readonly AcpConfigOption[] | null | undefined, modes: AcpModeState | null | undefined): ControlDescriptor[] {
  const controls: ControlDescriptor[] = [];
  let hasMode = false;
  for (const opt of configOptions ?? []) {
    if (!opt || opt.type !== 'select' || opt.category === 'model') continue;
    const values = flatOptions(opt);
    if (values.length === 0 || typeof opt.currentValue !== 'string') continue;
    const isMode = opt.category === 'mode';
    hasMode ||= isMode;
    controls.push({
      id: isMode ? AGENT_MODE_CONTROL : `${AGENT_CONTROL_PREFIX}${opt.id}`,
      label: opt.name,
      options: values.map((v) => controlOption(v.value, v.name, v.description)),
      default: opt.currentValue,
    });
  }
  if (!hasMode && modes && modes.availableModes?.length) {
    controls.unshift({
      id: AGENT_MODE_CONTROL,
      label: 'Agent mode',
      options: modes.availableModes.map((m) => controlOption(m.id, m.name, m.description)),
      default: modes.currentModeId,
    });
  }
  return controls;
}

/** The config option an agent control id stands for, or null for the modes API. */
export function configIdForControl(controlId: string, configOptions: readonly AcpConfigOption[] | null | undefined): string | null {
  if (controlId === AGENT_MODE_CONTROL) {
    return (configOptions ?? []).find((o) => o?.category === 'mode')?.id ?? null;
  }
  return controlId.startsWith(AGENT_CONTROL_PREFIX) ? controlId.slice(AGENT_CONTROL_PREFIX.length) : null;
}

export interface AcpModelList {
  models: Array<{ id: string; label: string; description?: string }>;
  current: string | null;
  /** How the agent switches models. */
  via: { configId: string } | 'set_model';
}

/** The agent's model list: a config option in the model category, or the
 *  older `models` field (Gemini CLI). */
export function modelList(configOptions: readonly AcpConfigOption[] | null | undefined, models: AcpModelState | null | undefined): AcpModelList | null {
  const opt = (configOptions ?? []).find((o) => o?.category === 'model' && o.type === 'select');
  if (opt) {
    return {
      models: flatOptions(opt).map((v) => ({ id: v.value, label: v.name, ...(v.description ? { description: v.description } : {}) })),
      current: typeof opt.currentValue === 'string' ? opt.currentValue : null,
      via: { configId: opt.id },
    };
  }
  if (models && Array.isArray(models.availableModels) && models.availableModels.length > 0) {
    return {
      models: models.availableModels.map((m) => ({ id: m.modelId, label: m.name, ...(m.description ? { description: m.description } : {}) })),
      current: models.currentModelId ?? null,
      via: 'set_model',
    };
  }
  return null;
}
