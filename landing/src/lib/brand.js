// Shared brand data for the landing page.

// Pixel tree sprite (same data as App.svelte and the app TitleBar).
// Each cell is 2x2 on a 21x24 grid.
export const treeGreens = [
  { x: 9, y: 0, fill: '#6ec87a' },
  { x: 6, y: 3, fill: '#5ab868' },
  { x: 9, y: 3, fill: '#5ab868' },
  { x: 12, y: 3, fill: '#5ab868' },
  { x: 3, y: 6, fill: '#4aaa58' },
  { x: 6, y: 6, fill: '#4aaa58' },
  { x: 9, y: 6, fill: '#4aaa58' },
  { x: 12, y: 6, fill: '#4aaa58' },
  { x: 15, y: 6, fill: '#4aaa58' },
  { x: 0, y: 9, fill: '#3a9a48' },
  { x: 3, y: 9, fill: '#3a9a48' },
  { x: 6, y: 9, fill: '#3a9a48' },
  { x: 9, y: 9, fill: '#3a9a48' },
  { x: 12, y: 9, fill: '#3a9a48' },
  { x: 15, y: 9, fill: '#3a9a48' },
  { x: 18, y: 9, fill: '#3a9a48' },
  { x: 3, y: 12, fill: '#3a9a48' },
  { x: 6, y: 12, fill: '#3a9a48' },
  { x: 9, y: 12, fill: '#3a9a48' },
  { x: 12, y: 12, fill: '#3a9a48' },
  { x: 15, y: 12, fill: '#3a9a48' },
  { x: 9, y: 15, fill: '#8a6a4a' },
  { x: 9, y: 18, fill: '#8a6a4a' },
  { x: 6, y: 21, fill: '#6a5040' },
  { x: 9, y: 21, fill: '#6a5040' },
  { x: 12, y: 21, fill: '#6a5040' },
];

export const links = {
  github: 'https://github.com/ParsonsProjects/grove-bench',
  releases: 'https://github.com/ParsonsProjects/grove-bench/releases',
  contributing: 'https://github.com/ParsonsProjects/grove-bench/blob/main/CONTRIBUTING.md',
  license: 'https://github.com/ParsonsProjects/grove-bench/blob/main/LICENSE',
  issues: 'https://github.com/ParsonsProjects/grove-bench/issues',
};

// Conversation status colours, matching docs/help/session-states.md.
export const statusColors = {
  ready: '#22c55e', // green, idle and waiting for input
  working: 'oklch(0.541 0.181 254.624)', // pulsing blue (primary)
  permission: '#f59e0b', // pulsing amber, waiting for approval
  error: '#ef4444',
  stopped: '#737373',
};

// Model labels as the app shows them (src/main/adapters/claude-code.ts).
export const models = {
  opus: { label: 'Opus 5.5', contextWindow: 1_000_000 },
  sonnet: { label: 'Sonnet 4.6', contextWindow: 1_000_000 },
  haiku: { label: 'Haiku 4.5', contextWindow: 200_000 },
};
