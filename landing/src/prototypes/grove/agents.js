// The conversations that live in the grove. Plain data plus a tiny step
// machine that walks each agent through its tool calls.

import { models } from '../shared/brand.js';

/**
 * @typedef {[tool: string, detail: string]} Step
 * @typedef {{
 *   id: string, branch: string, model: string, look: number,
 *   status: 'working' | 'permission' | 'ready',
 *   task: string, script?: Step[], ask?: string,
 *   allowScript?: Step[], denyScript?: Step[], readyText?: string,
 *   term: [string, string], history?: { you: string, step: Step }[],
 * }} AgentDef
 */

/** @type {AgentDef[]} */
export const STARTING_AGENTS = [
  {
    id: 'a3f8b2c1',
    branch: 'feat/auth',
    model: models.opus.label,
    look: 0,
    status: 'working',
    task: 'Adding JWT middleware to the API routes.',
    script: [
      ['Read', 'routes/index.ts'],
      ['Edit', 'auth.ts +47'],
      ['Edit', 'index.ts +8 -3'],
      ['Bash', 'npm test'],
      ['done', '4 passed'],
    ],
    term: ['$ npm test', '4 passed'],
  },
  {
    id: '7c19e0d4',
    branch: 'feat/api',
    model: models.sonnet.label,
    look: 1,
    status: 'permission',
    task: 'Building the user profile endpoints.',
    ask: 'npm install zod',
    allowScript: [
      ['Bash', 'npm install zod'],
      ['Write', 'profile.ts +89'],
      ['Edit', 'routes.ts +3 -1'],
      ['Bash', 'npm test'],
      ['done', '7 passed'],
    ],
    denyScript: [
      ['Read', 'package.json'],
      ['Edit', 'profile.ts +31'],
      ['Bash', 'npm test'],
      ['done', '7 passed'],
    ],
    term: ['$ npm run dev', 'server running'],
  },
  {
    id: 'e52b9a73',
    branch: 'fix/login-bug',
    model: models.haiku.label,
    look: 2,
    status: 'ready',
    task: 'Fixed the early logout. Ready for your review.',
    readyText: 'Ready: 2 files',
    term: ['$ npm test', '5 passed'],
    history: [
      { you: 'Users get logged out after 5 min', step: ['Read', 'session.ts'] },
      { you: 'Refresh the token earlier', step: ['Edit', 'session.ts +12 -4'] },
      { you: 'Add a test for it', step: ['Write', 'session.test.ts +38'] },
      { you: 'Run the tests', step: ['Bash', 'npm test'] },
    ],
  },
];

/** Agents that arrive when a visitor plants a tree. */
export const PLANTED_AGENTS = [
  {
    id: '1d6f4c08',
    branch: 'feat/search',
    model: models.opus.label,
    look: 3,
    status: 'working',
    task: 'Fresh worktree, clean branch. Adding search to the dashboard.',
    script: [
      ['Read', 'package.json'],
      ['Grep', 'searchIndex'],
      ['Write', 'search.ts +64'],
      ['Bash', 'npm test'],
      ['done', '6 passed'],
    ],
    term: ['$ git status', 'clean'],
  },
  {
    id: '9b0e27f5',
    branch: 'docs/readme',
    model: models.sonnet.label,
    look: 4,
    status: 'working',
    task: 'Fresh worktree, clean branch. Updating the README.',
    script: [
      ['Read', 'README.md'],
      ['Glob', 'docs/**/*.md'],
      ['Edit', 'README.md +22 -5'],
      ['done', 'Done'],
    ],
    term: ['$ git diff --stat', '1 file changed'],
  },
];

export const MAX_TREES = STARTING_AGENTS.length + PLANTED_AGENTS.length;

const STEP_SECONDS = 2.6;
const DONE_SECONDS = 5.5;

/** Live agent state, created from a definition. */
export function createAgent(def) {
  return {
    ...def,
    status: def.status,
    script: def.script ?? [],
    step: 0,
    timer: 0,
    // Bubble shown above the agent: { tool, detail } or null.
    bubble: initialBubble(def),
    answered: null,
  };
}

function initialBubble(def) {
  if (def.status === 'permission') return { tool: '?', detail: '' };
  if (def.status === 'ready') return { tool: 'done', detail: def.readyText ?? 'Ready' };
  const [tool, detail] = def.script[0];
  return { tool, detail };
}

/**
 * Advances one agent. Returns true when what the visitor sees changed.
 * @param {ReturnType<typeof createAgent>} a
 */
export function stepAgent(a, dt) {
  if (a.status === 'permission') return false;
  if (a.status === 'ready' && !a.script.length) return false;
  if (!a.script.length) return false;
  a.timer += dt;
  const [tool] = a.script[a.step];
  const hold = tool === 'done' ? DONE_SECONDS : STEP_SECONDS;
  if (a.timer < hold) return false;
  a.timer = 0;
  // A permission agent that finished its reply stays ready.
  if (tool === 'done' && a.answered) {
    a.script = [];
    return false;
  }
  a.step = (a.step + 1) % a.script.length;
  const [nextTool, detail] = a.script[a.step];
  a.bubble = { tool: nextTool, detail };
  a.status = nextTool === 'done' ? 'ready' : 'working';
  return true;
}

/** Answers the permission request. */
export function answerAgent(a, allow) {
  a.answered = allow ? 'allow' : 'deny';
  a.script = (allow ? a.allowScript : a.denyScript) ?? [];
  a.step = 0;
  a.timer = 0;
  a.status = 'working';
  const [tool, detail] = a.script[0];
  a.bubble = { tool, detail };
}

export function statusLabel(status) {
  return { working: 'Working', permission: 'Waiting for you', ready: 'Ready' }[status] ?? status;
}
