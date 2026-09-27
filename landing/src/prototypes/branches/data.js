// Demo content for the Branches prototype. One project, three conversations.

export const agents = [
  {
    lane: 'auth',
    model: 'Opus 5.5',
    wt: '.grove-wt/a3f8b2c1',
    hash: 'a3f8b2c',
    offset: 0,
    lines: [
      { kind: 'you', text: 'Add JWT auth to the API routes' },
      { kind: 'tool', tool: 'Read', arg: 'src/routes/index.ts' },
      { kind: 'tool', tool: 'Edit', arg: 'src/middleware/auth.ts', add: 47, del: 0 },
      { kind: 'tool', tool: 'Edit', arg: 'src/routes/index.ts', add: 8, del: 3 },
      { kind: 'tool', tool: 'Bash', arg: 'npm test' },
      { kind: 'ok', text: '14 passed' },
      { kind: 'you', text: 'Refresh tokens before they expire' },
      { kind: 'tool', tool: 'Read', arg: 'src/auth/session.ts' },
      { kind: 'tool', tool: 'Edit', arg: 'src/middleware/auth.ts', add: 12, del: 4 },
      { kind: 'tool', tool: 'Bash', arg: 'npm test' },
      { kind: 'ok', text: '16 passed' },
    ],
  },
  {
    lane: 'api',
    model: 'Sonnet 4.6',
    wt: '.grove-wt/7c21e9d4',
    hash: '7c21e9d',
    offset: 2.3,
    lines: [
      { kind: 'you', text: 'Build the user profile endpoints' },
      { kind: 'tool', tool: 'Write', arg: 'src/routes/profile.ts', add: 89, del: 0 },
      { kind: 'tool', tool: 'Write', arg: 'src/types/profile.ts', add: 24, del: 0 },
      { kind: 'tool', tool: 'Edit', arg: 'src/routes/index.ts', add: 3, del: 1 },
      { kind: 'tool', tool: 'Bash', arg: 'npm test' },
      { kind: 'ok', text: '9 passed' },
      { kind: 'you', text: 'Validate the profile input' },
      { kind: 'tool', tool: 'Read', arg: 'src/types/profile.ts' },
      { kind: 'tool', tool: 'Edit', arg: 'src/routes/profile.ts', add: 18, del: 2 },
      { kind: 'tool', tool: 'Bash', arg: 'npm test' },
      { kind: 'ok', text: '12 passed' },
    ],
  },
  {
    lane: 'fix',
    model: 'Haiku 4.5',
    wt: '.grove-wt/e05b4f6a',
    hash: 'e05b4f6',
    offset: 4.1,
    lines: [
      { kind: 'you', text: 'Users get logged out after 5 min' },
      { kind: 'tool', tool: 'Read', arg: 'src/auth/session.ts' },
      { kind: 'tool', tool: 'Edit', arg: 'src/auth/session.ts', add: 12, del: 4 },
      { kind: 'tool', tool: 'Edit', arg: 'src/routes/index.ts', add: 2, del: 0 },
      { kind: 'tool', tool: 'Bash', arg: 'npm test' },
      { kind: 'ok', text: 'refreshes 30s before expiry' },
      { kind: 'you', text: 'Add a test for the refresh' },
      { kind: 'tool', tool: 'Write', arg: 'src/auth/session.test.ts', add: 21, del: 0 },
      { kind: 'tool', tool: 'Bash', arg: 'npm test' },
      { kind: 'ok', text: '5 passed' },
    ],
  },
];

// Checkpoints for the feat/auth conversation (one per message sent).
export const turns = [
  {
    msg: 'Add JWT auth to the API routes',
    files: [{ path: 'src/middleware/auth.ts', add: 47, del: 0 }],
    diff: [
      ['+', "import { verify } from 'jsonwebtoken'"],
      ['+', 'export function auth(req, res, next) {'],
      ['+', '  const token = req.headers.authorization'],
      ['+', '  if (!token) return res.sendStatus(401)'],
    ],
  },
  {
    msg: 'Use it on the protected routes',
    files: [{ path: 'src/routes/index.ts', add: 8, del: 3 }],
    diff: [
      [' ', 'const router = Router()'],
      ['+', 'router.use(auth)'],
      ['-', "router.get('/me', me)"],
      ['+', "router.get('/me', auth, me)"],
    ],
  },
  {
    msg: 'Add tests for expired tokens',
    files: [{ path: 'src/middleware/auth.test.ts', add: 32, del: 0 }],
    diff: [
      ['+', "it('rejects expired tokens', async () => {"],
      ['+', "  const res = await get('/me', expired)"],
      ['+', '  expect(res.status).toBe(401)'],
      ['+', '})'],
    ],
  },
  {
    msg: 'Refresh tokens before they expire',
    files: [
      { path: 'src/middleware/auth.ts', add: 12, del: 4 },
      { path: 'src/auth/session.ts', add: 6, del: 2 },
    ],
    diff: [
      ['-', 'const TOKEN_EXPIRY = 300'],
      ['+', 'const TOKEN_EXPIRY = 3600'],
      ['+', 'const REFRESH_BUFFER = 30'],
    ],
  },
  {
    msg: 'Rename auth to requireAuth',
    files: [
      { path: 'src/middleware/auth.ts', add: 3, del: 3 },
      { path: 'src/routes/index.ts', add: 2, del: 2 },
    ],
    diff: [
      ['-', 'export function auth(req, res, next) {'],
      ['+', 'export function requireAuth(req, res, next) {'],
    ],
  },
];

// What each branch brings back to main.
// Totals match the turns and cards above (6 distinct files across all three).
export const merges = [
  { lane: 'auth', hash: '5e1d0a7', files: 4, add: 110, del: 14 },
  { lane: 'api', hash: '9b3c2f4', files: 3, add: 116, del: 1 },
  { lane: 'fix', hash: 'd4e8a61', files: 2, add: 14, del: 4 },
];
export const mergedFiles = 6;
