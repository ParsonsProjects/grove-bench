// Content for the Canopy prototype: one project, three conversations, and the
// copy for each section. The conversations reuse the Night Grove data so the
// ids, models and tool calls match across prototypes.

import { STARTING_AGENTS } from '../grove/agents.js';
import { links } from '../shared/brand.js';

/** Lane colours, from the Branches prototype (lanes.js). */
export const LANES = {
  main: { name: 'main', stroke: '#c8c8c8', text: '#e2e2e2' },
  auth: { name: 'feat/auth', stroke: 'oklch(0.62 0.17 254.6)', text: 'oklch(0.78 0.12 254.6)', hex: '#3b82f6' },
  api: { name: 'feat/api', stroke: 'oklch(0.68 0.13 200)', text: 'oklch(0.82 0.11 200)', hex: '#14b8c4' },
  fix: { name: 'fix/login-bug', stroke: '#6ec87a', text: '#9fe0a8', hex: '#6ec87a' },
};

/** Which lane each conversation lives on, in the order of STARTING_AGENTS. */
export const LANE_KEYS = ['auth', 'api', 'fix'];

export const AGENTS = STARTING_AGENTS.map((a, i) => ({ ...a, lane: LANE_KEYS[i] }));

/** The fix/login-bug conversation: one checkpoint per message you sent. */
export const CHECKPOINTS = AGENTS[2].history;

export const MEMORY_FOLDERS = ['repo/', 'conventions/', 'architecture/', 'sessions/'];

/** Section headers, drawn as commits. */
export const COMMITS = {
  worktrees: { hash: '9fceb02', lane: 'main', title: 'Worktrees' },
  terminals: { hash: '3e7a1d9', lane: 'auth', title: 'Terminals' },
  permissions: { hash: '6f1c3b8', lane: 'api', title: 'Permissions' },
  checkpoints: { hash: '8c4f0b2', lane: 'fix', title: 'Checkpoints' },
  memory: { hash: '2d9e6a5', lane: 'main', title: 'Project memory' },
  review: { hash: '0a7d4e3', lane: 'main', title: 'Review and ship', head: true },
};

export const STEPS = [
  { ui: '+ Project', title: 'Add a project', text: 'Pick a folder that uses git.' },
  {
    ui: '+ Conversation',
    title: 'Start conversations',
    text: 'Choose New branch, Existing branch or Direct, then describe the task. Start as many as you like.',
  },
  {
    ui: 'Changes',
    title: 'Review and ship',
    text: 'Read the diffs, rewind a turn if needed, then open a PR from the app or merge your usual way.',
  },
];

export const FOOTER_LINKS = [
  { label: 'GitHub', href: links.github },
  { label: 'Releases', href: links.releases },
  { label: 'Contributing', href: links.contributing },
  { label: 'License', href: links.license },
  { label: 'Issues', href: links.issues },
];

/** Colour for a tool name in a speech bubble. */
export const TOOL_TONE = { Read: 'read', Edit: 'edit', Write: 'write', Bash: 'bash', Grep: 'read', Glob: 'read' };
