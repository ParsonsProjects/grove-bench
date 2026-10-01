// The cast: one entry per character state, with what it means in the app.
// Wording follows docs/help/session-states.md and docs/help/settings.md.

export const CAST = [
  {
    state: 'working',
    title: 'The typist',
    pose: 'Types on the laptop, one hand and then the other.',
    when: 'The agent is working: reading files, running tools or writing a reply.',
    todo: 'Nothing. Watch the Thread tab if you like.',
    where: 'Sidebar, rail, and the bench while the first reply comes in',
  },
  {
    state: 'permission',
    title: 'The asker',
    pose: 'Sits still with a pulsing question mark.',
    when: 'The agent wants to edit a file or run a command, or has a question, and is waiting for you.',
    todo: 'Open the conversation and answer in the Thread tab.',
    where: 'Sidebar, rail, and the permission prompt itself',
  },
  {
    state: 'unread',
    title: 'The waver',
    pose: 'Right arm up, hand rocking side to side.',
    when: 'The agent finished a turn while you were in another conversation.',
    todo: 'Open it to see what it did.',
    where: 'Sidebar and rail',
  },
  {
    state: 'ready',
    title: 'The sitter',
    pose: 'Sits with the laptop open. No symbol.',
    when: 'The conversation is open and idle, waiting for your next message.',
    todo: 'Send it the next task.',
    where: 'Sidebar, rail, and the bench when no conversation is open',
  },
  {
    state: 'starting',
    title: 'The walker',
    pose: 'No laptop yet. Walks in, legs apart and then together.',
    when: 'The conversation is starting up or installing dependencies. While it starts, its agent walks through the grove.',
    todo: 'Wait a moment. It sits down and starts typing when it is ready.',
    where: 'Sidebar, and the grove walk in the main area',
  },
  {
    state: 'sleeping',
    title: 'The napper',
    pose: 'Asleep over a closed laptop.',
    when: 'Idle for a while (30 minutes by default), so its agent was shut down to save memory and CPU. Its terminal keeps running.',
    todo: 'Open it or send a message. It wakes on a bench and carries on where it left off.',
    where: 'Sidebar and rail',
  },
  {
    state: 'stopped',
    title: 'Lights out',
    pose: 'Asleep, the same pose as sleeping.',
    when: 'You stopped it. Its agent, background commands and terminal have shut down, dev servers included.',
    todo: 'Send a new message to start it again.',
    where: 'Sidebar, under Projects',
  },
  {
    state: 'error',
    title: 'The startled',
    pose: 'Sits with an exclamation mark.',
    when: 'Something went wrong.',
    todo: 'Check the Thread tab for details. You may need to restart the conversation.',
    where: 'Sidebar and rail',
  },
  {
    state: 'asking',
    title: 'The curious one',
    pose: 'A pulsing question mark, in the question block’s cyan.',
    when: 'The agent asked you a question. In the sidebar it shows as Waiting for you.',
    todo: 'Pick an answer, or type your own.',
    where: 'Question prompts',
  },
  {
    state: 'answered',
    title: 'The listener',
    pose: 'Sits still with a speech bubble.',
    when: 'A question you have answered.',
    todo: 'Nothing. It shows the question was answered.',
    where: 'Question prompts',
  },
  {
    state: 'allowed',
    title: 'Thumbs up',
    pose: 'Sits still with a tick.',
    when: 'A permission prompt you allowed.',
    todo: 'Nothing. It shows what you chose.',
    where: 'Permission prompts',
  },
  {
    state: 'denied',
    title: 'Not today',
    pose: 'Sits still with a cross.',
    when: 'A permission prompt you denied.',
    todo: 'Nothing. It shows what you chose.',
    where: 'Permission prompts',
  },
];

/** Response styles (Settings → Grovekeepers → All agents). The replies are examples. */
export const VOICES = [
  {
    key: 'normal',
    label: 'Normal',
    note: 'The agent’s usual wording.',
    say: 'I’ve added rate limiting to the login route. It now allows five attempts a minute per IP address, and all 8 tests pass.',
  },
  {
    key: 'lite',
    label: 'Caveman lite',
    note: 'Drops filler and hedging.',
    say: 'Added rate limiting to the login route: five attempts a minute per IP address. All 8 tests pass.',
  },
  {
    key: 'full',
    label: 'Caveman full',
    note: 'Also drops articles.',
    say: 'Added rate limit to login route. Five attempts per minute per IP. All 8 tests pass.',
  },
  {
    key: 'ultra',
    label: 'Caveman ultra',
    note: 'Compresses the most, with abbreviations.',
    say: 'Login rate limit added. 5/min/IP. 8/8 tests pass.',
  },
];

/**
 * Models, with what the app offers on each (docs/help/status-bar.md and
 * src/main/adapters/claude-code.ts).
 */
export const MODELS = [
  { key: 'opus', label: 'Opus 5.5', context: '1M tokens', effort: 'Medium', fast: true, auto: true, ctx: 1 },
  { key: 'sonnet', label: 'Sonnet 4.6', context: '1M tokens', effort: 'High', fast: false, auto: true, ctx: 1 },
  { key: 'haiku', label: 'Haiku 4.5', context: '200K tokens', effort: 'None', fast: false, auto: false, ctx: 0.2 },
];

/** Permission modes, in the app's colours (docs/help/status-bar.md). */
export const MODES = [
  { key: 'ask', label: 'Ask', color: 'oklch(0.707 0.165 254.624)', help: 'Checks with you before each edit or command.' },
  { key: 'plan', label: 'Plan', color: 'oklch(0.852 0.199 91.936)', help: 'Explores and plans, without editing files.' },
  { key: 'edit', label: 'Edit', color: 'oklch(0.714 0.203 305.504)', help: 'Edits in the worktree go ahead; commands still ask.' },
  { key: 'auto', label: 'Auto', color: 'oklch(0.789 0.154 211.53)', help: 'Claude’s classifier approves or blocks each action.' },
  { key: 'readsafe', label: 'Read-safe', color: 'oklch(0.792 0.209 151.711)', help: 'Grove Bench’s own: edits and read-only commands go ahead, the rest asks.' },
];
