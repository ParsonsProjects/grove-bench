/**
 * Compares response styles (Settings > Agents > Response style) on the same
 * tasks: runs each task several times per style through the agent SDK, the
 * way Grove starts Claude Code, and writes a Markdown report of output
 * tokens, words written while working, answer length and cost, with every
 * answer to read side by side.
 *
 * Usage:
 *   node scripts/response-style-eval.mjs --dry-run          (the plan, no API calls)
 *   node scripts/response-style-eval.mjs                    (Normal vs Brief, 3 runs each)
 *   node scripts/response-style-eval.mjs --styles off,brief,lite --runs 5 --model claude-sonnet-5-5
 *   node scripts/response-style-eval.mjs --report out/response-style-eval/<stamp>/runs.jsonl
 *
 * Options:
 *   --styles       Styles to compare, first is the baseline (default off,brief)
 *   --runs         Runs per task and style (default 3)
 *   --tasks        JSON file of tasks: [{ id, prompt, check? }] (default: the built-in ones)
 *   --only         Run just these task ids, comma-separated
 *   --model        Model id (default: Claude Code's default for your account)
 *   --ref          Commit each run starts from (default HEAD)
 *   --max-budget   USD cap per run (default 2)
 *   --user-settings  Also load your user settings and CLAUDE.md, and the project's
 *                  settings.local.json, as Grove does. Off by default: your own style
 *                  instructions would blur the comparison, and the local file's allow
 *                  rules would get past the limits below
 *   --report       Rebuild the report from an earlier runs.jsonl, without running anything
 *
 * Each run gets its own detached git worktree of --ref in the temp folder,
 * with node_modules linked in so the agent can run tests, and is removed
 * afterwards. The agent can read, search and edit inside that worktree and
 * run a few read-only git commands and `npx vitest run`; anything else is
 * denied. Runs use your Claude Code sign-in and count against its limits.
 *
 * Grove also appends path rules and project memory to the system prompt.
 * Both styles would get the same text, so this leaves them out and appends
 * only the style's prompt.
 *
 * Needs Node 22.18 or later, which runs src/main/caveman.ts as is.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { measureRun, renderReport } from './response-style-metrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Two questions and two small edits, on this repo. */
const DEFAULT_TASKS = [
  {
    id: 'explain-thread-views',
    prompt: 'How does the Thread tab decide which messages to show in Summary view and in Focus view? Point me to the relevant code.',
  },
  {
    id: 'trace-invalid-settings',
    prompt: 'When Grove loads settings from disk and one value is invalid, what happens to it and to the other values? Walk me through it with file references.',
  },
  {
    id: 'test-unknown-style',
    prompt: 'Add a test to src/main/caveman.test.ts that getCavemanPrompt returns null for a mode it does not know (cast it, since the type will not allow one). Run that test file to confirm it passes.',
    check: 'npx vitest run src/main/caveman.test.ts',
  },
  {
    id: 'skip-blank-notes',
    prompt: 'narrationIds in src/renderer/lib/message-view.ts counts every text block before a tool call as a note. Make it skip text blocks that are only whitespace, and add a test for that in src/renderer/lib/message-view.test.ts. Run that test file to confirm it passes.',
    check: 'npx vitest run src/renderer/lib/message-view.test.ts',
  },
];

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const BASH_ALLOWED = [/^git (diff|status|log|show)\b/, /^ls\b/, /^npx vitest run\b/];

const { values: args } = parseArgs({
  options: {
    styles: { type: 'string', default: 'off,brief' },
    runs: { type: 'string', default: '3' },
    tasks: { type: 'string' },
    only: { type: 'string' },
    model: { type: 'string' },
    ref: { type: 'string', default: 'HEAD' },
    'max-budget': { type: 'string', default: '2' },
    'user-settings': { type: 'boolean', default: false },
    report: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function isInside(dir, target) {
  const rel = path.relative(dir, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * What the agent may do: read and edit inside its worktree, and run the
 * commands in BASH_ALLOWED, one at a time.
 */
function permissionFor(cwd) {
  return async (toolName, input) => {
    const deny = (message) => ({ behavior: 'deny', message });
    if (READ_TOOLS.has(toolName) || EDIT_TOOLS.has(toolName)) {
      const p = input.file_path ?? input.notebook_path ?? input.path;
      if (typeof p === 'string' && !isInside(cwd, path.resolve(cwd, p))) return deny('Only files inside the project can be used here.');
      return { behavior: 'allow', updatedInput: input };
    }
    if (toolName === 'Bash') {
      const command = String(input.command ?? '').replace(/\s*2>&1\s*$/, '').trim();
      if (/[;&|`$<>\n]/.test(command)) return deny('Run one command at a time, without pipes or redirects.');
      if (BASH_ALLOWED.some((re) => re.test(command))) return { behavior: 'allow', updatedInput: input };
      return deny('Only git diff/status/log/show, ls and npx vitest run are allowed here.');
    }
    return deny(`${toolName} is not available in this run.`);
  };
}

/** A detached worktree of `ref` with node_modules linked in. */
function makeWorktree(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-style-eval-'));
  git('worktree', 'add', '--detach', '--quiet', dir, ref);
  const modules = path.join(ROOT, 'node_modules');
  if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(dir, 'node_modules'), 'junction');
  return dir;
}

function removeWorktree(dir) {
  // Unlink node_modules first: removing the worktree must never reach into
  // the real one through the link. If that fails, leave the worktree.
  const link = path.join(dir, 'node_modules');
  try {
    if (fs.lstatSync(link, { throwIfNoEntry: false })) fs.unlinkSync(link);
  } catch (err) {
    console.warn(`  Left ${dir} in place: could not unlink its node_modules (${err.message})`);
    return;
  }
  try {
    git('worktree', 'remove', '--force', dir);
  } catch (err) {
    console.warn(`  Could not remove worktree ${dir}: ${err.message}`);
  }
}

async function runOne({ task, style, rep, stylePrompt, query }) {
  const cwd = makeWorktree(args.ref);
  const blocks = [];
  let result = null;
  let error = null;
  try {
    const q = query({
      prompt: task.prompt,
      options: {
        cwd,
        systemPrompt: stylePrompt
          ? { type: 'preset', preset: 'claude_code', append: stylePrompt }
          : { type: 'preset', preset: 'claude_code' },
        settingSources: args['user-settings'] ? ['user', 'project', 'local'] : ['project'],
        permissionMode: 'default',
        canUseTool: permissionFor(cwd),
        // Nobody is there to answer, and subagents would split the count.
        disallowedTools: ['AskUserQuestion', 'Agent', 'Task', 'WebFetch', 'WebSearch'],
        maxTurns: 40,
        maxBudgetUsd: Number(args['max-budget']),
        ...(args.model ? { model: args.model } : {}),
      },
    });
    for await (const msg of q) {
      if (msg.type === 'assistant' && msg.parent_tool_use_id === null) {
        for (const block of msg.message.content) {
          if (block.type === 'text') blocks.push({ type: 'text', text: block.text });
          else if (block.type === 'tool_use') blocks.push({ type: 'tool_use', name: block.name });
        }
      } else if (msg.type === 'result') {
        result = msg;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  let checkPassed = null;
  if (task.check && !error) {
    const check = spawnSync(task.check, { cwd, shell: true, encoding: 'utf8', timeout: 5 * 60_000 });
    checkPassed = check.status === 0;
  }
  let diffStat = '';
  try { diffStat = execFileSync('git', ['diff', '--stat'], { cwd, encoding: 'utf8' }).trim(); } catch { /* none */ }
  removeWorktree(cwd);

  return {
    task: task.id,
    style,
    rep,
    resultSubtype: result?.subtype ?? null,
    models: Object.keys(result?.modelUsage ?? {}),
    error,
    checkPassed,
    diffStat,
    permissionDenials: result?.permission_denials?.length ?? 0,
    metrics: measureRun(blocks, result),
    blocks,
  };
}

function readRuns(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function writeReport(dir, runs, meta) {
  const file = path.join(dir, 'report.md');
  fs.writeFileSync(file, renderReport(runs, meta));
  return file;
}

async function main() {
  if (args.report) {
    const runsFile = path.resolve(args.report);
    const dir = path.dirname(runsFile);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    console.log(`Report: ${writeReport(dir, readRuns(runsFile), meta)}`);
    return;
  }

  const styles = args.styles.split(',').map((s) => s.trim()).filter(Boolean);
  const runs = Number(args.runs);
  let tasks = args.tasks ? JSON.parse(fs.readFileSync(path.resolve(args.tasks), 'utf8')) : DEFAULT_TASKS;
  if (args.only) {
    const only = new Set(args.only.split(','));
    tasks = tasks.filter((t) => only.has(t.id));
  }
  if (!tasks.length || !styles.length || !(runs > 0)) throw new Error('Nothing to run: check --tasks, --only, --styles and --runs.');

  const { getCavemanPrompt } = await import('../src/main/caveman.ts').catch((err) => {
    throw new Error(`Could not load src/main/caveman.ts (needs Node 22.18 or later): ${err.message}`);
  });
  for (const style of styles) {
    if (style !== 'off' && !getCavemanPrompt(style)) throw new Error(`Unknown style "${style}"`);
  }

  const commit = git('rev-parse', '--short', args.ref);
  const total = tasks.length * styles.length * runs;
  console.log(`${tasks.length} tasks x ${styles.length} styles (${styles.join(', ')}) x ${runs} runs = ${total} runs at ${commit}`);
  console.log(`Up to $${args['max-budget']} each, so at most $${(total * Number(args['max-budget'])).toFixed(2)} in all.`);
  if (args['dry-run']) {
    for (const t of tasks) console.log(`- ${t.id}${t.check ? ` (check: ${t.check})` : ''}: ${t.prompt}`);
    return;
  }

  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(ROOT, 'out', 'response-style-eval', stamp);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { date: new Date().toISOString().slice(0, 16).replace('T', ' '), commit, model: args.model ?? null, runs, styles, userSettings: args['user-settings'] };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  const runsFile = path.join(dir, 'runs.jsonl');

  // Styles take turns going first, so a slow hour or a warm cache doesn't
  // favour one of them.
  const done = [];
  let spent = 0;
  for (let rep = 1; rep <= runs; rep++) {
    for (const task of tasks) {
      const order = rep % 2 ? styles : [...styles].reverse();
      for (const style of order) {
        process.stdout.write(`[${done.length + 1}/${total}] ${task.id}, ${style}, run ${rep}... `);
        const run = await runOne({ task, style, rep, stylePrompt: style === 'off' ? null : getCavemanPrompt(style), query });
        fs.appendFileSync(runsFile, JSON.stringify(run) + '\n');
        done.push(run);
        spent += run.metrics.costUsd ?? 0;
        const m = run.metrics;
        console.log(run.error
          ? `error: ${run.error}`
          : `${m.outputTokens ?? '?'} output tokens, ${m.noteWords} note words, ${m.answerWords} answer words${run.checkPassed === false ? ', check FAILED' : ''} ($${spent.toFixed(2)} so far)`);
      }
    }
  }
  console.log(`Report: ${writeReport(dir, done, meta)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
