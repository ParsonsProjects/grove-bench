// Grovekeeper's rules. Plain data and functions, advanced by `tick(game, dt)`
// from the page's animation loop. Everything that would happen in the app is
// also written to `game.log`, in the app's own words.

import { TASKS } from './tasks.js';

/** Modes offered here. The app also has Plan and Read-safe. */
export const MODES = {
  ask: {
    label: 'Ask',
    help: 'Checks with you before each edit or command. Reading files and read-only commands run without asking.',
  },
  edit: {
    label: 'Edit',
    help: 'File edits in the worktree go ahead without asking. Commands still ask.',
  },
  auto: {
    label: 'Auto',
    help: "Claude's classifier approves or blocks each action instead of asking you. Risky ones, such as piping a download into a shell, are blocked.",
  },
};

/** Whether this step waits for you, in this mode, with these standing approvals. */
export function needsPermission(kind, mode, allowAllCommands) {
  if (mode === 'auto') return false;
  if (kind === 'edit') return mode === 'ask';
  if (kind === 'cmd' || kind === 'risky') return !allowAllCommands;
  return false;
}

/** The third button on a permission block, as the app labels it. */
export function allowAllLabel(step) {
  return step.kind === 'edit' ? 'Allow all edits (Edit mode)' : 'Allow all commands';
}

export const PLOTS = 4;
export const DAY_START = 9 * 60;
export const DAY_END = 17 * 60;
/** Game minutes per real second: a working day takes four minutes. */
export const MINUTES_PER_SECOND = 2;

const SPROUT_S = 1.1;
// The app's arrival: three seconds walking up to the bench, then sat for a
// moment before it types (src/renderer/lib/grove-walk.ts).
const WALK_S = 3;
const SIT_S = 0.6;
const STEP_S = 2.4;
const SHIP_S = 2.6;
/** Idle seconds before a conversation you are not looking at falls asleep. */
export const SLEEP_AFTER_S = 22;
const WAKE_S = 1.2;

let nextId = 0x1d6f4c08;
const newId = () => (nextId = (nextId * 1103515245 + 12345) >>> 0).toString(16).padStart(8, '0').slice(0, 8);

export function createGame() {
  return {
    clock: DAY_START,
    over: false,
    defaultMode: 'ask',
    board: TASKS.slice(0, 5),
    queue: TASKS.slice(5),
    /** @type {(ReturnType<typeof plant> | null)[]} */
    plots: Array(PLOTS).fill(null),
    selected: null,
    shipped: [],
    answered: 0,
    waited: 0,
    longestWait: 0,
    log: [{ t: DAY_START, text: 'A new day in acme-shop. Start a task to give it a tree of its own.' }],
  };
}

function log(game, text) {
  game.log.unshift({ t: game.clock, text });
  if (game.log.length > 40) game.log.length = 40;
}

/** Starts a conversation for this ticket in the first free plot. */
export function plant(game, ticket) {
  const slot = game.plots.findIndex((p) => p === null);
  if (slot < 0 || game.over) return null;
  const task = game.board.find((t) => t.ticket === ticket);
  if (!task) return null;
  game.board = game.board.filter((t) => t !== task);
  if (game.queue.length) game.board.push(game.queue.shift());
  const id = newId();
  const plot = {
    id,
    slot,
    task,
    branch: `grove/${id}`,
    renamed: false,
    mode: game.defaultMode,
    allowAll: false,
    phase: 'sprout',
    timer: 0,
    turn: 0,
    step: 0,
    items: [{ kind: 'you', text: task.turns[0].you }, { kind: 'checkpoint', turn: 1 }],
    pending: null,
    waiting: 0,
    idle: 0,
    unread: false,
    asleep: false,
    add: 0,
    del: 0,
    files: [],
    history: [],
  };
  game.plots[slot] = plot;
  log(game, `Started a conversation for ${task.ticket}. New branch grove/${id} and its own worktree, off main.`);
  return plot;
}

/** The character's state, using the app's sprite state names. */
export function spriteState(p) {
  if (p.phase === 'sprout') return null;
  if (p.phase === 'walk' || p.phase === 'ship') return 'starting';
  if (p.phase === 'sit') return 'ready';
  if (p.phase === 'wake') return p.timer < WAKE_S * 0.6 ? 'sleeping' : 'ready';
  if (p.asleep) return 'sleeping';
  if (p.pending) return 'permission';
  if (p.phase === 'work') return 'working';
  if (p.unread) return 'unread';
  return 'ready';
}

export function walkProgress(p) {
  if (p.phase === 'walk') return Math.min(1, p.timer / WALK_S);
  if (p.phase === 'ship') return Math.min(1, p.timer / SHIP_S);
  return 1;
}

export function sproutProgress(p) {
  return p.phase === 'sprout' ? Math.min(1, p.timer / SPROUT_S) : 1;
}

/** What the speech bubble says right now, or null. */
export function bubble(p) {
  if (p.phase === 'sprout' || p.phase === 'walk') return null;
  if (p.phase === 'ship') return { text: 'Off to the gate' };
  if (p.asleep) return null;
  if (p.pending) return { ask: true, text: '?' };
  if (p.phase === 'work') {
    const s = currentSteps(p)[p.step];
    return s ? { tool: s.tool, text: short(s.detail) } : null;
  }
  if (p.phase === 'done') return { done: true, text: `+${p.add} -${p.del}` };
  return null;
}

/** Bubbles are small: the file name rather than its path, long commands cut short. */
const short = (detail) => {
  if (detail.length <= 18) return detail;
  if (!detail.includes(' ') && detail.includes('/')) return detail.split('/').at(-1);
  return detail.slice(0, 16) + '…';
};

function currentSteps(p) {
  return p.task.turns[p.turn]?.steps ?? [];
}

/** Advances the whole game by `dt` seconds. */
export function tick(game, dt) {
  if (game.over) return;
  game.clock = Math.min(DAY_END, game.clock + dt * MINUTES_PER_SECOND);
  for (const p of game.plots) {
    if (!p) continue;
    p.timer += dt;
    advance(game, p, dt);
  }
  if (game.clock >= DAY_END) {
    game.over = true;
    log(game, 'Home time. Conversations keep their worktrees and branches overnight.');
  }
}

function advance(game, p, dt) {
  switch (p.phase) {
    case 'sprout':
      if (p.timer >= SPROUT_S) go(p, 'walk');
      return;
    case 'walk':
      if (p.timer >= WALK_S) go(p, 'sit');
      return;
    case 'sit':
      if (p.timer >= SIT_S) go(p, 'work');
      return;
    case 'wake':
      if (p.timer >= WAKE_S) {
        p.asleep = false;
        go(p, 'done');
      }
      return;
    case 'ship':
      if (p.timer >= SHIP_S) {
        game.plots[p.slot] = null;
        if (game.selected === p.id) game.selected = null;
      }
      return;
    case 'work':
      if (p.pending) {
        p.waiting += dt;
        game.waited += dt;
        game.longestWait = Math.max(game.longestWait, p.waiting);
        return;
      }
      if (p.timer >= STEP_S) runStep(game, p);
      return;
    case 'done':
      if (game.selected === p.id) {
        p.unread = false;
        p.idle = 0;
        return;
      }
      if (!p.asleep) {
        p.idle += dt;
        if (p.idle >= SLEEP_AFTER_S) {
          p.asleep = true;
          log(game, `${p.branch} fell asleep after sitting idle. Its agent shuts down to save memory and CPU, and wakes where it left off when you open it.`);
        }
      }
  }
}

function go(p, phase) {
  p.phase = phase;
  p.timer = 0;
}

/** Finishes the current step, or stops to ask first. */
function runStep(game, p) {
  const s = currentSteps(p)[p.step];
  if (!s) return finishTurn(game, p);
  if (p.mode === 'auto' && s.kind === 'risky') {
    p.items.push({ kind: 'blocked', text: `Auto mode blocked: ${s.detail}` });
    p.items.push({ kind: 'text', text: s.alt });
    log(game, `Auto mode's classifier blocked \`${s.detail}\` on ${p.branch} and the agent took another way. Nobody had to ask you.`);
    return nextStep(game, p);
  }
  if (needsPermission(s.kind, p.mode, p.allowAll)) {
    p.pending = s;
    p.waiting = 0;
    p.items.push({ kind: 'perm', step: s });
    log(game, `${p.branch} is waiting for you: ${s.tool} ${s.detail}. Its character turns amber and it counts under Needs you.`);
    return;
  }
  doStep(p, s);
  nextStep(game, p);
}

function doStep(p, s) {
  p.items.push({ kind: 'tool', tool: s.tool, detail: s.detail, out: s.out, add: s.add, del: s.del });
  if (s.add || s.del) {
    p.add += s.add ?? 0;
    p.del += s.del ?? 0;
    if (!p.files.includes(s.detail)) p.files.push(s.detail);
  }
}

function nextStep(game, p) {
  p.step += 1;
  p.timer = 0;
  if (!p.renamed) {
    p.renamed = true;
    const from = p.branch;
    p.branch = p.task.branch;
    log(game, `${from} renamed to ${p.branch} after the agent's first reply, from your message (ticket ID included) and the project's branch style.`);
  }
  if (p.step >= currentSteps(p).length) finishTurn(game, p);
}

function finishTurn(game, p) {
  const turn = p.task.turns[p.turn];
  p.items.push({ kind: 'text', text: turn.reply });
  p.history.push({ turn: p.turn + 1, add: p.add, del: p.del, files: [...p.files], items: p.items.length });
  go(p, 'done');
  p.idle = 0;
  p.unread = game.selected !== p.id;
  log(
    game,
    p.unread
      ? `${p.branch} finished a turn while you were elsewhere. It waves in green and counts under Unread.`
      : `${p.branch} finished its turn.`,
  );
}

/** Your answer to a waiting permission request. */
export function answer(game, p, choice) {
  const s = p.pending;
  if (!s) return;
  p.pending = null;
  game.answered += 1;
  const item = p.items.findLast((i) => i.kind === 'perm' && !i.resolved);
  if (choice === 'deny') {
    if (item) item.resolved = 'Denied';
    p.items.push({ kind: 'text', text: s.alt ?? `OK, I'll leave ${s.detail} as it is.` });
    log(game, `You denied ${s.tool} ${s.detail}. The agent works around it.`);
  } else {
    if (item) item.resolved = choice === 'all' ? allowAllLabel(s) : 'Allowed';
    if (choice === 'all') {
      if (s.kind === 'edit') {
        p.mode = 'edit';
        log(game, `${p.branch} switched to Edit mode: file edits in its worktree stop asking. Commands still ask.`);
      } else {
        p.allowAll = true;
        log(game, `Every later shell command in ${p.branch} runs without asking, until the conversation stops.`);
      }
    }
    doStep(p, s);
  }
  p.timer = 0;
  nextStep(game, p);
}

/** Opens a conversation, waking it if it was asleep. */
export function open(game, p) {
  game.selected = p?.id ?? null;
  if (!p) return;
  if (p.asleep && p.phase === 'done') {
    go(p, 'wake');
    log(game, `${p.branch} wakes on its bench and carries on where it left off, with the same mode and "always allow" choices.`);
  }
  p.unread = false;
  p.idle = 0;
}

/** Sends the conversation's next message, if the ticket has one. */
export function followUp(game, p) {
  const next = p.task.turns[p.turn + 1];
  if (!next || p.phase !== 'done') return;
  p.turn += 1;
  p.step = 0;
  p.items.push({ kind: 'you', text: next.you }, { kind: 'checkpoint', turn: p.turn + 1 });
  go(p, 'work');
  log(game, `Checkpoint ${p.turn + 1} saved for ${p.branch} before the agent acts on your message.`);
}

/** Rewind all: files and conversation back to the checkpoint saved before the last message. */
export function rewindAll(game, p) {
  if (p.phase !== 'done' || p.history.length < 2) return;
  const checkpoint = p.turn + 1;
  p.history.pop();
  const back = p.history.at(-1);
  p.turn -= 1;
  p.add = back.add;
  p.del = back.del;
  p.files = [...back.files];
  p.items = p.items.slice(0, back.items);
  p.items.push({ kind: 'system', text: `Rewound to checkpoint ${checkpoint}. Files and conversation are back to before that message.` });
  log(game, `Rewind all on ${p.branch}: files and conversation went back to checkpoint ${checkpoint}, taken before your last message.`);
}

/** Create PR: the agent walks its branch to the main gate. */
export function ship(game, p) {
  if (p.phase !== 'done') return;
  go(p, 'ship');
  game.shipped.push({ branch: p.branch, ticket: p.task.ticket, add: p.add, del: p.del, files: p.files.length, pr: 40 + game.shipped.length });
  log(game, `Opened PR #${40 + game.shipped.length - 1} from ${p.branch} into main (+${p.add} -${p.del}, ${filesText(p.files.length)}).`);
}

export function hasFollowUp(p) {
  return !!p.task.turns[p.turn + 1];
}

export function clockText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function filesText(n) {
  return `${n} file${n === 1 ? '' : 's'}`;
}

export function secondsText(s) {
  const n = Math.round(s);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/** Counts for the sidebar's filter chips. */
export function counts(game) {
  const c = { needs: 0, working: 0, unread: 0 };
  for (const p of game.plots) {
    if (!p) continue;
    const s = spriteState(p);
    if (s === 'permission') c.needs++;
    else if (s === 'working' || s === 'starting') c.working++;
    else if (s === 'unread') c.unread++;
  }
  return c;
}

/** Switches a conversation's mode, as Alt+M does in the app. */
export function setMode(game, p, mode) {
  if (!MODES[mode] || p.mode === mode) return;
  p.mode = mode;
  log(game, `${p.branch} is in ${MODES[mode].label} mode now. ${MODES[mode].help}`);
}

/** Sets the mode new conversations start in. */
export function setDefaultMode(game, mode) {
  if (MODES[mode]) game.defaultMode = mode;
}
