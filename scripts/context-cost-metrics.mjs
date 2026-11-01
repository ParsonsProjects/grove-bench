/**
 * Measuring for scripts/context-cost.mjs: where a thread's input tokens, and
 * what they cost, go. The parts are the starting context (system prompt,
 * tools, memory files), the agent's own output, your messages, and each
 * tool's results. Read from Claude Code's transcripts, which give exact
 * token counts for every model call, or from Grove's thread logs, which
 * cover every agent. Pure, so it is tested on its own.
 *
 * A thread is one or more chains: a context the model saw, call after call
 * (the thread itself, and each of its subagents). A chain is a list of steps:
 * the items added to the context and then the model call that sent them, or a
 * compaction that replaced the context.
 *
 * @typedef {{ label: string, kind?: string, chars?: number, trimmedChars?: number, tokens?: number, command?: string }} Item
 *   `tokens` when known exactly (the agent's output), `chars` otherwise.
 * @typedef {{ uncached: number, write5m: number, write1h: number, read: number, output: number, model?: string }} SplitCall
 * @typedef {{ total: number, output: number, model?: string }} TotalCall
 *   A call from an agent that reports only how full the context is.
 * @typedef {{ kind: 'call', items: Item[], call: SplitCall | TotalCall } | { kind: 'compact' }} Step
 */

export const STARTING = 'Starting context (system prompt, tools, memory files)';
export const AGENT_OUTPUT = 'Agent output (text, thinking, tool calls)';
export const YOUR_MESSAGES = 'Your messages';
export const OTHER = 'Other (reminders, attachments, images, estimate error)';
export const SUMMARY = 'Compaction summaries';
export const toolLabel = (name) => `Tool: ${name}`;

/** Used when too few calls measure it (measureCharsPerToken). An assumption:
 *  English and code commonly run 3 to 4 characters a token. */
export const DEFAULT_CHARS_PER_TOKEN = 3.5;

/**
 * List prices in USD per million tokens: [model id prefix, input, output,
 * cache read]. Cache writes cost 1.25x input for the 5-minute lifetime and 2x
 * for 1 hour. From Anthropic's pricing page as of 2026-10-06
 * (https://platform.claude.com/docs/en/about-claude/pricing). Longer prefixes
 * come first, so claude-opus-5-5 isn't read as claude-opus-5. Haiku 5.5 costs
 * more for prompts over 100K tokens, which isn't modelled.
 */
export const PRICES = [
  ['claude-mythos-5-1', 10, 50, 0.25],
  ['claude-fable-5-1', 10, 50, 0.25],
  ['claude-sonnet-5-5', 2, 10, 0.2],
  ['claude-haiku-5-5', 0.1, 0.5, 0.01],
  ['claude-opus-5-5', 4, 20, 0.2],
  ['claude-sonnet-4-6', 3, 15, 0.3],
  ['claude-haiku-4-5', 1, 5, 0.1],
  ['claude-fable-5', 10, 50, 1],
  ['claude-sonnet-5', 2, 10, 0.2],
  ['claude-opus-5', 5, 25, 0.5],
  ['claude-opus-4', 5, 25, 0.5],
];

/** Prices for `model`, or null for a model not in PRICES. */
export function priceFor(model) {
  if (typeof model !== 'string') return null;
  const id = model.toLowerCase().replace(/^(anthropic[./]|us\.anthropic\.)/, '');
  const row = PRICES.find(([prefix]) => id.startsWith(prefix));
  return row ? { input: row[1], output: row[2], cacheRead: row[3] } : null;
}

/** What kind of tool `name` is, in the terms of ToolView (src/shared/tool-view.ts),
 *  for Claude Code's tools. Other agents' kinds come from their ToolView. */
export function claudeToolKind(name) {
  if (/^(Bash|PowerShell|BashOutput|Monitor)$/.test(name)) return 'shell';
  if (/^(Read|LS|NotebookRead)$/.test(name)) return 'read';
  if (/^(Grep|Glob)$/.test(name)) return 'search';
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) return 'edit';
  if (name === 'WebFetch') return 'fetch';
  if (name === 'WebSearch') return 'web_search';
  if (name === 'Task' || name === 'Agent') return 'agent';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}

/**
 * The program a shell command runs, and its subcommand when it has one
 * ("git diff", "npm run"), without paths or arguments, so a report can group
 * runs without showing what they ran on. Skips a leading `cd x &&`.
 */
export function commandHead(command) {
  if (typeof command !== 'string') return undefined;
  const parts = command.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);
  // Skips moving folders, and setting variables (`F=/some/file`), whose
  // value would otherwise be read as the program and show a path.
  const main = parts.find((p) => !/^(cd|pushd|set|export|Set-Location)\b/i.test(p) && !/^\$?[A-Za-z_]\w*\s*=\s*\S*$/.test(p));
  if (!main) return undefined;
  const words = main.replace(/^([A-Za-z_]\w*=\S*\s+)+/, '').split(/\s+/);
  const program = (words[0] ?? '').replace(/^["'&]+|["']+$/g, '').split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
  if (!program) return undefined;
  if (/^(for|while|until|if|foreach|do|then)$/.test(program)) return '(shell loop or condition)';
  const sub = words[1];
  return sub && /^[a-z][\w:-]*$/i.test(sub) ? `${program} ${sub.toLowerCase()}` : program;
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-Z\\\\-_]`, 'g');

/**
 * Length of `text` after trims that lose nothing a reader needs: colour
 * codes, text a progress bar overwrote (before a carriage return), trailing
 * spaces, runs of blank lines, and a line repeated 3 or more times in a row
 * (kept once, with a count). A floor for what tidying output could save.
 */
export function safeTrimmedLength(text) {
  const lines = text.replace(ANSI, '').split('\n').map((line) => {
    let l = line.endsWith('\r') ? line.slice(0, -1) : line;
    const cr = l.lastIndexOf('\r');
    if (cr >= 0) l = l.slice(cr + 1);
    return l.trimEnd();
  });
  const out = [];
  for (let i = 0; i < lines.length;) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    const run = j - i;
    if (lines[i] === '') out.push('');
    else if (run >= 3) out.push(lines[i], `[same line ${run - 1} more times]`);
    else for (let k = 0; k < run; k++) out.push(lines[i]);
    i = j;
  }
  return out.join('\n').length;
}

function textItem(label, text) {
  return { label, chars: text.length, trimmedChars: text.length };
}

/** An item for one tool result. `command` is the shell command, if it ran one. */
export function toolItem(name, kind, text, command) {
  return {
    label: toolLabel(name),
    kind,
    chars: text.length,
    trimmedChars: safeTrimmedLength(text),
    ...(command !== undefined ? { command: commandHead(command) } : {}),
  };
}

const commandOf = (input) => (input && typeof input === 'object' && typeof input.command === 'string' ? input.command : undefined);

/** A tool result's text as the model got it: text blocks joined. Images
 *  aren't counted here; their tokens end up in OTHER. */
function claudeResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('');
}

/** Whether a user entry's text is something Claude Code added (a reminder, a
 *  slash command's output) rather than what the user typed. */
const isAddedText = (text, isMeta) => isMeta === true || /^\s*<(system-reminder|command-|local-command)/.test(text);

/** A Claude Code API usage object as a call. */
export function claudeCall(usage, model) {
  const writes = usage.cache_creation_input_tokens ?? 0;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return {
    uncached: usage.input_tokens ?? 0,
    write5m: Math.max(0, writes - write1h),
    write1h,
    read: usage.cache_read_input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    ...(model ? { model } : {}),
  };
}

/**
 * The chains in one Claude Code transcript (its parsed lines): the thread,
 * and subagents written into it by older versions. Newer versions write each
 * subagent to its own file, which is then a transcript of one chain.
 * @returns {{ chains: Step[][], title?: string }}
 */
export function readClaudeTranscript(entries) {
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  let title;
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'ai-title' && typeof e.aiTitle === 'string') title = e.aiTitle;
    else if (e.type === 'summary' && typeof e.summary === 'string') title ??= e.summary;
    const key = e.isSidechain ? `side:${e.agentId ?? ''}` : 'main';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const chains = [...groups.values()].map((group) => {
    /** @type {Step[]} */
    const steps = [];
    const tools = new Map();
    let items = [];
    let request;
    for (const e of group) {
      if (e.type === 'assistant') {
        const m = e.message;
        if (!m || m.model === '<synthetic>') continue;
        const key = e.requestId ?? m.id;
        if (key !== request) {
          request = key;
          if (m.usage) {
            steps.push({ kind: 'call', items, call: claudeCall(m.usage, m.model) });
            items = [];
          }
        }
        for (const b of Array.isArray(m.content) ? m.content : []) {
          if (b?.type === 'tool_use') tools.set(b.id, { name: b.name, input: b.input });
        }
      } else if (e.type === 'system' && e.subtype === 'compact_boundary') {
        steps.push({ kind: 'compact' });
        items = [];
      } else if (e.type === 'user') {
        const content = e.message?.content;
        if (e.isCompactSummary) {
          if (steps.at(-1)?.kind !== 'compact') steps.push({ kind: 'compact' });
          items = [textItem(SUMMARY, typeof content === 'string' ? content : claudeResultText(content))];
          continue;
        }
        if (typeof content === 'string') {
          items.push(textItem(isAddedText(content, e.isMeta) ? OTHER : YOUR_MESSAGES, content));
          continue;
        }
        for (const b of Array.isArray(content) ? content : []) {
          if (b?.type === 'tool_result') {
            const tool = tools.get(b.tool_use_id);
            const name = tool?.name ?? 'unknown';
            const kind = claudeToolKind(name);
            items.push(toolItem(name, kind, claudeResultText(b.content), kind === 'shell' ? commandOf(tool?.input) : undefined));
          } else if (b?.type === 'text' && typeof b.text === 'string') {
            items.push(textItem(isAddedText(b.text, e.isMeta) ? OTHER : YOUR_MESSAGES, b.text));
          }
        }
      }
    }
    return steps;
  });
  return { chains: chains.filter((steps) => steps.some((s) => s.kind === 'call')), title };
}

/**
 * The chain in one Grove thread log (its parsed lines), for any agent. Model
 * calls come from its usage events. Claude Code reports each call with the
 * cache split, once per content block, so repeats are one call; Grove's log
 * doesn't say how long the cache was kept, so writes count as 5-minute ones.
 * ACP agents report only how full the context is, when they choose to.
 * Subagents' results aren't in the thread's context, so they are skipped.
 * The model is the one the agent last said it started with, or `model`.
 * @returns {Step[]}
 */
export function readGroveLog(events, { model } = {}) {
  /** @type {Step[]} */
  const steps = [];
  const tools = new Map();
  let items = [];
  let last = null;
  let current = model;
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    switch (e.type) {
      case 'system_init':
        if (typeof e.model === 'string' && e.model) current = e.model;
        break;
      case 'assistant_tool_use':
      case 'tool_update': {
        if (e.parentToolUseId) break;
        const prev = tools.get(e.toolUseId) ?? {};
        tools.set(e.toolUseId, { name: e.toolName ?? prev.name, input: e.toolInput ?? prev.input, view: e.toolView ?? prev.view });
        break;
      }
      case 'tool_result': {
        if (e.parentToolUseId) break;
        const tool = tools.get(e.toolUseId);
        const name = tool?.name ?? 'unknown';
        const kind = tool?.view?.kind ?? claudeToolKind(name);
        const command = kind === 'shell' ? (tool?.view?.command ?? commandOf(tool?.input)) : undefined;
        items.push(toolItem(name, kind, typeof e.content === 'string' ? e.content : '', command));
        break;
      }
      case 'user_message':
        items.push(textItem(YOUR_MESSAGES, typeof e.text === 'string' ? e.text : ''));
        break;
      case 'compact_boundary':
        steps.push({ kind: 'compact' });
        items = [];
        last = null;
        break;
      case 'usage': {
        const split = e.cacheReadTokens !== undefined || e.cacheCreationTokens !== undefined;
        const sig = `${e.inputTokens}/${e.cacheReadTokens}/${e.cacheCreationTokens}`;
        if (last?.sig === sig) {
          last.call.output = Math.max(last.call.output, e.outputTokens ?? 0);
          break;
        }
        const output = e.outputTokens ?? 0;
        const call = split
          ? { uncached: e.inputTokens ?? 0, write5m: e.cacheCreationTokens ?? 0, write1h: 0, read: e.cacheReadTokens ?? 0, output }
          : { total: e.inputTokens ?? 0, output };
        if (current) call.model = current;
        steps.push({ kind: 'call', items, call });
        items = [];
        last = { sig, call };
        break;
      }
    }
  }
  return steps;
}

const contextOf = (call) => ('total' in call ? call.total : call.uncached + call.write5m + call.write1h + call.read);

export function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(values, p) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/**
 * Characters per token in tool results, measured on the calls themselves:
 * where only tool results and the agent's output were added since the call
 * before, the context grew by those two, so the results' tokens are the
 * growth less the output. The median over calls with at least 2,000
 * characters of results; null with fewer than 10 such calls.
 * Reminders that Claude Code adds between calls aren't in the transcript as
 * text, so they count as result tokens here, which makes results look a
 * little bigger than they are.
 */
export function measureCharsPerToken(chains) {
  const samples = [];
  for (const steps of chains) {
    let prev = null;
    for (const step of steps) {
      if (step.kind === 'compact' || 'total' in step.call) {
        prev = null;
        continue;
      }
      const size = contextOf(step.call);
      if (prev && step.items.length > 0 && step.items.every((i) => i.label.startsWith('Tool: '))) {
        const chars = step.items.reduce((n, i) => n + (i.chars ?? 0), 0);
        const grown = size - prev.size - prev.output;
        if (chars >= 2000 && grown > 0) samples.push(chars / grown);
      }
      prev = { size, output: step.call.output };
    }
  }
  return { value: samples.length >= 10 ? median(samples) : null, samples: samples.length };
}

function newPart(label, kind) {
  return { label, kind, items: 0, chars: 0, trimmedChars: 0, added: 0, tokenCalls: 0, cost: 0, sizes: [], commands: new Map() };
}

function newCommand(head) {
  return { head, runs: 0, chars: 0, sizes: [], tokenCalls: 0, cost: 0 };
}

/**
 * Where one chain's input went. Each call bills its context in order: the
 * first `read` tokens at the cache read price, the rest at that call's mix of
 * uncached and cache write prices. Each part of the context (in the order it
 * was added) takes the share of the bill its tokens cover, so a part added
 * late pays the write price once and the read price on every call after.
 * Where the context is smaller than the parts add up to (the agent dropped
 * something, or the estimate from characters is high) every part is scaled
 * down to fit; where it is bigger, the difference is OTHER.
 * The parts' costs add up to the chain's input cost.
 * @param {Step[]} steps
 */
export function analyseChain(steps, { charsPerToken = DEFAULT_CHARS_PER_TOKEN } = {}) {
  /** @type {Map<string, ReturnType<typeof newPart>>} */
  const parts = new Map();
  const part = (label, kind) => {
    let p = parts.get(label);
    if (!p) parts.set(label, (p = newPart(label, kind)));
    return p;
  };
  const totals = { calls: 0, contextOnlyCalls: 0, unpricedCalls: 0, uncached: 0, write5m: 0, write1h: 0, read: 0, output: 0, inputCost: 0, outputCost: 0, models: new Map() };
  /** The context, in the order it was sent: { label, tokens, command? } */
  let segments = [];
  let context = 0;
  let pendingOutput = 0;
  for (const step of steps) {
    if (step.kind === 'compact') {
      segments = [];
      context = 0;
      pendingOutput = 0;
      continue;
    }
    const { call } = step;
    const size = contextOf(call);
    if (size <= 0) continue;
    const first = segments.length === 0;
    const added = [];
    if (pendingOutput > 0 && !first) added.push({ label: AGENT_OUTPUT, tokens: pendingOutput });
    for (const item of step.items) added.push({ label: item.label, tokens: item.tokens ?? (item.chars ?? 0) / charsPerToken, item });
    const addedTokens = added.reduce((n, a) => n + a.tokens, 0);
    const rest = size - context - addedTokens;
    const scale = rest < 0 ? size / (context + addedTokens) : 1;
    if (scale !== 1) for (const s of segments) s.tokens *= scale;
    for (const a of added) {
      const p = part(a.label, a.item?.kind);
      const tokens = a.tokens * scale;
      p.added += tokens;
      let cmd;
      if (a.item) {
        p.items += 1;
        p.chars += a.item.chars ?? 0;
        p.trimmedChars += a.item.trimmedChars ?? a.item.chars ?? 0;
        if (a.item.kind) p.sizes.push(a.item.chars ?? 0);
        if (a.item.command) {
          cmd = p.commands.get(a.item.command);
          if (!cmd) p.commands.set(a.item.command, (cmd = newCommand(a.item.command)));
          cmd.runs += 1;
          cmd.chars += a.item.chars ?? 0;
          cmd.sizes.push(a.item.chars ?? 0);
        }
      } else {
        p.items += 1;
      }
      segments.push({ label: a.label, tokens, cmd });
    }
    if (rest > 0) {
      const label = first ? STARTING : OTHER;
      part(label).added += rest;
      segments.push({ label, tokens: rest });
    }
    context = size;
    pendingOutput = call.output;

    totals.calls += 1;
    totals.output += call.output;
    if (call.model) totals.models.set(call.model, (totals.models.get(call.model) ?? 0) + 1);
    const price = priceFor(call.model);
    if ('total' in call) totals.contextOnlyCalls += 1;
    else {
      totals.uncached += call.uncached;
      totals.write5m += call.write5m;
      totals.write1h += call.write1h;
      totals.read += call.read;
    }
    if (!price) totals.unpricedCalls += 1;
    const priced = price && !('total' in call);
    let readRate = 0;
    let writeRate = 0;
    let readEnd = 0;
    if (priced) {
      const fresh = call.uncached + call.write5m + call.write1h;
      readRate = price.cacheRead / 1e6;
      writeRate = fresh > 0 ? (call.uncached * price.input + call.write5m * price.input * 1.25 + call.write1h * price.input * 2) / fresh / 1e6 : 0;
      readEnd = call.read;
      totals.inputCost += call.read * readRate + fresh * writeRate;
      totals.outputCost += (call.output * price.output) / 1e6;
    }
    let offset = 0;
    for (const s of segments) {
      const start = offset;
      offset += s.tokens;
      const p = parts.get(s.label);
      p.tokenCalls += s.tokens;
      if (s.cmd) s.cmd.tokenCalls += s.tokens;
      if (!priced) continue;
      const fromCache = Math.max(0, Math.min(offset, readEnd) - start);
      const cost = fromCache * readRate + (s.tokens - fromCache) * writeRate;
      p.cost += cost;
      if (s.cmd) s.cmd.cost += cost;
    }
  }
  return { parts, totals };
}

/** Adds `from` (an analyseChain result) into `into`. */
export function mergeAnalysis(into, from) {
  for (const [label, p] of from.parts) {
    let q = into.parts.get(label);
    if (!q) into.parts.set(label, (q = newPart(label, p.kind)));
    q.kind ??= p.kind;
    for (const k of ['items', 'chars', 'trimmedChars', 'added', 'tokenCalls', 'cost']) q[k] += p[k];
    q.sizes.push(...p.sizes);
    for (const [head, c] of p.commands) {
      let d = q.commands.get(head);
      if (!d) q.commands.set(head, (d = newCommand(head)));
      for (const k of ['runs', 'chars', 'tokenCalls', 'cost']) d[k] += c[k];
      d.sizes.push(...c.sizes);
    }
  }
  for (const k of ['calls', 'contextOnlyCalls', 'unpricedCalls', 'uncached', 'write5m', 'write1h', 'read', 'output', 'inputCost', 'outputCost']) into.totals[k] += from.totals[k];
  for (const [m, n] of from.totals.models) into.totals.models.set(m, (into.totals.models.get(m) ?? 0) + n);
  return into;
}

export function emptyAnalysis() {
  return analyseChain([]);
}

// ─── Report ───

const int = (n) => Math.round(n).toLocaleString('en-GB');
const usd = (n) => (n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');
const tokensK = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : int(n));
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ');
/** A Markdown table. `align` has one letter a column: l (left) or r (right). */
const table = (head, rows, align = 'l' + 'r'.repeat(head.length - 1)) => [
  `| ${head.join(' | ')} |`,
  `|${head.map((h, i) => (align[i] === 'l' ? ' :-- ' : ' --: ')).join('|')}|`,
  ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
].join('\n');
const plural = (n, word) => `${int(n)} ${word}${n === 1 ? '' : 's'}`;

/**
 * The Markdown report.
 * @param {{ all: ReturnType<typeof emptyAnalysis>, threads: Array<{ title: string, agent: string, source: string, analysis: ReturnType<typeof emptyAnalysis> }>, charsPerToken: { value: number | null, samples: number, used: number }, generated: string, sources: string[] }} r
 */
export function renderReport({ all, threads, charsPerToken, generated, sources }) {
  const t = all.totals;
  const priced = t.calls - t.unpricedCalls - t.contextOnlyCalls;
  const inputTokens = t.uncached + t.write5m + t.write1h + t.read;
  const parts = [...all.parts.values()].filter((p) => p.tokenCalls > 0 || p.items > 0);
  const byCost = (a, b) => b.cost - a.cost || b.tokenCalls - a.tokenCalls;
  const tools = parts.filter((p) => p.label.startsWith('Tool: ')).sort(byCost);
  const toolCost = tools.reduce((n, p) => n + p.cost, 0);
  const toolTokenCalls = tools.reduce((n, p) => n + p.tokenCalls, 0);
  const allTokenCalls = parts.reduce((n, p) => n + p.tokenCalls, 0);
  const out = [];
  out.push('# Context cost report', '');
  out.push(`Generated ${generated}. ${plural(threads.length, 'thread')}, ${plural(t.calls, 'model call')}. Read from: ${sources.join('; ')}.`, '');
  out.push('Costs are list prices. On a Claude plan you pay in usage limits instead, but the shares are the same.', '');

  out.push('## Totals', '');
  out.push(table(['', 'Tokens', 'Cost'], [
    ['Input, uncached', int(t.uncached), ''],
    ['Input, cache write (5 min)', int(t.write5m), ''],
    ['Input, cache write (1 hour)', int(t.write1h), ''],
    ['Input, cache read', int(t.read), ''],
    ['**Input**', `**${int(inputTokens)}**`, `**${usd(t.inputCost)}**`],
    ['**Output** (text, thinking, tool calls)', `**${int(t.output)}**`, `**${usd(t.outputCost)}**`],
    ['**Total**', '', `**${usd(t.inputCost + t.outputCost)}**`],
  ]), '');
  if (t.contextOnlyCalls > 0) out.push(`${int(t.contextOnlyCalls)} calls came from agents that report only how full the context is (no cache split), so they have no cost here; their parts still count in "Share of context" below.`, '');
  if (t.unpricedCalls - t.contextOnlyCalls > 0) out.push(`${int(t.unpricedCalls - t.contextOnlyCalls)} calls used models with no price in the script (${[...t.models.keys()].filter((m) => !priceFor(m)).join(', ')}), so they have no cost here.`, '');
  if (priced === 0) out.push('No call had a known price, so the cost columns below are empty; use "Share of context".', '');

  out.push('## Where the input goes', '');
  out.push('"Added" is the part\'s size when it entered the context. "Re-sent" is that size times the calls it stayed for: what the model read, call after call. Cost is that part\'s share of the input bill.', '');
  out.push(table(['Part of the context', 'Items', 'Added', 'Re-sent', 'Share of context', 'Input cost', 'Share of input cost'],
    parts.sort(byCost).map((p) => [p.label, p.items ? int(p.items) : '', tokensK(p.added), tokensK(p.tokenCalls), pct(p.tokenCalls, allTokenCalls), usd(p.cost), pct(p.cost, t.inputCost)])), '');
  out.push(`Tool results in total: ${pct(toolTokenCalls, allTokenCalls)} of the context the model read, ${usd(toolCost)} (${pct(toolCost, t.inputCost)} of input cost, ${pct(toolCost, t.inputCost + t.outputCost)} of all cost).`, '');

  out.push('## Tool results', '');
  out.push('Sizes are characters of one result. "Tidy saves" is how much smaller the results get with trims that lose nothing (colour codes, overwritten progress lines, trailing spaces, blank and repeated lines).', '');
  out.push('"Over 10K" is the share of the tool\'s characters that came in results longer than 10,000 characters, where shortening would act.', '');
  out.push(table(['Tool', 'Kind', 'Results', 'Median', '90th pct', 'Largest', 'Over 10K', 'Input cost', 'Share of input cost', 'Tidy saves'],
    tools.map((p) => [p.label.slice(6), p.kind ?? '', int(p.items), int(median(p.sizes)), int(percentile(p.sizes, 90)), int(Math.max(0, ...p.sizes)),
      pct(p.sizes.filter((s) => s > 10_000).reduce((n, s) => n + s, 0), p.chars), usd(p.cost), pct(p.cost, t.inputCost), pct(p.chars - p.trimmedChars, p.chars)]), 'llrrrrrrrr'), '');

  const byKind = new Map();
  for (const p of tools) {
    const k = byKind.get(p.kind ?? 'other') ?? { kind: p.kind ?? 'other', items: 0, cost: 0, tokenCalls: 0 };
    k.items += p.items;
    k.cost += p.cost;
    k.tokenCalls += p.tokenCalls;
    byKind.set(k.kind, k);
  }
  out.push('### By kind of tool', '');
  out.push('The same tools grouped the way Grove names them for every agent (shell, read, search, edit, ...).', '');
  out.push(table(['Kind', 'Results', 'Share of context', 'Input cost', 'Share of input cost'],
    [...byKind.values()].sort((a, b) => b.cost - a.cost || b.tokenCalls - a.tokenCalls).map((k) => [k.kind, int(k.items), pct(k.tokenCalls, allTokenCalls), usd(k.cost), pct(k.cost, t.inputCost)])), '');

  const commands = tools.flatMap((p) => [...p.commands.values()]).sort((a, b) => b.cost - a.cost || b.tokenCalls - a.tokenCalls);
  if (commands.length > 0) {
    out.push('## Shell commands', '');
    out.push('Grouped by program and subcommand only, so no paths or arguments appear. Top 20 by cost.', '');
    out.push(table(['Command', 'Runs', 'Median chars', 'Largest', 'Share of context', 'Input cost', 'Share of input cost'],
      commands.slice(0, 20).map((c) => [c.head, int(c.runs), int(median(c.sizes)), int(Math.max(0, ...c.sizes)), pct(c.tokenCalls, allTokenCalls), usd(c.cost), pct(c.cost, t.inputCost)])), '');
  }

  out.push('## Threads', '');
  out.push('Top 15 by cost.', '');
  const rows = threads.map((th) => {
    const a = th.analysis;
    const tc = [...a.parts.values()].filter((p) => p.label.startsWith('Tool: '));
    const tcCost = tc.reduce((n, p) => n + p.cost, 0);
    const tcShare = tc.reduce((n, p) => n + p.tokenCalls, 0);
    const allShare = [...a.parts.values()].reduce((n, p) => n + p.tokenCalls, 0);
    return { th, cost: a.totals.inputCost + a.totals.outputCost, row: [th.title.slice(0, 60), th.agent, [...a.totals.models.keys()].join(', '), int(a.totals.calls), usd(a.totals.inputCost + a.totals.outputCost), pct(tcCost, a.totals.inputCost), pct(tcShare, allShare), th.source] };
  }).sort((a, b) => b.cost - a.cost || b.th.analysis.totals.calls - a.th.analysis.totals.calls);
  out.push(table(['Thread', 'Agent', 'Models', 'Calls', 'Cost', 'Tools\' share of input cost', 'Tools\' share of context', 'Read from'], rows.slice(0, 15).map((r) => r.row), 'lllrrrrl'), '');

  out.push('## How this was measured', '');
  out.push(`- Token counts per call are the agent's own (Claude Code reports them for every call). Sizes of single parts are estimated from characters at ${charsPerToken.used.toFixed(2)} characters a token: ${charsPerToken.value ? `measured on ${charsPerToken.samples} calls (median)` : `assumed, as only ${charsPerToken.samples} calls could measure it`}.`);
  out.push('- Each call\'s input bill is split over the parts of its context in order: the cached front at the cache read price, the rest at the uncached and cache write prices. Where parts add up to more than the context, all are scaled to fit; where less, the difference is "Other".');
  out.push('- "Starting context" is what the first call (and the first after a compaction) sent that isn\'t your message: the system prompt, tool definitions and memory files such as CLAUDE.md.');
  out.push('- Subagents count as their own contexts; their result in the main thread counts under the tool that started them.');
  out.push('- Grove\'s log doesn\'t say how long Claude Code kept its cache, so threads read from it count every cache write as a 5-minute one. Threads read from Claude Code\'s transcript have the exact split.');
  out.push('');
  return out.join('\n');
}
