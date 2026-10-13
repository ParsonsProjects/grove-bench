/**
 * Measuring for scripts/response-style-eval.mjs: what each run wrote, and
 * the report comparing response styles. Pure, so it is tested on its own.
 */

/**
 * Splits a turn's text the way Summary and Focus fold it (narrationIds in
 * src/renderer/lib/message-view.ts): text before a later tool call is a
 * note written while working, text after the last tool call is the answer.
 * @param {Array<{ type: 'text', text: string } | { type: 'tool_use', name: string }>} blocks
 */
export function splitTurnText(blocks) {
  const lastTool = blocks.findLastIndex((b) => b.type === 'tool_use');
  const notes = [];
  const answer = [];
  blocks.forEach((b, i) => {
    if (b.type !== 'text' || !b.text.trim()) return;
    (i < lastTool ? notes : answer).push(b.text);
  });
  return { notes, answer };
}

export function wordCount(text) {
  const words = text.trim().split(/\s+/);
  return words[0] === '' ? 0 : words.length;
}

/** What one run is measured by, from its text blocks and SDK result. */
export function measureRun(blocks, result) {
  const { notes, answer } = splitTurnText(blocks);
  return {
    outputTokens: result?.usage?.output_tokens ?? null,
    costUsd: result?.total_cost_usd ?? null,
    turns: result?.num_turns ?? null,
    durationMs: result?.duration_ms ?? null,
    toolCalls: blocks.filter((b) => b.type === 'tool_use').length,
    noteCount: notes.length,
    noteWords: notes.reduce((n, t) => n + wordCount(t), 0),
    answerWords: answer.reduce((n, t) => n + wordCount(t), 0),
    answer: answer.join('\n\n'),
  };
}

export function median(values) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function range(values) {
  const v = values.filter((x) => typeof x === 'number');
  return v.length ? [Math.min(...v), Math.max(...v)] : null;
}

const METRICS = ['outputTokens', 'noteWords', 'answerWords', 'toolCalls', 'turns', 'costUsd'];

/** Median and range of each metric, per task and style. */
export function summarize(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = `${run.task}\u0000${run.style}`;
    if (!groups.has(key)) groups.set(key, { task: run.task, style: run.style, runs: [] });
    groups.get(key).runs.push(run);
  }
  return [...groups.values()].map((g) => {
    const stats = {};
    for (const m of METRICS) {
      const values = g.runs.map((r) => r.metrics[m]);
      stats[m] = { median: median(values), range: range(values) };
    }
    const checked = g.runs.filter((r) => r.checkPassed !== null && r.checkPassed !== undefined);
    return {
      task: g.task,
      style: g.style,
      count: g.runs.length,
      stats,
      checks: checked.length ? { passed: checked.filter((r) => r.checkPassed).length, of: checked.length } : null,
      failed: g.runs.filter((r) => r.error || r.resultSubtype !== 'success').length,
    };
  });
}

/** Change from `base` to `other` as a percentage, or null when it can't be said. */
export function percentChange(base, other) {
  if (typeof base !== 'number' || typeof other !== 'number' || base === 0) return null;
  return ((other - base) / base) * 100;
}

const STYLE_LABELS = { off: 'Normal', brief: 'Brief', lite: 'Caveman lite', full: 'Caveman full', ultra: 'Caveman ultra' };
const styleLabel = (s) => STYLE_LABELS[s] ?? s;

function fmt(n, digits = 0) {
  if (n === null || n === undefined) return 'n/a';
  return digits ? n.toFixed(digits) : Math.round(n).toLocaleString('en-GB');
}

function cell(stat, digits = 0) {
  if (stat.median === null) return 'n/a';
  const [lo, hi] = stat.range;
  return lo === hi ? fmt(stat.median, digits) : `${fmt(stat.median, digits)} (${fmt(lo, digits)} to ${fmt(hi, digits)})`;
}

function pct(n) {
  if (n === null) return 'n/a';
  return `${n > 0 ? '+' : ''}${Math.round(n)}%`;
}

/**
 * The Markdown report: a table per task, each style's change from the first
 * style across tasks, and every run's answer to read side by side.
 */
export function renderReport(runs, meta) {
  const summary = summarize(runs);
  const tasks = [...new Set(runs.map((r) => r.task))];
  const styles = meta.styles;
  const [base] = styles;
  const lines = [];

  lines.push('# Response style comparison', '');
  lines.push(`- Date: ${meta.date}`);
  lines.push(`- Commit: \`${meta.commit}\``);
  lines.push(`- Model: ${meta.model ?? 'Claude Code default'}`);
  lines.push(`- Runs per task and style: ${meta.runs}`);
  lines.push(`- User settings loaded: ${meta.userSettings ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('Each cell is the median, with the lowest and highest run in brackets.');
  lines.push('Output tokens include thinking and tool calls, so they move with more than the wording.');
  lines.push('Notes are words written before a later tool call; the answer is the text after the last one.');
  lines.push('');

  for (const task of tasks) {
    lines.push(`## ${task}`, '');
    lines.push('| Style | Runs | Output tokens | Notes (words) | Answer (words) | Tool calls | Cost (USD) | Check |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const style of styles) {
      const g = summary.find((s) => s.task === task && s.style === style);
      if (!g) continue;
      const check = g.checks ? `${g.checks.passed}/${g.checks.of} passed` : 'none';
      const runsCell = g.failed ? `${g.count} (${g.failed} did not finish)` : String(g.count);
      lines.push(`| ${styleLabel(style)} | ${runsCell} | ${cell(g.stats.outputTokens)} | ${cell(g.stats.noteWords)} | ${cell(g.stats.answerWords)} | ${cell(g.stats.toolCalls)} | ${cell(g.stats.costUsd, 2)} | ${check} |`);
    }
    lines.push('');
  }

  if (styles.length > 1) {
    lines.push(`## Change from ${styleLabel(base)}`, '');
    lines.push('The median across tasks of each task\'s change in its median.', '');
    lines.push('| Style | Output tokens | Notes (words) | Answer (words) | Cost |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const style of styles.slice(1)) {
      const change = (metric) => median(tasks.map((task) => {
        const a = summary.find((s) => s.task === task && s.style === base);
        const b = summary.find((s) => s.task === task && s.style === style);
        return a && b ? percentChange(a.stats[metric].median, b.stats[metric].median) : null;
      }));
      lines.push(`| ${styleLabel(style)} | ${pct(change('outputTokens'))} | ${pct(change('noteWords'))} | ${pct(change('answerWords'))} | ${pct(change('costUsd'))} |`);
    }
    lines.push('');
  }

  lines.push('## Answers', '');
  lines.push('Read these for quality: shorter is only better if nothing you needed went missing.', '');
  for (const task of tasks) {
    lines.push(`### ${task}`, '');
    for (const style of styles) {
      for (const run of runs.filter((r) => r.task === task && r.style === style)) {
        const status = run.error ? `error: ${run.error}` : `${run.metrics.answerWords} words`;
        lines.push(`<details><summary>${styleLabel(style)}, run ${run.rep} (${status})</summary>`, '');
        lines.push(run.metrics.answer || '_No answer text._', '');
        lines.push('</details>', '');
      }
    }
  }
  return lines.join('\n');
}
