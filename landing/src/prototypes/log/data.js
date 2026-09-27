// Demo content: one project, three conversations. The agents, their ids,
// models and scripts come from the Night Grove data so both prototypes tell
// the same story.

import { STARTING_AGENTS } from '../grove/agents.js';

const [authDef, apiDef, fixDef] = STARTING_AGENTS;

/** @typedef {'auth' | 'api' | 'fix'} AgentKey */

export const agents = {
  auth: { ...authDef, key: 'auth', task: 'Adding JWT middleware to the API routes.' },
  api: { ...apiDef, key: 'api', task: 'Building the user profile endpoints.' },
  fix: { ...fixDef, key: 'fix', task: 'Fixing users getting logged out after 5 minutes.' },
};
export const agentKeys = /** @type {AgentKey[]} */ (['auth', 'api', 'fix']);

// Terminals: what each agent's own terminal is running.
export const terminals = {
  auth: { cmd: 'npm test', ticks: 4, result: '4 passed' },
  api: { cmd: 'npm run dev', ticks: 0, result: 'listening on :3000' },
  fix: { cmd: 'npm test', ticks: 5, result: '5 passed' },
};

// Tool calls shown in speech bubbles in the Terminals scene.
export const toolCalls = {
  auth: [
    ['Read', 'routes/index.ts'],
    ['Edit', 'auth.ts +47'],
    ['Bash', 'npm test'],
  ],
  api: [
    ['Write', 'profile.ts +89'],
    ['Bash', 'npm run dev'],
    ['Read', 'types.ts'],
  ],
  fix: [
    ['Read', 'session.ts'],
    ['Edit', 'session.ts +12 -4'],
    ['Bash', 'npm test'],
  ],
};

// Isolation: all three edit the same file, each in its own worktree.
export const sameFile = 'src/routes/index.ts';
export const sameFileEdits = {
  auth: '+8 -3',
  api: '+3 -1',
  fix: '+2',
};

// Permissions: what feat/api asks for, and what happens next.
export const ask = { tool: 'Bash', command: apiDef.ask };
export const afterAllow = apiDef.allowScript;
export const afterDeny = apiDef.denyScript;
export const denyLine = 'No zod then. I will check the input by hand.';

// Checkpoints: one per message sent in the fix/login-bug conversation.
export const turns = fixDef.history;

export const memoryFolders = ['repo/', 'conventions/', 'architecture/', 'sessions/'];

// Commit hashes for the log. Made up, but stable.
export const hashes = {
  hero: '4b825dc',
  worktrees: '9fceb02',
  terminals: 'a3f8b2c',
  isolation: '3e7a1d9',
  permission: '7c19e0d',
  checkpoints: 'e52b9a7',
  memory: '2d9e6a5',
  ship: '0a7d4e3',
  how: '5b2e8f1',
  cta: 'ea5c9d0',
};
