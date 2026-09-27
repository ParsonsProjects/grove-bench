// Content for the Grove Path prototype: lanes (branches), the three agents
// that walk them, and the copy for each stop. Facts only from DOCS / DESIGN.md.

import { models } from '../shared/brand.js';
import { C, mix, looks } from '../grove/palette.js';

// Lane colours match the Branches prototype: feat/auth primary blue,
// feat/api teal, fix/login-bug tree green. `text` is a lighter tint for
// labels on dark panels.
export const LANES = {
  main: { key: 'main', name: 'main', colour: '#bdbdbd', text: '#e2e2e2' },
  auth: { key: 'auth', name: 'feat/auth', colour: C.primary, text: '#8fb8ff' },
  api: { key: 'api', name: 'feat/api', colour: '#00a9b3', text: '#6fdde3' },
  fix: { key: 'fix', name: 'fix/login-bug', colour: '#6ec87a', text: '#9be2a5' },
};

export const BRANCH_KEYS = ['auth', 'api', 'fix'];

/** Sets --lane / --lane-text for a chip. */
export const laneStyle = (key) => `--lane: ${LANES[key].colour}; --lane-text: ${LANES[key].text};`;

// Hoodies take the lane colour so each agent reads as its branch.
export const AGENTS = [
  {
    key: 'auth',
    id: 'a3f8b2c1',
    model: models.opus.label,
    look: { ...looks[0], hoodie: LANES.auth.colour },
    task: 'Adding JWT auth to the API routes.',
    // Tool calls shown while it works at its bench (Terminals).
    work: [
      { tool: 'Read', detail: 'routes/index.ts' },
      { tool: 'Edit', detail: 'auth.ts +47' },
      { term: '$ npm test', out: '4 passed' },
    ],
  },
  {
    key: 'api',
    id: '7c19e0d4',
    model: models.sonnet.label,
    look: { ...looks[1], hoodie: LANES.api.colour, hair: mix(C.woodDark, '#111111', 0.7) },
    task: 'Building the user profile endpoints.',
    work: [
      { tool: 'Write', detail: 'types.ts +24' },
      { tool: 'Edit', detail: 'profile.ts +89' },
      { term: '$ npm run dev', out: 'server running' },
    ],
    ask: 'npm install zod',
  },
  {
    key: 'fix',
    id: 'e52b9a73',
    model: models.haiku.label,
    look: { ...looks[2], hoodie: mix(LANES.fix.colour, '#2a5a32', 0.35) },
    task: 'Fixing users getting logged out after 5 minutes.',
    work: [
      { tool: 'Read', detail: 'session.ts' },
      { tool: 'Edit', detail: 'session.ts +12 -4' },
      { term: '$ npm test', out: '5 passed' },
    ],
  },
];

// The fix/login-bug conversation, one checkpoint per message you sent.
export const TURNS = [
  { you: 'Users get logged out after 5 min', did: 'Read session.ts' },
  { you: 'Refresh the token earlier', did: 'Edit session.ts +12 -4' },
  { you: 'Add a test for it', did: 'Write session.test.ts +38' },
  { you: 'Run the tests', did: 'Bash npm test, 5 passed' },
];

export const MEMORY_FOLDERS = ['repo/', 'conventions/', 'architecture/', 'sessions/'];

export const PERMISSION_RESULT = {
  allow: 'Allowed once. The agent runs it and carries on.',
  always: 'Allowed. It will not ask again for Bash in this conversation.',
  deny: 'Denied. The agent finds another way round.',
};

export const STEPS = [
  {
    hash: '1c9a7e4',
    title: 'Add a project',
    text: 'Click + Project and pick a folder that uses git.',
    ui: ['+ Project'],
  },
  {
    hash: 'e7f3b20',
    title: 'Start conversations',
    text: 'Click + Conversation, pick New branch, Existing branch or Direct, and describe the task.',
    ui: ['+ Conversation'],
  },
  {
    hash: '94d6c1a',
    title: 'Review and ship',
    text: 'Read the diffs in the Changes tab, then open a PR or merge the branch your usual way.',
    ui: ['Changes', 'Create PR'],
  },
];
