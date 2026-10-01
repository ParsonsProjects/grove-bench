// The prototypes, in the order the chooser lists them.

export const PROTOTYPES = [
  {
    slug: 'grovekeeper',
    name: 'Grovekeeper',
    pitch: 'A small game. Hand out tasks, answer the agents when they raise a hand, review their work and walk each branch to the main gate.',
    shows: 'The full loop: worktrees, modes, permissions, review and PRs',
    state: 'permission',
  },
  {
    slug: 'crew',
    name: 'Meet the crew',
    pitch: 'A character select screen for the grove. Every state has its own pose. Build your own agent, then scrub through a day in the grove.',
    shows: 'Conversation states, looks, models, sleeping and waking',
    state: 'unread',
  },
  {
    slug: 'pocket',
    name: 'Pocket grove',
    pitch: 'A handheld you can actually play. Check on your conversations, answer them, wake the sleepy ones and watch the context grove fill up.',
    shows: 'Status at a glance, notifications, sleep, compact',
    state: 'stopped',
  },
  {
    slug: 'race',
    name: 'Parallel race',
    pitch: 'The same tasks, three ways: one agent at a time, several agents in one folder, and Grove Bench. Press go and watch what happens.',
    shows: 'Why worktrees: no waiting, no collisions, clean branches',
    state: 'working',
  },
];
