// The moment the hero screenshot shows: four conversations on one project,
// one of them waiting for permission. Shapes match shared/app/Window.svelte.

const COLOR = '#6ec87a';

const diff = (lines) => ({ add: lines.filter((l) => l[0] === '+').length, del: lines.filter((l) => l[0] === '-').length });
const file = (path, status, lines) => ({ path, status, diff: lines, ...diff(lines) });

const SESSION_TS = file('src/auth/session.ts', 'M', [
  '@@ -12,7 +12,8 @@ export function scheduleRefresh(session: Session) {',
  '-  const expiresIn = session.ttl * 60;',
  '+  // ttl is already in seconds.',
  '+  const expiresIn = session.ttl;',
  '   const refreshAt = expiresIn - 60;',
  '   timer = setTimeout(() => refresh(session), refreshAt * 1000);',
  ' }',
]);
const AUTH_TS = file('src/middleware/auth.ts', 'A', [
  '@@ -0,0 +1,9 @@',
  "+import jwt from 'jsonwebtoken';",
  '+',
  '+export function requireAuth(req, res, next) {',
  "+  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');",
  "+  if (!token) return res.status(401).json({ error: 'Missing token' });",
  '+  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }',
  "+  catch { res.status(401).json({ error: 'Invalid token' }); }",
  '+}',
]);
const SEARCH_TS = file('src/search/search.ts', 'A', [
  '@@ -0,0 +1,5 @@',
  "+import Fuse from 'fuse.js';",
  '+',
  '+export function searchOrders(orders, query) {',
  "+  return new Fuse(orders, { keys: ['id', 'customer'] }).search(query);",
  '+}',
]);

const base = { project: 'acme-shop', projectColor: COLOR, pr: null, scene: null, run: 0 };

export function heroWorld() {
  return {
    project: 'acme-shop',
    projectColor: COLOR,
    selected: 'e52b9a73',
    tab: 'thread',
    file: 0,
    checkpoint: -1,
    draft: null,
    convs: [
      {
        ...base,
        id: 'a3f8b2c1',
        name: 'feat/API-142-jwt-auth',
        state: 'working',
        line: 'Bash: npm test',
        lineTone: 'blue',
        age: '2m ago',
        model: 'Opus 5.5',
        mode: 'Auto',
        context: 41,
        ahead: 2,
        items: [
          { kind: 'you', text: 'Add JWT auth to the API routes (API-142)' },
          { kind: 'tool', tool: 'Write', detail: AUTH_TS.path, add: AUTH_TS.add },
          { kind: 'bash', cmd: 'npm test', running: true },
        ],
        files: [AUTH_TS],
        checkpoints: [{ turn: 1, text: 'Add JWT auth to the API routes (API-142)', add: AUTH_TS.add, del: 0, files: 1, age: '6m ago' }],
      },
      {
        ...base,
        id: 'e52b9a73',
        name: 'fix/BUG-77-early-logout',
        state: 'permission',
        line: 'Wants to run a command',
        lineTone: 'amber',
        age: '4m ago',
        model: 'Sonnet 4.6',
        mode: 'Ask',
        context: 26,
        ahead: 1,
        items: [
          { kind: 'you', text: 'Users get logged out after 5 minutes (BUG-77)' },
          { kind: 'text', text: 'Found it: the session lifetime is already in seconds, but one place multiplies it by 60 again.' },
          { kind: 'perm', tool: 'Edit', detail: SESSION_TS.path, resolved: 'allowed' },
          { kind: 'tool', tool: 'Edit', detail: SESSION_TS.path, add: SESSION_TS.add, del: SESSION_TS.del },
          { kind: 'perm', tool: 'Bash', detail: 'npm test', resolved: null },
        ],
        files: [SESSION_TS],
        checkpoints: [{ turn: 1, text: 'Users get logged out after 5 minutes (BUG-77)', add: SESSION_TS.add, del: SESSION_TS.del, files: 1, age: '4m ago' }],
      },
      {
        ...base,
        id: '1d6f4c08',
        name: 'feat/UI-31-dashboard-search',
        state: 'unread',
        line: 'Search is on the dashboard. 9 tests passed.',
        lineTone: 'muted',
        age: '9m ago',
        model: 'Opus 5.5',
        mode: 'Read-safe',
        context: 58,
        ahead: 3,
        items: [
          { kind: 'you', text: 'Add search to the dashboard (UI-31)' },
          { kind: 'tool', tool: 'Write', detail: SEARCH_TS.path, add: SEARCH_TS.add },
          { kind: 'perm', tool: 'Bash', detail: 'npm test', resolved: 'allowed' },
          { kind: 'bash', cmd: 'npm test', out: '9 passed' },
          { kind: 'text', text: 'Search is on the dashboard and matches as you type. 9 tests passed.' },
        ],
        files: [SEARCH_TS],
        checkpoints: [{ turn: 1, text: 'Add search to the dashboard (UI-31)', add: SEARCH_TS.add, del: 0, files: 1, age: '9m ago' }],
      },
      {
        ...base,
        id: '9b0e27f5',
        name: 'docs/DOC-9-readme-api',
        state: 'sleeping',
        line: 'The README covers the new endpoints.',
        lineTone: 'muted',
        age: '1h ago',
        model: 'Haiku 4.5',
        mode: 'Edit',
        context: 18,
        ahead: 1,
        items: [
          { kind: 'you', text: 'Update the README for the new API (DOC-9)' },
          { kind: 'text', text: 'The README covers the new endpoints, with an example header.' },
        ],
        files: [],
        checkpoints: [],
      },
    ],
  };
}
