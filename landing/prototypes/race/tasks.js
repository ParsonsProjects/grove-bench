// Tasks for the race. Times are simulated minutes from the task's start.
// `op` is what a step does to the project: read a file, edit it, or run
// the tests.

export const TASKS = [
  {
    key: 'auth',
    title: 'Add JWT auth',
    branch: 'feat/auth',
    color: '#3b82f6',
    seed: 'a3f8b2c1',
    duration: 7,
    steps: [
      { at: 0, tool: 'Read', file: 'src/routes/index.ts', op: 'read' },
      { at: 1.5, tool: 'Write', file: 'src/middleware/auth.ts', op: 'edit' },
      { at: 3.5, tool: 'Edit', file: 'src/routes/index.ts', op: 'edit' },
      { at: 5.5, tool: 'Bash', file: 'npm test', op: 'test' },
    ],
  },
  {
    key: 'logout',
    title: 'Fix early logout',
    branch: 'fix/logout',
    color: '#6ec87a',
    seed: 'e52b9a73',
    duration: 5,
    steps: [
      { at: 0, tool: 'Read', file: 'src/routes/index.ts', op: 'read' },
      { at: 1, tool: 'Read', file: 'src/auth/session.ts', op: 'read' },
      { at: 2, tool: 'Edit', file: 'src/routes/index.ts', op: 'edit' },
      { at: 3.5, tool: 'Bash', file: 'npm test', op: 'test' },
    ],
  },
  {
    key: 'search',
    title: 'Add dashboard search',
    branch: 'feat/search',
    color: '#14b8c4',
    seed: '1d6f4c08',
    duration: 6,
    steps: [
      { at: 0, tool: 'Read', file: 'package.json', op: 'read' },
      { at: 1, tool: 'Edit', file: 'package.json', op: 'edit' },
      { at: 2.5, tool: 'Write', file: 'src/search/search.ts', op: 'edit' },
      { at: 4.5, tool: 'Bash', file: 'npm test', op: 'test' },
    ],
  },
  {
    key: 'limit',
    title: 'Rate limit login',
    branch: 'feat/rate-limit',
    color: '#a78bfa',
    seed: '7c19e0d4',
    duration: 5,
    steps: [
      { at: 0, tool: 'Read', file: 'package.json', op: 'read' },
      { at: 0.5, tool: 'Read', file: 'src/routes/index.ts', op: 'read' },
      { at: 1.5, tool: 'Edit', file: 'package.json', op: 'edit' },
      { at: 2.5, tool: 'Edit', file: 'src/routes/index.ts', op: 'edit' },
      { at: 3.5, tool: 'Bash', file: 'npm test', op: 'test' },
    ],
  },
  {
    key: 'docs',
    title: 'Update the README',
    branch: 'docs/readme',
    color: '#fb923c',
    seed: '9b0e27f5',
    duration: 3,
    steps: [
      { at: 0, tool: 'Read', file: 'README.md', op: 'read' },
      { at: 1.5, tool: 'Edit', file: 'README.md', op: 'edit' },
    ],
  },
];
