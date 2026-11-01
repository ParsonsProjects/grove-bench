#!/usr/bin/env node
/**
 * Measures where your threads' input tokens go, and what they cost: the
 * starting context, the agent's own output, your messages, and each tool's
 * results (by tool, and by shell command). Writes a Markdown report.
 *
 * It reads Grove's data folder (the thread list and each thread's log) and
 * Claude Code's transcripts, which have exact token counts for every model
 * call. A Claude Code thread is read from its transcript when that is found,
 * and from Grove's log otherwise; other agents (OpenCode, Gemini CLI, ...)
 * from Grove's log. Nothing is sent anywhere. The report has no file
 * contents, paths or command arguments: only tool names, command names,
 * thread titles and sizes.
 *
 *   node scripts/context-cost.mjs [--days 30] [--out context-report.md]
 *     [--grove <folder>] [--claude <folder>]... [--all]
 *
 *   --grove   Grove's data folder (default %APPDATA%\grove-bench)
 *   --claude  a Claude Code config folder (default CLAUDE_CONFIG_DIR, or
 *             ~/.claude); repeat it for more. The folders of other Claude
 *             accounts set up in Grove are added without it.
 *   --all     also read Claude Code transcripts that aren't Grove threads
 *   --days    only threads active in the last N days
 *   --out     where to write the report (default context-report.md)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  readClaudeTranscript, readGroveLog, measureCharsPerToken, analyseChain, mergeAnalysis, emptyAnalysis,
  renderReport, DEFAULT_CHARS_PER_TOKEN,
} from './context-cost-metrics.mjs';

const { values } = parseArgs({
  options: {
    grove: { type: 'string' },
    claude: { type: 'string', multiple: true },
    all: { type: 'boolean', default: false },
    days: { type: 'string' },
    out: { type: 'string', default: 'context-report.md' },
  },
});

const days = values.days !== undefined ? Number(values.days) : null;
if (days !== null && !(days > 0)) {
  console.error('--days takes a number of days, such as --days 30');
  process.exit(1);
}
const since = days !== null ? Date.now() - days * 86_400_000 : 0;

/** Parsed lines of a JSONL file. A line cut off mid-write is skipped. */
function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Not a whole line.
    }
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const mtime = (file) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

const appData = process.env.APPDATA ?? path.join(os.homedir(), process.platform === 'win32' ? 'AppData/Roaming' : '.config');
const groveDir = path.resolve(values.grove ?? path.join(appData, 'grove-bench'));
const manifest = readJson(path.join(groveDir, 'worktrees', 'manifest.json')) ?? {};
const settings = readJson(path.join(groveDir, 'settings.json')) ?? {};

const claudeDirs = new Set((values.claude ?? [process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')]).map((d) => path.resolve(d)));
for (const account of Array.isArray(settings.claudeAccounts) ? settings.claudeAccounts : []) {
  if (typeof account?.configDir === 'string' && account.configDir) claudeDirs.add(path.resolve(account.configDir));
}

/** Claude Code transcripts by session id: the file, and its subagents' files. */
const transcripts = new Map();
for (const dir of claudeDirs) {
  const projects = path.join(dir, 'projects');
  let folders;
  try {
    folders = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    continue;
  }
  for (const folder of folders) {
    const folderPath = path.join(projects, folder.name);
    for (const name of fs.readdirSync(folderPath)) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -'.jsonl'.length);
      const subDir = path.join(folderPath, id, 'subagents');
      let subagents;
      try {
        subagents = fs.readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(subDir, f));
      } catch {
        subagents = [];
      }
      transcripts.set(id, { file: path.join(folderPath, name), subagents });
    }
  }
}

function fromTranscript(t) {
  const main = readClaudeTranscript(readJsonl(t.file));
  const chains = [...main.chains];
  for (const file of t.subagents) chains.push(...readClaudeTranscript(readJsonl(file)).chains);
  return { chains, title: main.title };
}

/** Each thread: { title, agent, source, chains } */
const threads = [];
const used = new Set();
const sources = new Set();
for (const [id, entry] of Object.entries(manifest)) {
  if (!entry || typeof entry !== 'object') continue;
  const agent = typeof entry.adapterType === 'string' ? entry.adapterType : 'claude-code';
  const isClaude = agent === 'claude-code' || agent.startsWith('claude-account-');
  const sessionId = entry.providerSessionId ?? entry.claudeSessionId;
  const logFile = path.join(groveDir, 'worktrees', 'events', `${id}.jsonl`);
  const active = Math.max(entry.lastActiveAt ?? 0, entry.createdAt ?? 0, mtime(logFile));
  if (active < since) continue;
  const transcript = isClaude && sessionId ? transcripts.get(sessionId) : undefined;
  if (transcript) {
    used.add(sessionId);
    const { chains, title } = fromTranscript(transcript);
    threads.push({ title: entry.displayName || title || id, agent, source: 'Claude Code transcript', chains });
    sources.add('Claude Code transcripts');
  } else if (fs.existsSync(logFile)) {
    threads.push({ title: entry.displayName || id, agent, source: 'Grove log', chains: [readGroveLog(readJsonl(logFile), { model: entry.model })] });
    sources.add('Grove thread logs');
  }
}
if (values.all) {
  for (const [id, t] of transcripts) {
    if (used.has(id) || mtime(t.file) < since) continue;
    const { chains, title } = fromTranscript(t);
    threads.push({ title: title || id, agent: 'claude-code (not in Grove)', source: 'Claude Code transcript', chains });
    sources.add('Claude Code transcripts');
  }
}

const withCalls = threads.filter((t) => t.chains.some((steps) => steps.some((s) => s.kind === 'call')));
if (withCalls.length === 0) {
  console.error(`No threads with model calls found. Looked in ${groveDir} and ${[...claudeDirs].join(', ')}${values.all ? '' : ' (add --all for Claude Code transcripts outside Grove)'}.`);
  process.exit(1);
}

const measured = measureCharsPerToken(withCalls.flatMap((t) => t.chains));
const charsPerToken = { ...measured, used: measured.value ?? DEFAULT_CHARS_PER_TOKEN };
const all = emptyAnalysis();
const analysed = withCalls.map((t) => {
  const analysis = emptyAnalysis();
  for (const steps of t.chains) mergeAnalysis(analysis, analyseChain(steps, { charsPerToken: charsPerToken.used }));
  mergeAnalysis(all, analysis);
  return { ...t, analysis };
});

const report = renderReport({ all, threads: analysed, charsPerToken, generated: new Date().toISOString().slice(0, 10), sources: [...sources] });
fs.writeFileSync(values.out, report);
const tools = [...all.parts.values()].filter((p) => p.label.startsWith('Tool: ')).reduce((n, p) => n + p.cost, 0);
const { inputCost, outputCost } = all.totals;
console.log(`Wrote ${path.resolve(values.out)}: ${withCalls.length} thread${withCalls.length === 1 ? '' : 's'}, ${all.totals.calls} calls, input $${inputCost.toFixed(2)}, output $${outputCost.toFixed(2)}, tool results ${inputCost > 0 ? ((tools / inputCost) * 100).toFixed(1) : '0'}% of input cost.`);
