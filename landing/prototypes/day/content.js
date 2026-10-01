// Copy for the day-into-night pages. Facts follow README.md, docs/help and the
// app source; anything that isn't settled is marked as a draft.

import { links } from '../../src/lib/brand.js';

export const DOCS = 'https://github.com/ParsonsProjects/grove-bench/tree/main/docs/help';
export const README = 'https://github.com/ParsonsProjects/grove-bench#readme';
export { links };

export const CHIPS = ['worktrees', 'terminals', 'permissions', 'checkpoints', 'project memory'];

export const FOUNDER = {
  title: ['for the developer with', 'more ideas than hands.'],
  draft: true,
  paragraphs: [
    'I wanted to hand out more than one task at a time. Running AI agents one after another meant a lot of waiting. Running them side by side in the same folder meant they edited the same files and broke each other’s tests.',
    'Git already had the fix: worktrees. A separate copy of the project for each task, on its own branch. Grove Bench gives every conversation one, with its own terminal, so you can start three tasks, step away, and review each one on its own.',
    'The little characters are there so you never have to wonder. One look at the sidebar says who’s working, who needs you and who’s done.',
    'It’s free and source-available. I hope it gives you back some of the time it gave me.',
  ],
  name: 'Alan',
};

export const FEATURES = [
  {
    key: 'worktrees',
    tone: 'green',
    title: 'a branch for every agent.',
    text: 'Each conversation gets its own git worktree, branch and terminal. Your checkout stays as it is.',
  },
  {
    key: 'permissions',
    tone: 'amber',
    title: 'it asks before it acts.',
    text: 'Pick a mode per conversation: Ask, Plan, Edit, Auto or Read-safe. Anything outside it waits for you.',
  },
  {
    key: 'status',
    tone: 'blue',
    title: 'status at a glance.',
    text: 'Typing means working. An amber question mark means it needs you. A wave means it finished.',
  },
  {
    key: 'checkpoints',
    tone: 'pink',
    title: 'every message is a checkpoint.',
    text: 'Went the wrong way? Rewind the files and the conversation to before any message you sent.',
  },
  {
    key: 'sleep',
    tone: 'lilac',
    title: 'naps when idle.',
    text: 'After 30 idle minutes a conversation’s agent sleeps to save memory and CPU, then wakes where it left off.',
  },
  {
    key: 'context',
    tone: 'mint',
    title: 'watch the context fill.',
    text: 'A strip of grove grows along the status bar as the context window fills, and thins out after /compact.',
  },
];

export const STEPS = [
  { ui: '+ Project', title: 'add a project.', text: 'Pick a folder on your computer, ideally a git repository.' },
  {
    ui: '+ Conversation',
    title: 'hand out tasks.',
    text: 'Describe what you want. It starts on a new branch in its own worktree. Start another whenever you like.',
  },
  {
    ui: 'Create PR',
    title: 'review and ship.',
    text: 'Read the diff in the Changes tab, then open a pull request, or merge the branch your usual way.',
  },
];

export const INCLUDED = [
  'several conversations at once, each in its own worktree',
  'a real terminal for every conversation',
  'permission modes, checkpoints and rewind',
  'project memory shared across conversations',
  'updates that download in the background',
];

export const FAQ = [
  {
    q: 'Is it really free?',
    a: 'Yes. Grove Bench is free and source-available under FSL-1.1-MIT. You only pay for the AI: your Claude plan, or API usage billed by Anthropic.',
  },
  {
    q: 'What do I need?',
    a: 'Windows 10 or later, git 2.17 or later, and either a Claude plan (Pro, Max, Team or Enterprise) with Claude Code installed and signed in, or an Anthropic API key.',
  },
  { q: 'Does it run on Mac or Linux?', a: 'Not yet. The first version is Windows only.' },
  {
    q: 'Will the agents overwrite each other’s work?',
    a: 'No. In a git project each conversation works in its own worktree, on its own branch. Branches that change the same lines can still conflict when you merge them, as with any branches.',
  },
  {
    q: 'Do I have to name the branches?',
    a: 'No. A new branch starts as grove/ plus an id, and is renamed from your message after the first reply. Put a ticket ID in your message and it’s included.',
  },
  {
    q: 'Can an agent run commands without asking?',
    a: 'Only if you let it. In Ask mode it checks before each edit or command. Edit lets file edits through, Auto lets Claude’s classifier decide, and Read-safe lets edits and read-only commands through.',
  },
  {
    q: 'Where is my API key kept?',
    a: 'Encrypted on your computer. If you use a Claude plan instead, Grove Bench never sees your sign-in: Claude Code reads it itself.',
  },
  {
    q: 'Does it send my code anywhere?',
    a: 'Grove Bench doesn’t. Anonymous usage data is off unless you agree to it and never includes code, and crash reports never include prompts, code or project paths. Your agent talks to Anthropic as it always does.',
  },
  {
    q: 'Why does Windows warn me when I install it?',
    a: 'The installer isn’t code signed yet, so SmartScreen shows “Windows protected your PC”. Choose More info, then Run anyway.',
  },
  { q: 'Can I turn the characters off?', a: 'Yes: Settings → The grove → Show grove characters.' },
];

export const FOOTER = [
  { label: 'download', href: links.releases, tone: 'green' },
  { label: 'github', href: links.github, tone: 'blue' },
  { label: 'help pages', href: DOCS, tone: 'amber' },
  { label: 'contributing', href: links.contributing, tone: 'pink' },
  { label: 'license', href: links.license, tone: 'lilac' },
];
