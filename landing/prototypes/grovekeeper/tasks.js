// Tickets on the task board. Each has one or two turns (messages you send);
// a turn is a list of steps the agent takes.
//
// A step is { tool, detail, kind, out? }. `kind` decides whether the step
// needs your permission, and depends on the conversation's mode (see game.js):
//   read  reading or searching files, never asks
//   look  a read-only command (git status, git log), never asks
//   edit  a file edit or new file in the worktree
//   cmd   any other command
//   risky a command Auto mode's classifier blocks (piping a download to a shell)
// `alt` is what the agent does instead when you deny the step or Auto blocks it.

export const PROJECT = 'acme-shop';

/** @typedef {{ tool: string, detail: string, kind: 'read' | 'look' | 'edit' | 'cmd' | 'risky', out?: string, add?: number, del?: number, alt?: string }} Step */

export const TASKS = [
  {
    ticket: 'API-142',
    title: 'Add JWT auth to the API routes',
    branch: 'feat/API-142-jwt-auth',
    turns: [
      {
        you: 'API-142: add JWT auth to the API routes',
        steps: [
          { tool: 'Read', detail: 'src/routes/index.ts', kind: 'read' },
          { tool: 'Write', detail: 'src/middleware/auth.ts', kind: 'edit', add: 47 },
          { tool: 'Edit', detail: 'src/routes/index.ts', kind: 'edit', add: 8, del: 3 },
          { tool: 'Bash', detail: 'npm test', kind: 'cmd', out: '4 passed', alt: "Skipping the tests. Run npm test in the terminal when you're ready." },
        ],
        reply: 'The middleware is in place and every route checks the token. 4 tests passed.',
      },
      {
        you: 'Add a test for expired tokens',
        steps: [
          { tool: 'Write', detail: 'src/middleware/auth.test.ts', kind: 'edit', add: 31 },
          { tool: 'Bash', detail: 'npm test', kind: 'cmd', out: '6 passed', alt: 'Test written, not run.' },
        ],
        reply: 'Added a test for expired tokens. 6 tests passed.',
      },
    ],
  },
  {
    ticket: 'BUG-77',
    title: 'Users get logged out after 5 minutes',
    branch: 'fix/BUG-77-early-logout',
    turns: [
      {
        you: 'BUG-77: users get logged out after 5 minutes',
        steps: [
          { tool: 'Read', detail: 'src/auth/session.ts', kind: 'read' },
          { tool: 'Grep', detail: 'expiresIn', kind: 'read' },
          { tool: 'Edit', detail: 'src/auth/session.ts', kind: 'edit', add: 12, del: 4 },
          { tool: 'Bash', detail: 'npm test', kind: 'cmd', out: '5 passed', alt: 'Fix is in, tests not run.' },
        ],
        reply: 'The token now refreshes a minute before it expires. 5 tests passed.',
      },
      {
        you: 'Add a test for it',
        steps: [
          { tool: 'Write', detail: 'src/auth/session.test.ts', kind: 'edit', add: 38 },
          { tool: 'Bash', detail: 'npm test', kind: 'cmd', out: '6 passed', alt: 'Test written, not run.' },
        ],
        reply: 'Added a test that waits past the old limit. 6 tests passed.',
      },
    ],
  },
  {
    ticket: 'UI-31',
    title: 'Add search to the dashboard',
    branch: 'feat/UI-31-dashboard-search',
    turns: [
      {
        you: 'UI-31: add search to the dashboard',
        steps: [
          { tool: 'Read', detail: 'package.json', kind: 'read' },
          { tool: 'Bash', detail: 'npm install fuse.js', kind: 'cmd', out: 'added 1 package', alt: "No new package then. I'll write a simple filter instead." },
          { tool: 'Write', detail: 'src/search/search.ts', kind: 'edit', add: 64 },
          { tool: 'Edit', detail: 'src/pages/Dashboard.svelte', kind: 'edit', add: 18, del: 2 },
          { tool: 'Bash', detail: 'npm test', kind: 'cmd', out: '9 passed', alt: 'Search is wired up, tests not run.' },
        ],
        reply: 'Search is on the dashboard and matches as you type. 9 tests passed.',
      },
      {
        you: 'Highlight the matches',
        steps: [{ tool: 'Edit', detail: 'src/search/search.ts', kind: 'edit', add: 14, del: 3 }],
        reply: 'Matching text is highlighted now.',
      },
    ],
  },
  {
    ticket: 'DOC-9',
    title: 'Update the README for the new API',
    branch: 'docs/DOC-9-readme-api',
    turns: [
      {
        you: 'DOC-9: update the README for the new API',
        steps: [
          { tool: 'Read', detail: 'README.md', kind: 'read' },
          { tool: 'Glob', detail: 'docs/**/*.md', kind: 'read' },
          { tool: 'Bash', detail: 'git log --oneline -5', kind: 'look', out: '5 commits' },
          { tool: 'Edit', detail: 'README.md', kind: 'edit', add: 22, del: 5 },
        ],
        reply: 'The README covers the new endpoints, with an example request for each.',
      },
    ],
  },
  {
    ticket: 'PERF-4',
    title: 'Speed up the CI build',
    branch: 'ci/PERF-4-cache-deps',
    turns: [
      {
        you: 'PERF-4: speed up the CI build',
        steps: [
          { tool: 'Read', detail: '.github/workflows/ci.yml', kind: 'read' },
          {
            tool: 'Bash',
            detail: 'curl -fsSL https://get.buildcache.dev | sh',
            kind: 'risky',
            out: 'installed',
            alt: "I'll use the npm cache that CI already has instead.",
          },
          { tool: 'Edit', detail: '.github/workflows/ci.yml', kind: 'edit', add: 6, del: 2 },
          { tool: 'Bash', detail: 'npm run build', kind: 'cmd', out: 'built in 41s', alt: 'Workflow updated, build not run.' },
        ],
        reply: 'CI now caches node_modules between runs.',
      },
    ],
  },
  {
    ticket: 'UI-40',
    title: 'Add a dark mode toggle',
    branch: 'feat/UI-40-dark-mode',
    turns: [
      {
        you: 'UI-40: add a dark mode toggle',
        steps: [
          { tool: 'Read', detail: 'src/styles/theme.css', kind: 'read' },
          { tool: 'Edit', detail: 'src/styles/theme.css', kind: 'edit', add: 40 },
          { tool: 'Write', detail: 'src/components/ThemeToggle.svelte', kind: 'edit', add: 28 },
          { tool: 'Bash', detail: 'npm run check', kind: 'cmd', out: '0 errors', alt: 'Toggle added, checks not run.' },
        ],
        reply: 'There is a toggle in the header, and it remembers your choice.',
      },
      {
        you: 'Follow the system setting by default',
        steps: [{ tool: 'Edit', detail: 'src/components/ThemeToggle.svelte', kind: 'edit', add: 9, del: 2 }],
        reply: 'It follows the system setting until you pick one.',
      },
    ],
  },
  {
    ticket: 'BUG-81',
    title: 'Invoices show the wrong date',
    branch: 'fix/BUG-81-invoice-date',
    turns: [
      {
        you: 'BUG-81: invoices show the wrong date',
        steps: [
          { tool: 'Read', detail: 'src/invoices/format.ts', kind: 'read' },
          { tool: 'Bash', detail: 'git status', kind: 'look', out: 'clean' },
          { tool: 'Edit', detail: 'src/invoices/format.ts', kind: 'edit', add: 3, del: 3 },
          { tool: 'Write', detail: 'src/invoices/format.test.ts', kind: 'edit', add: 19 },
          { tool: 'Bash', detail: 'npm test', kind: 'cmd', out: '12 passed', alt: 'Fixed, tests not run.' },
        ],
        reply: 'Dates were formatted in UTC. They use the customer time zone now. 12 tests passed.',
      },
    ],
  },
  {
    ticket: 'API-150',
    title: 'Rate limit the login endpoint',
    branch: 'feat/API-150-login-rate-limit',
    turns: [
      {
        you: 'API-150: rate limit the login endpoint',
        steps: [
          { tool: 'Read', detail: 'src/routes/login.ts', kind: 'read' },
          { tool: 'Bash', detail: 'npm install express-rate-limit', kind: 'cmd', out: 'added 1 package', alt: "I'll count attempts in memory instead." },
          { tool: 'Edit', detail: 'src/routes/login.ts', kind: 'edit', add: 14, del: 1 },
          { tool: 'Bash', detail: 'npm test', kind: 'cmd', out: '8 passed', alt: 'Limit added, tests not run.' },
        ],
        reply: 'Login allows 5 tries a minute per address. 8 tests passed.',
      },
    ],
  },
];
