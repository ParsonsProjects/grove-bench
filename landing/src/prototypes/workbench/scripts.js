// Scripted conversations for the Workbench hero simulation.
//
// Each preset is one task a visitor can start. `steps` is played in order by
// the engine in sim.svelte.js. Step types:
//   user  { text }                          a message from you (starts a turn)
//   say   { text }                          assistant text, streamed
//   read  { file, lines }                   Read tool
//   edit  { file, add, del, diff, isNew }   Edit or Write tool (makes a commit dot)
//   bash  { cmd, out: [{ text, ok }], summary }
//   perm  { tool, file | cmd, diff, then, onDeny }   waits for Allow / Deny
//   done  { text }                          final assistant text, then Ready

/** @typedef {['+' | '-' | ' ', string]} DiffLine */

const add = (text) => /** @type {DiffLine} */ (['+', text]);
const del = (text) => /** @type {DiffLine} */ (['-', text]);

export const PRESETS = [
  {
    id: 'jwt',
    label: 'Add JWT auth',
    branch: 'feat/jwt-auth',
    model: 'opus',
    steps: [
      { t: 'user', text: 'Add JWT auth middleware to the API routes' },
      { t: 'say', text: "I'll check how the routes are wired up first." },
      { t: 'read', file: 'src/routes/index.ts', lines: 42 },
      {
        t: 'edit',
        file: 'src/middleware/auth.ts',
        isNew: true,
        add: 38,
        del: 0,
        diff: [
          add("import jwt from 'jsonwebtoken'"),
          add('export function requireAuth(req, res, next) {'),
          add('  const token = bearer(req)'),
        ],
      },
      {
        t: 'edit',
        file: 'src/routes/index.ts',
        add: 2,
        del: 1,
        diff: [del("app.use('/api', api)"), add("import { requireAuth } from './auth'"), add("app.use('/api', requireAuth, api)")],
      },
      { t: 'say', text: 'Done. Every /api route now checks for a valid token.' },
      { t: 'user', text: 'Tokens expire too fast. Refresh them before they run out.' },
      { t: 'say', text: "I'll raise the expiry and add a refresh buffer." },
      {
        t: 'perm',
        tool: 'Edit',
        file: 'src/middleware/auth.ts',
        diff: [del('const TOKEN_EXPIRY = 300'), add('const TOKEN_EXPIRY = 3600'), add('const REFRESH_BUFFER = 30')],
        then: {
          t: 'edit',
          file: 'src/middleware/auth.ts',
          add: 2,
          del: 1,
          diff: [del('const TOKEN_EXPIRY = 300'), add('const TOKEN_EXPIRY = 3600'), add('const REFRESH_BUFFER = 30')],
        },
        onDeny: [
          { t: 'say', text: "OK, I'll leave auth.ts alone and put the refresh logic in its own file." },
          {
            t: 'edit',
            file: 'src/middleware/refresh.ts',
            isNew: true,
            add: 21,
            del: 0,
            diff: [add('export const REFRESH_BUFFER = 30'), add('export function needsRefresh(exp) {'), add('  return exp - now() < REFRESH_BUFFER')],
          },
        ],
      },
      { t: 'say', text: 'Tokens now refresh 30 seconds before they expire.' },
      { t: 'user', text: 'Run the tests' },
      {
        t: 'bash',
        cmd: 'npm test',
        out: [
          { text: 'accepts a valid token', ok: true },
          { text: 'rejects an expired token', ok: true },
          { text: 'refreshes before expiry', ok: true },
          { text: 'returns 401 without a header', ok: true },
        ],
        summary: 'Tests: 4 passed, 4 total',
      },
      { t: 'done', text: 'All green. Ready when you are.' },
    ],
  },
  {
    id: 'profile',
    label: 'Build profile API',
    branch: 'feat/profile-api',
    model: 'sonnet',
    steps: [
      { t: 'user', text: 'Build a REST API for user profiles' },
      { t: 'say', text: "I'll add the routes and a schema, then wire them in." },
      { t: 'read', file: 'src/routes/index.ts', lines: 42 },
      {
        t: 'edit',
        file: 'src/routes/profile.ts',
        isNew: true,
        add: 64,
        del: 0,
        diff: [add("router.get('/profile/:id', getProfile)"), add("router.put('/profile/:id', saveProfile)"), add("router.delete('/profile/:id', dropProfile)")],
      },
      {
        t: 'edit',
        file: 'src/schemas/profile.ts',
        isNew: true,
        add: 18,
        del: 0,
        diff: [add('export const Profile = z.object({'), add('  name: z.string().min(1),'), add('  bio: z.string().max(280),')],
      },
      {
        t: 'edit',
        file: 'src/routes/index.ts',
        add: 1,
        del: 0,
        diff: [add("app.use('/api', profile)")],
      },
      { t: 'say', text: 'Profile routes are in: GET, PUT and DELETE, all validated.' },
      { t: 'user', text: 'Add tests for it' },
      {
        t: 'edit',
        file: 'src/routes/profile.test.ts',
        isNew: true,
        add: 46,
        del: 0,
        diff: [add("it('returns a profile', async () => {"), add("  const res = await get('/api/profile/1')"), add('  expect(res.status).toBe(200)')],
      },
      {
        t: 'bash',
        cmd: 'npm test -- profile',
        out: [
          { text: 'returns a profile', ok: true },
          { text: 'validates the body on PUT', ok: true },
          { text: 'returns 204 on DELETE', ok: true },
        ],
        summary: 'Tests: 3 passed, 3 total',
      },
      { t: 'done', text: 'Profile API is done, with tests.' },
    ],
  },
  {
    id: 'timeout',
    label: 'Fix login timeout',
    branch: 'fix/login-timeout',
    model: 'haiku',
    steps: [
      { t: 'user', text: 'Users get logged out after 5 minutes. Fix it.' },
      { t: 'say', text: 'Checking the session config.' },
      { t: 'read', file: 'src/auth/session.ts', lines: 57 },
      { t: 'say', text: 'Found it. The session TTL is 300 seconds and nothing extends it.' },
      {
        t: 'perm',
        tool: 'Edit',
        file: 'src/auth/session.ts',
        diff: [del('  ttl: 300,'), add('  ttl: 60 * 60,'), add('  rolling: true,')],
        then: {
          t: 'edit',
          file: 'src/auth/session.ts',
          add: 2,
          del: 1,
          diff: [del('  ttl: 300,'), add('  ttl: 60 * 60,'), add('  rolling: true,')],
        },
        onDeny: [
          { t: 'say', text: "Understood. I'll keep the TTL and extend the session on each request instead." },
          {
            t: 'edit',
            file: 'src/middleware/session.ts',
            isNew: true,
            add: 6,
            del: 0,
            diff: [add('app.use((req, res, next) => {'), add('  req.session.touch()'), add('  next()')],
          },
        ],
      },
      { t: 'user', text: 'Check it with the tests' },
      {
        t: 'bash',
        cmd: 'npm test -- session',
        out: [
          { text: 'keeps active users signed in', ok: true },
          { text: 'still expires idle sessions', ok: true },
        ],
        summary: 'Tests: 2 passed, 2 total',
      },
      { t: 'done', text: 'Fixed. Active users stay signed in now.' },
    ],
  },
  {
    id: 'tests',
    label: 'Write auth tests',
    branch: 'test/auth',
    model: 'sonnet',
    steps: [
      { t: 'user', text: 'Write tests for the login flow' },
      { t: 'say', text: "I'll read the login handler, then cover the main paths." },
      { t: 'read', file: 'src/auth/login.ts', lines: 88 },
      {
        t: 'perm',
        tool: 'Bash',
        cmd: 'npm install -D supertest',
        then: {
          t: 'bash',
          cmd: 'npm install -D supertest',
          out: [{ text: 'added 1 package in 2s', ok: false }],
          summary: null,
        },
        onDeny: [{ t: 'say', text: "No problem. I'll call the handler directly, no new packages." }],
      },
      {
        t: 'edit',
        file: 'tests/auth/login.test.ts',
        isNew: true,
        add: 52,
        del: 0,
        diff: [add("describe('login', () => {"), add("  it('accepts a valid password')"), add("  it('rejects a wrong password')")],
      },
      {
        t: 'bash',
        cmd: 'npm test -- login',
        out: [
          { text: 'accepts a valid password', ok: true },
          { text: 'rejects a wrong password', ok: true },
          { text: 'slows down repeated tries', ok: true },
        ],
        summary: 'Tests: 3 passed, 3 total',
      },
      { t: 'user', text: 'Cover logout too' },
      {
        t: 'edit',
        file: 'tests/auth/login.test.ts',
        add: 14,
        del: 0,
        diff: [add("it('clears the session on logout', async () => {"), add("  await post('/logout')"), add('  expect(session()).toBeNull()')],
      },
      {
        t: 'bash',
        cmd: 'npm test -- login',
        out: [{ text: 'clears the session on logout', ok: true }],
        summary: 'Tests: 4 passed, 4 total',
      },
      { t: 'done', text: 'Login and logout are covered.' },
    ],
  },
  {
    id: 'dark',
    label: 'Add dark mode',
    branch: 'feat/dark-mode',
    model: 'opus',
    steps: [
      { t: 'user', text: 'Add a dark mode toggle to settings' },
      { t: 'say', text: "I'll add a theme store and a toggle on the settings page." },
      { t: 'read', file: 'src/pages/Settings.svelte', lines: 120 },
      {
        t: 'edit',
        file: 'src/lib/theme.ts',
        isNew: true,
        add: 20,
        del: 0,
        diff: [add("export const theme = writable('light')"), add('export function toggleTheme() {'), add("  theme.update((t) => (t === 'dark' ? 'light' : 'dark'))")],
      },
      {
        t: 'edit',
        file: 'src/pages/Settings.svelte',
        add: 9,
        del: 1,
        diff: [del('<h2>Appearance</h2>'), add('<h2>Appearance</h2>'), add('<Toggle on={dark} onchange={toggleTheme} />')],
      },
      { t: 'user', text: 'Remember the choice between visits' },
      {
        t: 'edit',
        file: 'src/lib/theme.ts',
        add: 2,
        del: 1,
        diff: [del("export const theme = writable('light')"), add("const saved = localStorage.getItem('theme')"), add("export const theme = writable(saved ?? 'light')")],
      },
      { t: 'done', text: 'Dark mode is in, and it sticks between visits.' },
    ],
  },
  {
    id: 'readme',
    label: 'Update README',
    branch: 'docs/readme',
    model: 'haiku',
    steps: [
      { t: 'user', text: 'Document the auth setup in the README' },
      { t: 'read', file: 'README.md', lines: 64 },
      {
        t: 'edit',
        file: 'README.md',
        add: 18,
        del: 2,
        diff: [del('## Setup'), add('## Setup and auth'), add('Set JWT_SECRET in .env before you start.')],
      },
      { t: 'done', text: 'README now has an auth section.' },
    ],
  },
];

// 8 character worktree ids, as in <project>/.grove-wt/<id>/.
export const WORKTREE_IDS = ['a3f8b2c1', '7c1e94d0', 'e52b0f7a', '19d4c6be', '0b7fa3e2', 'c84e1d59', '5e3a90cf', 'd21f6b84'];

// One colour per graph lane. Derived from the brand: primary blue, tree
// green, the teal end of the hero gradient and a lightened trunk brown.
export const LANE_COLORS = ['oklch(0.66 0.16 254.6)', '#5ab868', 'oklch(0.72 0.12 200)', '#c09a6c'];
