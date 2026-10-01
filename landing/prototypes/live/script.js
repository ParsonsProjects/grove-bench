// The tour: a starting world and a list of beats. A beat happens at `at`
// seconds; `cursor` names a [data-target] in the window for the pointer to
// click first; `run` changes the world. Replaying beats from the start
// rebuilds any moment exactly, which is how chapters and Resume work.
//
// Each conversation is in a different mode, so the tour shows what each
// allows without saying so: Auto runs everything past Claude's classifier,
// Ask stops for commands, Edit lets file edits through, Read-safe lets edits
// and read-only commands through.

const COLOR = '#6ec87a';

const diffStats = (diff) => ({
  add: diff.filter((l) => l.startsWith('+')).length,
  del: diff.filter((l) => l.startsWith('-')).length,
});
const file = (path, status, diff) => ({ path, status, diff, ...diffStats(diff) });

const AUTH_TS = file('src/middleware/auth.ts', 'A', [
  '@@ -0,0 +1,14 @@',
  "+import jwt from 'jsonwebtoken';",
  "+import type { Request, Response, NextFunction } from 'express';",
  '+',
  '+export function requireAuth(req: Request, res: Response, next: NextFunction) {',
  "+  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');",
  "+  if (!token) return res.status(401).json({ error: 'Missing token' });",
  '+  try {',
  '+    req.user = jwt.verify(token, process.env.JWT_SECRET!);',
  '+    next();',
  '+  } catch {',
  "+    res.status(401).json({ error: 'Invalid token' });",
  '+  }',
  '+}',
]);

const ROUTES_TS = file('src/routes/index.ts', 'M', [
  '@@ -1,8 +1,12 @@',
  " import { Router } from 'express';",
  "+import { requireAuth } from '../middleware/auth';",
  " import { orders } from './orders';",
  " import { profile } from './profile';",
  ' ',
  ' export const routes = Router();',
  "-routes.use('/orders', orders);",
  "-routes.use('/profile', profile);",
  "+routes.use('/orders', requireAuth, orders);",
  "+routes.use('/profile', requireAuth, profile);",
  '+',
  '+// Health checks stay public.',
  "+routes.get('/health', (_req, res) => res.send('ok'));",
]);

const SESSION_TS = file('src/auth/session.ts', 'M', [
  '@@ -12,7 +12,8 @@ export function scheduleRefresh(session: Session) {',
  '-  const expiresIn = session.ttl * 60;',
  '+  // ttl is already in seconds.',
  '+  const expiresIn = session.ttl;',
  '   const refreshAt = expiresIn - 60;',
  '   timer = setTimeout(() => refresh(session), refreshAt * 1000);',
  ' }',
]);

const README = file('README.md', 'M', [
  '@@ -40,6 +40,9 @@ ## API',
  '-All endpoints are public.',
  '+Every endpoint except `/health` needs a token:',
  '+',
  '+    Authorization: Bearer <token>',
]);

const SEARCH_TS = file('src/search/search.ts', 'A', [
  '@@ -0,0 +1,6 @@',
  "+import Fuse from 'fuse.js';",
  "+import type { Order } from '../types';",
  '+',
  '+export function searchOrders(orders: Order[], query: string) {',
  "+  return new Fuse(orders, { keys: ['id', 'customer', 'items.name'] }).search(query);",
  '+}',
]);

export function initialWorld() {
  return {
    project: 'acme-shop',
    projectColor: COLOR,
    selected: 'a3f8b2c1',
    tab: 'thread',
    file: 0,
    checkpoint: -1,
    draft: null,
    convs: [
      {
        id: 'a3f8b2c1',
        name: 'feat/auth',
        project: 'acme-shop',
        projectColor: COLOR,
        state: 'working',
        line: 'Write: src/middleware/auth.ts',
        lineTone: 'blue',
        age: '1m ago',
        model: 'Opus 5.5',
        mode: 'Auto',
        context: 31,
        ahead: 2,
        pr: null,
        scene: null,
        run: 0,
        items: [
          { kind: 'you', text: 'Add JWT auth to the API routes (API-142)' },
          { kind: 'text', text: "I'll add a middleware that checks the token, then put it in front of the routes." },
          { kind: 'tool', tool: 'Read', detail: 'src/routes/index.ts' },
          { kind: 'tool', tool: 'Write', detail: AUTH_TS.path, add: AUTH_TS.add },
        ],
        files: [AUTH_TS],
        checkpoints: [
          { turn: 1, text: 'Add JWT auth to the API routes (API-142)', add: AUTH_TS.add + ROUTES_TS.add, del: ROUTES_TS.del, files: 2, age: '9m ago' },
          { turn: 2, text: 'Keep the health check public', add: 3, del: 0, files: 1, age: '2m ago' },
        ],
        term: ['npm test', '', ' ✓ auth.test.ts (4)', ' ✓ routes.test.ts (2)', '', ' Tests  6 passed (6)'],
      },
      {
        id: 'e52b9a73',
        name: 'fix/login-bug',
        project: 'acme-shop',
        projectColor: COLOR,
        state: 'permission',
        line: 'Wants to run a command',
        lineTone: 'amber',
        age: '4m ago',
        model: 'Sonnet 4.6',
        mode: 'Ask',
        context: 22,
        ahead: 1,
        pr: null,
        scene: null,
        run: 0,
        items: [
          { kind: 'you', text: 'Users get logged out after 5 minutes' },
          { kind: 'text', text: 'Found it: the session lifetime is stored in seconds, but one place multiplies it by 60 again.' },
          { kind: 'perm', tool: 'Edit', detail: SESSION_TS.path, resolved: 'allowed' },
          { kind: 'tool', tool: 'Edit', detail: SESSION_TS.path, add: SESSION_TS.add, del: SESSION_TS.del },
          { kind: 'perm', tool: 'Bash', detail: 'npm test', resolved: null },
        ],
        files: [SESSION_TS],
        checkpoints: [{ turn: 1, text: 'Users get logged out after 5 minutes', add: SESSION_TS.add, del: SESSION_TS.del, files: 1, age: '4m ago' }],
      },
      {
        id: '9b0e27f5',
        name: 'docs/readme',
        project: 'acme-shop',
        projectColor: COLOR,
        state: 'sleeping',
        line: 'The README covers the new endpoints.',
        lineTone: 'muted',
        age: '1h ago',
        model: 'Haiku 4.5',
        mode: 'Edit',
        context: 18,
        ahead: 1,
        pr: null,
        scene: null,
        run: 0,
        items: [
          { kind: 'you', text: 'Update the README for the new API' },
          { kind: 'tool', tool: 'Read', detail: 'README.md' },
          { kind: 'tool', tool: 'Edit', detail: README.path, add: README.add, del: README.del },
          { kind: 'text', text: 'The README covers the new endpoints, with an example header.' },
        ],
        files: [README],
        checkpoints: [{ turn: 1, text: 'Update the README for the new API', add: README.add, del: README.del, files: 1, age: '1h ago' }],
      },
    ],
  };
}

const conv = (w, id) => w.convs.find((c) => c.id === id);
const A = 'a3f8b2c1';
const B = 'e52b9a73';
const C = '9b0e27f5';
const D = '1d6f4c08';

function finish(c, text, seen) {
  c.items.push({ kind: 'text', text });
  c.state = seen ? 'ready' : 'unread';
  c.line = text;
  c.lineTone = 'muted';
}

/** Starting the drafted conversation. Also used when a visitor clicks Start. */
export function startDraft(w) {
  w.draft = null;
  w.convs.push({
    id: D,
    name: `grove/${D}`,
    project: 'acme-shop',
    projectColor: COLOR,
    state: 'starting',
    line: 'Working…',
    lineTone: 'blue',
    age: 'now',
    model: 'Opus 5.5',
    mode: 'Read-safe',
    context: 4,
    ahead: 0,
    pr: null,
    scene: 'arrive',
    run: 1,
    items: [{ kind: 'you', text: 'Add search to the dashboard (UI-31)' }],
    files: [],
    checkpoints: [{ turn: 1, text: 'Add search to the dashboard (UI-31)', add: 0, del: 0, files: 0, age: 'now' }],
  });
  w.selected = D;
  w.tab = 'thread';
}

export const BEATS = [
  {
    at: 0,
    chapter: 'Side by side',
    caption: 'Three conversations on one project. Each has its own worktree, branch and terminal, so none of them touches the others’ files.',
  },
  {
    at: 1.6,
    run: (w) => {
      const a = conv(w, A);
      a.items.push({ kind: 'you', text: 'Keep the health check public' }, { kind: 'tool', tool: 'Edit', detail: ROUTES_TS.path, add: ROUTES_TS.add, del: ROUTES_TS.del });
      a.files = [AUTH_TS, ROUTES_TS];
      a.line = `Edit: ${ROUTES_TS.path}`;
      a.context = 36;
    },
  },
  {
    at: 3.2,
    run: (w) => {
      const a = conv(w, A);
      a.items.push({ kind: 'bash', cmd: 'npm test', running: true });
      a.line = 'Bash: npm test';
    },
  },
  {
    at: 5,
    cursor: `row-${B}`,
    chapter: 'It asks first',
    caption: 'fix/login-bug is in Ask mode, so it waits before running a command. Its character holds up a question mark, in amber.',
    run: (w) => {
      w.selected = B;
      w.tab = 'thread';
    },
  },
  {
    at: 7.8,
    cursor: 'allow',
    caption: 'Allowed. The prompt keeps a tick so you can see what you chose, and the agent carries on.',
    run: (w) => {
      const b = conv(w, B);
      b.items.at(-1).resolved = 'allowed';
      b.items.push({ kind: 'bash', cmd: 'npm test', running: true });
      b.state = 'working';
      b.line = 'Bash: npm test';
      b.lineTone = 'blue';
    },
  },
  {
    at: 9.4,
    caption: 'Meanwhile feat/auth finished. You were looking elsewhere, so it waves in green and counts under Unread.',
    run: (w) => {
      const a = conv(w, A);
      const bash = a.items.findLast((i) => i.kind === 'bash');
      bash.running = false;
      bash.out = '6 passed';
      a.context = 41;
      finish(a, 'Every route checks the token now, and /health stays public. 6 tests passed.', w.selected === A);
    },
  },
  {
    at: 11,
    run: (w) => {
      const b = conv(w, B);
      const bash = b.items.findLast((i) => i.kind === 'bash');
      bash.running = false;
      bash.out = '5 passed';
      b.context = 27;
      finish(b, 'Fixed: the token refreshes a minute before it expires now. 5 tests passed.', w.selected === B);
    },
  },
  {
    at: 12.8,
    cursor: `row-${A}`,
    chapter: 'Review',
    caption: 'Open feat/auth to see what it did.',
    run: (w) => {
      w.selected = A;
      const a = conv(w, A);
      if (a.state === 'unread') a.state = 'ready';
    },
  },
  {
    at: 14.4,
    cursor: 'tab-changes',
    caption: 'The Changes tab lists every file it touched, with the diff. You can revert a file or open it in your editor.',
    run: (w) => {
      w.tab = 'changes';
      w.file = 0;
    },
  },
  {
    at: 16.6,
    cursor: 'file-1',
    run: (w) => {
      w.file = 1;
    },
  },
  {
    at: 19,
    cursor: 'tab-checkpoints',
    chapter: 'Checkpoints',
    caption: 'Every message you send saves a checkpoint first.',
    run: (w) => {
      w.tab = 'checkpoints';
      w.checkpoint = -1;
    },
  },
  {
    at: 20.6,
    cursor: 'cp-0',
    caption: 'Pick one to see what changed since. Rewind all puts back the files and the conversation; Conv. only resets just the conversation.',
    run: (w) => {
      w.checkpoint = 0;
    },
  },
  {
    at: 24,
    cursor: 'tab-thread',
    run: (w) => {
      w.tab = 'thread';
    },
  },
  {
    at: 25.4,
    cursor: 'create-pr',
    chapter: 'Ship',
    caption: 'Happy with it? Create a PR from the status bar, or merge the branch your usual way.',
    run: (w) => {
      conv(w, A).pr = 42;
    },
  },
  {
    at: 27.8,
    cursor: 'new',
    chapter: 'Start another',
    caption: 'A new conversation starts as a draft. Describe the task. You don’t have to name the branch.',
    run: (w) => {
      w.draft = { text: '' };
    },
  },
  { at: 28.8, typing: 'Add search to the dashboard (UI-31)' },
  {
    at: 31.6,
    cursor: 'start',
    caption: 'It gets a new branch and its own worktree. Its agent walks up to the bench under your message, sits down and starts typing.',
    run: startDraft,
  },
  {
    at: 35.4,
    run: (w) => {
      const d = conv(w, D);
      d.scene = null;
      d.state = 'working';
      d.items.push({ kind: 'text', text: "I'll look at the dashboard first." }, { kind: 'tool', tool: 'Read', detail: 'src/pages/Dashboard.svelte' });
      d.line = 'Read: src/pages/Dashboard.svelte';
      d.context = 9;
    },
  },
  {
    at: 36.8,
    caption: 'After its first reply the branch gets a real name, from your message and the project’s branch style. The ticket ID comes along.',
    run: (w) => {
      conv(w, D).name = 'feat/UI-31-dashboard-search';
    },
  },
  {
    at: 38.6,
    run: (w) => {
      const d = conv(w, D);
      d.items.push({ kind: 'tool', tool: 'Write', detail: SEARCH_TS.path, add: SEARCH_TS.add });
      d.files = [SEARCH_TS];
      d.line = `Write: ${SEARCH_TS.path}`;
      d.context = 17;
    },
  },
  {
    at: 40.4,
    cursor: `row-${C}`,
    chapter: 'Sleep and wake',
    caption: 'docs/readme sat idle for 30 minutes, so its agent was shut down to save memory and CPU. Opening it wakes it on its bench.',
    run: (w) => {
      w.selected = C;
      w.tab = 'thread';
      const c = conv(w, C);
      c.scene = 'wake';
      c.run += 1;
      c.state = 'starting';
    },
  },
  {
    at: 43,
    caption: 'Back where it left off, with the same mode and “always allow” choices. Its terminal was left running the whole time.',
    run: (w) => {
      const c = conv(w, C);
      c.scene = null;
      c.state = 'ready';
    },
  },
  {
    at: 45,
    cursor: `row-${D}`,
    chapter: 'Context grove',
    caption: 'The grove along the top of the status bar grows as a conversation fills its context window, and thins out again after /compact.',
    run: (w) => {
      w.selected = D;
      const d = conv(w, D);
      d.context = 46;
      d.items.push({ kind: 'tool', tool: 'Edit', detail: 'src/pages/Dashboard.svelte', add: 18, del: 2 });
      d.line = 'Edit: src/pages/Dashboard.svelte';
    },
  },
  {
    at: 47.4,
    run: (w) => {
      const d = conv(w, D);
      d.context = 68;
      d.items.push({ kind: 'bash', cmd: 'npm test', running: true });
      d.line = 'Bash: npm test';
    },
  },
  { at: 50, caption: 'That’s the tour. Click around the window, or pick a moment to see it again.' },
];

export const END = 54;

export const CHAPTERS = BEATS.filter((b) => b.chapter).map((b) => ({ name: b.chapter, at: b.at }));

/** The world as it is just before `t`, with every earlier beat applied. */
export function worldAt(t) {
  const w = initialWorld();
  for (const b of BEATS) {
    if (b.at >= t) break;
    if (b.run) b.run(w);
    if (b.typing) w.draft.text = b.typing;
  }
  return w;
}
