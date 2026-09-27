// The conversations that live in the grove. Plain data plus a tiny step
// machine that walks each agent through its tool calls.
//
// A step is [tool, short detail for the speech bubble, longer detail for the
// app panel]. The third item is optional.

import { models } from '../shared/brand.js';

/**
 * @typedef {[tool: string, detail: string, full?: string]} Step
 */

export const STARTING_AGENTS = [
  {
    id: 'a3f8b2c1',
    branch: 'feat/auth',
    model: models.opus.label,
    look: 0,
    status: 'working',
    prompt: 'Add JWT auth middleware to the API routes',
    task: 'Adding JWT middleware to the API routes.',
    script: [
      ['Read', 'routes/index.ts', 'src/routes/index.ts'],
      ['Edit', 'auth.ts +47', 'src/middleware/auth.ts +47'],
      ['Edit', 'index.ts +8 -3', 'src/routes/index.ts +8 -3'],
      ['Bash', 'npm test'],
      ['done', '4 passed', '4 tests passed. The middleware is in place.'],
    ],
    term: ['$ npm test', '4 passed'],
  },
  {
    id: '7c19e0d4',
    branch: 'feat/api',
    model: models.sonnet.label,
    look: 1,
    status: 'permission',
    prompt: 'Build the user profile endpoints',
    task: 'Building the user profile endpoints.',
    before: [
      ['Read', 'routes/index.ts', 'src/routes/index.ts'],
      ['Write', 'types.ts +24', 'src/types/profile.ts +24'],
    ],
    ask: 'npm install zod',
    allowScript: [
      ['Bash', 'npm install zod'],
      ['Write', 'profile.ts +89', 'src/routes/profile.ts +89'],
      ['Edit', 'routes.ts +3 -1', 'src/routes/index.ts +3 -1'],
      ['Bash', 'npm test'],
      ['done', '7 passed', '7 tests passed. The profile endpoints are ready.'],
    ],
    denyScript: [
      ['Read', 'package.json'],
      ['Edit', 'profile.ts +31', 'src/routes/profile.ts +31'],
      ['Bash', 'npm test'],
      ['done', '7 passed', '7 tests passed, with the input checked by hand.'],
    ],
    term: ['$ npm run dev', 'server running'],
  },
  {
    id: 'e52b9a73',
    branch: 'fix/login-bug',
    model: models.haiku.label,
    look: 2,
    status: 'ready',
    prompt: 'Users get logged out after 5 min',
    task: 'Fixed the early logout. Ready for your review.',
    readyText: 'Ready: 2 files',
    term: ['$ npm test', '5 passed'],
    // One entry per message you sent: what you said and what the agent did.
    history: [
      { you: 'Users get logged out after 5 min', step: ['Read', 'session.ts', 'src/auth/session.ts'], add: 0, del: 0 },
      { you: 'Refresh the token earlier', step: ['Edit', 'session.ts +12 -4', 'src/auth/session.ts +12 -4'], add: 12, del: 4 },
      { you: 'Add a test for it', step: ['Write', 'session.test.ts +38', 'src/auth/session.test.ts +38'], add: 38, del: 0 },
      { you: 'Run the tests', step: ['Bash', 'npm test'], add: 0, del: 0 },
    ],
    closing: 'Fixed. 5 tests passed, 2 files changed.',
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
    prompt: 'Add search to the dashboard',
    task: 'Fresh worktree, clean branch. Adding search to the dashboard.',
    script: [
      ['Read', 'package.json'],
      ['Grep', 'searchIndex'],
      ['Write', 'search.ts +64', 'src/search/search.ts +64'],
      ['Bash', 'npm test'],
      ['done', '6 passed', '6 tests passed. Search is wired up.'],
    ],
    term: ['$ git status', 'clean'],
  },
  {
    id: '9b0e27f5',
    branch: 'docs/readme',
    model: models.sonnet.label,
    look: 4,
    status: 'working',
    prompt: 'Update the README for the new API',
    task: 'Fresh worktree, clean branch. Updating the README.',
    script: [
      ['Read', 'README.md'],
      ['Glob', 'docs/**/*.md'],
      ['Edit', 'README.md +22 -5'],
      ['done', 'Done', 'The README covers the new endpoints.'],
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
  if (!a.script.length) return false;
  if (a.finished) return false;
  a.timer += dt;
  const [tool] = a.script[a.step];
  const hold = tool === 'done' ? DONE_SECONDS : STEP_SECONDS;
  if (a.timer < hold) return false;
  a.timer = 0;
  // An agent that finished its reply to a permission answer stays ready.
  if (tool === 'done' && a.answered) {
    a.finished = true;
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
  return (
    { working: 'Working', permission: 'Waiting for you', ready: 'Ready', starting: 'Starting' }[status] ?? status
  );
}

const toolItem = ([tool, detail, full], pending = false) =>
  tool === 'done' ? { kind: 'text', text: full ?? detail } : { kind: 'tool', tool, detail: full ?? detail, pending };

/**
 * What the Activity tab of the app would show for this conversation right
 * now: your message, then the agent's recent tool calls. Newest last.
 */
export function activityFor(a, phase = 'sit') {
  if (phase !== 'sit') {
    return [
      { kind: 'user', text: a.prompt },
      { kind: 'system', text: `Creating worktree .grove-wt/${a.id}` },
    ];
  }
  if (a.history) {
    const items = a.history.slice(-2).flatMap((h) => [{ kind: 'user', text: h.you }, toolItem(h.step)]);
    return [...items, { kind: 'text', text: a.closing }];
  }
  const items = [{ kind: 'user', text: a.prompt }];
  for (const s of a.before ?? []) items.push(toolItem(s));
  if (a.ask) {
    if (!a.answered) {
      items.push({ kind: 'permission', tool: 'Bash', detail: a.ask });
      return items.slice(-6);
    }
    items.push({ kind: 'permission', tool: 'Bash', detail: a.ask, resolved: a.answered === 'allow' ? 'Allowed' : 'Denied' });
  }
  a.script.slice(0, a.step + 1).forEach((s, i) => items.push(toolItem(s, i === a.step && a.status === 'working')));
  return items.slice(-6);
}
