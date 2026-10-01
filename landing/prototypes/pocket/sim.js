// Pocket grove's conversations: a small simulation advanced by `tick`. Each
// change that the app would show is logged with what it means there.

import { ARRIVE_TYPE_AT_MS } from '../shared/app-art.js';

export const MAX = 5;
/** Demo speed: idle seconds before an unopened conversation falls asleep. The app's default is 30 minutes. */
export const SLEEP_S = 24;
const STEP_S = 2.6;
// The app's wake-up scene lasts 2.2 seconds (WAKE_SCENE_MS in grove-walk.ts).
const WAKE_S = 2.2;

const TOOLS = [
  'Read src/routes/index.ts',
  'Grep "session" src/',
  'Edit src/auth/session.ts',
  'Write src/search/search.ts',
  'Read package.json',
  'Edit README.md',
  'Bash npm test',
  'Glob src/**/*.test.ts',
  'Edit src/pages/Dashboard.svelte',
];

const NEXT_TASKS = [
  { you: 'Add a test for it', reply: 'Added the test. All tests pass.', ask: null, steps: 3 },
  { you: 'Tidy up the error messages', reply: 'Error messages are clearer now.', ask: null, steps: 3 },
  { you: 'Add a loading state', reply: 'There is a spinner while it loads.', ask: 'npm run dev', steps: 4 },
  { you: 'Update the docs', reply: 'The docs cover the change.', ask: null, steps: 2 },
];

const NEW_CONVERSATIONS = [
  { branch: 'feat/dark-mode', task: { you: 'Add a dark mode toggle', reply: 'Dark mode is in, and it remembers your choice.', ask: 'npm run check', steps: 4 } },
  { branch: 'fix/invoice-date', task: { you: 'Invoices show the wrong date', reply: 'Dates use the customer time zone now.', ask: null, steps: 3 } },
  { branch: 'feat/rate-limit', task: { you: 'Rate limit the login endpoint', reply: 'Login allows 5 tries a minute.', ask: 'npm install express-rate-limit', steps: 4 } },
];

let seq = 0;
const ids = ['7c19e0d4', 'e52b9a73', '9b0e27f5', '1d6f4c08', 'a3f8b2c1', '5b7e2d90', 'c08f13a6', '3e7a1d95'];

function conv(branch, state, context, extra = {}) {
  return {
    id: ids[seq++ % ids.length],
    branch,
    state,
    context,
    timer: 0,
    idle: 0,
    steps: 0,
    ask: null,
    askAt: -1,
    line: '',
    reply: '',
    scene: null,
    run: 0,
    turns: 1,
    ...extra,
  };
}

export function createPocket() {
  seq = 0;
  return {
    cur: 0,
    clock: 9 * 60 + 41,
    convs: [
      conv('feat/api', 'working', 34, { steps: 4, ask: 'npm install zod', askAt: 3, line: 'Write src/types/profile.ts', reply: 'The profile endpoints are ready. 7 tests passed.' }),
      conv('fix/login-bug', 'unread', 58, { line: 'Fixed. 5 tests passed.' }),
      conv('docs/readme', 'sleeping', 22, { line: 'The README covers the new endpoints.' }),
    ],
    planted: 0,
    toast: null,
    buzz: 0,
    log: [{ text: 'Three conversations, one pocket. Use ◀ ▶ to look at each one.' }],
  };
}

function log(g, text) {
  g.log.unshift({ text });
  if (g.log.length > 30) g.log.length = 30;
}

function notify(g, c, what) {
  g.toast = { text: `${c.branch}: ${what}`, t: 2.8 };
  g.buzz += 1;
}

export const viewing = (g) => g.convs[g.cur] ?? null;

export function tick(g, dt) {
  g.clock += dt / 4;
  if (g.toast) {
    g.toast.t -= dt;
    if (g.toast.t <= 0) g.toast = null;
  }
  g.convs.forEach((c, i) => {
    const seen = i === g.cur;
    c.timer += dt;
    if (c.scene === 'arrive') {
      if (c.timer * 1000 >= ARRIVE_TYPE_AT_MS) {
        c.scene = null;
        c.state = 'working';
        c.timer = 0;
      }
      return;
    }
    if (c.scene === 'wake') {
      if (c.timer >= WAKE_S) {
        c.scene = null;
        c.state = 'ready';
        c.timer = 0;
      }
      return;
    }
    if (c.state === 'working' && c.timer >= STEP_S) {
      c.timer = 0;
      if (c.ask && c.steps === c.askAt) {
        c.state = 'permission';
        c.line = `Wants to run: ${c.ask}`;
        log(g, `${c.branch} is waiting for you to allow \`${c.ask}\`. Amber, and it counts under Needs you.`);
        if (!seen) notify(g, c, 'needs you');
        return;
      }
      c.steps -= 1;
      c.context = Math.min(97, c.context + 3 + ((c.steps * 7 + c.context) % 5));
      if (c.steps <= 0) {
        c.line = c.reply;
        c.state = seen ? 'ready' : 'unread';
        c.idle = 0;
        log(g, seen ? `${c.branch} finished its turn.` : `${c.branch} finished a turn while you looked elsewhere. It waves in green under Unread.`);
        if (!seen) notify(g, c, 'finished a turn');
      } else {
        c.line = TOOLS[(c.context + c.steps) % TOOLS.length];
      }
      return;
    }
    if ((c.state === 'ready' || c.state === 'unread') && !seen) {
      c.idle += dt;
      if (c.idle >= SLEEP_S) {
        c.state = 'sleeping';
        log(g, `${c.branch} fell asleep. Idle conversations sleep to save memory and CPU (after 30 minutes in the app). Its terminal keeps running.`);
      }
    }
  });
}

/** Moves to another conversation, or the New conversation page past the end. */
export function move(g, d) {
  const pages = g.convs.length + (g.convs.length < MAX ? 1 : 0);
  g.cur = (g.cur + d + pages) % pages;
  const c = viewing(g);
  if (c?.state === 'unread') {
    c.state = 'ready';
    log(g, `You opened ${c.branch}. Seen, so it goes back to grey.`);
  }
  if (c) c.idle = 0;
}

/** The A button: whatever the conversation needs next. */
export function primary(g) {
  const c = viewing(g);
  if (!c) return start(g);
  if (c.scene) return;
  if (c.state === 'permission') {
    log(g, `Allowed \`${c.ask}\` in ${c.branch}.`);
    c.ask = null;
    c.state = 'working';
    c.line = `Bash ${c.line.replace('Wants to run: ', '')}`;
    c.timer = 0;
  } else if (c.state === 'sleeping' || c.state === 'stopped') {
    c.scene = 'wake';
    c.run += 1;
    c.timer = 0;
    log(g, `${c.branch} wakes up on its bench, then walks off while the agent starts. Same mode, same "always allow" choices.`);
  } else if (c.state === 'ready' || c.state === 'unread') {
    const t = NEXT_TASKS[(c.turns - 1) % NEXT_TASKS.length];
    c.turns += 1;
    c.state = 'working';
    c.steps = t.steps;
    c.ask = t.ask;
    c.askAt = t.ask ? Math.max(1, t.steps - 1) : -1;
    c.reply = t.reply;
    c.line = `You: ${t.you}`;
    c.timer = 0;
    log(g, `You sent "${t.you}" to ${c.branch}. A checkpoint is saved before the agent acts on it.`);
  }
}

/** The B button: deny a waiting request. */
export function secondary(g) {
  const c = viewing(g);
  if (!c || c.state !== 'permission') return;
  log(g, `Denied \`${c.ask}\` in ${c.branch}. The agent works around it.`);
  c.ask = null;
  c.state = 'working';
  c.line = "OK, I'll do it another way.";
  c.timer = 0;
}

/** START: a new conversation. Its agent walks up to the bench and starts typing. */
export function start(g) {
  if (g.convs.length >= MAX) return;
  const def = NEW_CONVERSATIONS[g.planted % NEW_CONVERSATIONS.length];
  g.planted += 1;
  const c = conv(def.branch, 'starting', 0, {
    scene: 'arrive',
    steps: def.task.steps,
    ask: def.task.ask,
    askAt: def.task.ask ? Math.max(1, def.task.steps - 1) : -1,
    reply: def.task.reply,
    line: `You: ${def.task.you}`,
  });
  c.run = 1;
  g.convs.push(c);
  g.cur = g.convs.length - 1;
  log(g, `New conversation on ${c.branch}, in its own worktree. Its agent walks up to the bench, sits down and starts typing.`);
}

/** SELECT: /compact the conversation you're looking at, when it's idle. */
export function compact(g) {
  const c = viewing(g);
  if (!c || !(c.state === 'ready' || c.state === 'unread') || c.context < 15) return false;
  const before = c.context;
  c.context = Math.max(6, Math.round(c.context * 0.28));
  log(g, `/compact in ${c.branch}: the conversation is summarised, from ${before}% to ${c.context}% of the context window. Its grove thins out.`);
  return true;
}

/** What A and B do right now, for the on-screen hint. */
export function hints(g) {
  const c = viewing(g);
  if (!c) return { a: g.convs.length < MAX ? 'Start' : null, b: null };
  if (c.scene) return { a: null, b: null };
  if (c.state === 'permission') return { a: 'Allow', b: 'Deny' };
  if (c.state === 'sleeping' || c.state === 'stopped') return { a: 'Wake', b: null };
  if (c.state === 'ready' || c.state === 'unread') return { a: 'Next task', b: null };
  return { a: null, b: null };
}

export function counts(g) {
  const n = { needs: 0, working: 0, unread: 0 };
  for (const c of g.convs) {
    if (c.state === 'permission') n.needs++;
    else if (c.state === 'working' || c.state === 'starting') n.working++;
    else if (c.state === 'unread') n.unread++;
  }
  return n;
}

export function clockText(m) {
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
}
