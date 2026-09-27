// Scripted engine behind the Workbench hero.
//
// Everything runs on a simulated clock: `Sim.tick(ms)` is called from an
// animation loop that pauses while the hero is off screen or the tab is
// hidden, so nothing here uses setTimeout.

import { models } from '../shared/brand.js';
import { PRESETS, WORKTREE_IDS, LANE_COLORS } from './scripts.js';

export const MAX_PANES = 4;
const TYPE_RATE = 0.07; // characters per ms while text streams in
const PERMISSION_WAIT = 5000; // autoplay approves after this long
const BASE_TOKENS = { opus: 8200, sonnet: 8200, haiku: 7400 };

let lastId = 0;
const uid = () => ++lastId;

/** Git graph: a main line plus one lane per conversation. */
export class Graph {
  /** Next free slot on the x axis. */
  head = $state(1);
  /** @type {{ id: number, row: number, color: string, label: string, from: number, to: number | null, closed: boolean }[]} */
  lanes = $state([]);
  /** @type {{ id: number, lane: number | null, slot: number, kind: 'main' | 'commit' | 'merge', color?: string }[]} */
  dots = $state([]);

  reset() {
    this.head = 1;
    this.lanes = [];
    /** When each lane colour was last handed out, so a new lane gets a fresh one. */
    this.colorUsed = LANE_COLORS.map(() => -1);
    this.dots = [-4, -3, -2, -1, 0].map((slot) => ({ id: uid(), lane: null, slot, kind: 'main' }));
  }

  /** @param {string} label */
  branch(label) {
    const used = new Set(this.lanes.filter((l) => l.to === null).map((l) => l.row));
    let row = 0;
    while (used.has(row)) row++;
    const busy = new Set(this.lanes.filter((l) => l.to === null).map((l) => l.color));
    const pick = LANE_COLORS.map((c, i) => i)
      .filter((i) => !busy.has(LANE_COLORS[i]))
      .sort((a, b) => this.colorUsed[a] - this.colorUsed[b])[0] ?? 0;
    this.colorUsed[pick] = this.head;
    this.lanes.push({ id: uid(), row, color: LANE_COLORS[pick], label, from: this.head, to: null, closed: false });
    this.head += 1;
    return this.lanes[this.lanes.length - 1];
  }

  /** @param {number} laneId */
  commit(laneId) {
    const id = uid();
    this.dots.push({ id, lane: laneId, slot: this.head, kind: 'commit' });
    this.head += 1;
    return id;
  }

  /** @param {number} laneId @param {boolean} [closed] */
  end(laneId, closed = false) {
    const lane = this.lanes.find((l) => l.id === laneId);
    if (!lane || lane.to !== null) return;
    // Leave room for the curve back into main.
    const last = Math.max(lane.from + 1, ...this.dots.filter((d) => d.lane === laneId).map((d) => d.slot));
    this.head = Math.max(this.head, last + 1);
    lane.to = this.head;
    lane.closed = closed;
    if (!closed) this.dots.push({ id: uid(), lane: null, slot: this.head, kind: 'merge', color: lane.color });
    this.head += 1;
    this.prune();
  }

  /** @param {number[]} ids */
  remove(ids) {
    if (!ids.length) return;
    const drop = new Set(ids);
    this.dots = this.dots.filter((d) => !drop.has(d.id));
  }

  prune() {
    const floor = this.head - 60;
    this.lanes = this.lanes.filter((l) => l.to === null || l.to > floor);
    this.dots = this.dots.filter((d) => d.slot > floor);
  }
}

/** One conversation pane. */
export class Pane {
  id = uid();
  /** @type {any[]} */
  messages = $state([]);
  /** @type {'working' | 'permission' | 'ready'} */
  status = $state('working');
  add = $state(0);
  del = $state(0);
  /** @type {string[]} */
  files = $state([]);
  tokens = $state(0);
  secs = $state(0);
  /** Checkpoints, one per message you sent. @type {{ n: number, text: string, add: number, del: number }[]} */
  turns = $state([]);
  /** Autoplay countdown while waiting for permission. @type {{ left: number, total: number } | null} */
  perm = $state(null);
  /** A rewound prompt waiting to be sent again. @type {string | null} */
  composer = $state(null);
  /** @type {{ id: number, text: string } | null} */
  notice = $state(null);
  /** The script finished. */
  done = $state(false);
  /** Autoplay is about to press Merge. */
  pressing = $state(false);

  /**
   * @param {Sim} sim
   * @param {typeof PRESETS[number]} preset
   * @param {number} index
   */
  constructor(sim, preset, index) {
    this.sim = sim;
    this.preset = preset;
    this.branch = preset.branch;
    this.model = models[preset.model];
    this.wt = WORKTREE_IDS[index % WORKTREE_IDS.length];
    this.lane = sim.graph.branch(preset.branch);
    this.laneId = this.lane.id;
    this.color = this.lane.color;
    this.tokens = BASE_TOKENS[preset.model];
    /** @type {any[]} */
    this.queue = preset.steps.slice();
    /** Non-reactive snapshot per turn, used to rewind. @type {any[]} */
    this.meta = [];
    /** @type {((dt: number) => boolean) | null} */
    this.active = null;
    /** @type {{ step: any, msg: any } | null} */
    this.pending = null;
    /** @type {any} */
    this.resendStep = null;
    this.always = new Set();
    this.wait = 300;
    this.ms = 0;
    this.readyMs = 0;
    this.instant = false;
  }

  get fast() {
    return this.instant || this.sim.reduced;
  }

  get contextLabel() {
    return this.model.contextWindow >= 1_000_000 ? '1M' : `${Math.round(this.model.contextWindow / 1000)}k`;
  }

  /** @param {number} dt */
  update(dt) {
    if (this.status === 'ready') {
      this.readyMs += dt;
      return;
    }
    this.ms += dt;
    const s = Math.floor(this.ms / 1000);
    if (s !== this.secs) this.secs = s;

    if (this.status === 'permission') {
      if (this.perm && this.sim.autoplay) {
        this.perm.left = Math.max(0, this.perm.left - dt);
        if (this.perm.left === 0) this.decide('allow', true);
      }
      return;
    }
    if (this.active) {
      if (this.active(dt)) this.active = null;
      return;
    }
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    const step = this.queue.shift();
    if (step) this.active = this.begin(step);
  }

  /**
   * Plays steps instantly, for the frame visitors see on load.
   * @param {{ steps?: number, until?: 'permission' | 'ready' }} opts
   */
  fastForward({ steps = Infinity, until } = {}) {
    this.instant = true;
    let guard = 400;
    while (guard-- > 0) {
      if (this.active) {
        if (this.active(100000)) this.active = null;
        continue;
      }
      if (this.status !== 'working' || steps <= 0) break;
      const step = this.queue.shift();
      if (!step) break;
      this.wait = 0;
      this.active = this.begin(step);
      this.ms += 1600;
      steps--;
      if (until && this.status === until) break;
    }
    this.wait = 250;
    this.secs = Math.floor(this.ms / 1000);
    this.instant = false;
  }

  /** @param {any} m */
  push(m) {
    this.messages.push({ id: uid(), ...m });
    return this.messages[this.messages.length - 1];
  }

  /** @param {number} ms @param {() => void} finish */
  timed(ms, finish) {
    let t = 0;
    return (/** @type {number} */ dt) => {
      t += dt;
      if (!this.fast && t < ms) return false;
      finish();
      return true;
    };
  }

  /** @param {any} step @returns {((dt: number) => boolean) | null} */
  begin(step) {
    switch (step.t) {
      case 'user':
        return this.beginUser(step);
      case 'say':
        return this.beginSay(step);
      case 'read':
        return this.beginRead(step);
      case 'edit':
        return this.beginEdit(step);
      case 'bash':
        return this.beginBash(step);
      case 'perm':
        return this.beginPerm(step);
      case 'done':
        return this.beginSay(step, () => {
          this.status = 'ready';
          this.done = true;
          this.readyMs = 0;
        });
      default:
        return null;
    }
  }

  /** @param {any} step */
  beginUser(step) {
    this.meta.push({
      msgIndex: this.messages.length,
      add: this.add,
      del: this.del,
      files: this.files.slice(),
      tokens: this.tokens,
      dots: [],
      queue: [step, ...this.queue],
    });
    this.turns.push({ n: this.turns.length + 1, text: step.text, add: 0, del: 0 });
    this.push({ kind: 'user', text: step.text });
    this.tokens += 320 + step.text.length * 4;
    this.wait = 600;
    return null;
  }

  /** @param {any} step @param {() => void} [onDone] */
  beginSay(step, onDone) {
    const m = this.push({ kind: 'say', text: step.text, shown: this.fast ? step.text.length : 0 });
    this.tokens += 180 + step.text.length * 3;
    return (/** @type {number} */ dt) => {
      m.shown = this.fast ? m.text.length : Math.min(m.text.length, m.shown + dt * TYPE_RATE);
      if (m.shown < m.text.length) return false;
      this.wait = 500;
      onDone?.();
      return true;
    };
  }

  /** @param {any} step */
  beginRead(step) {
    const m = this.push({ kind: 'read', file: step.file, lines: step.lines, pending: true });
    return this.timed(700, () => {
      m.pending = false;
      this.tokens += 1200 + step.lines * 14;
      this.wait = 350;
    });
  }

  /** @param {any} step */
  beginEdit(step) {
    for (const x of this.messages) if (x.kind === 'edit' && x.open && !x.touched) x.open = false;
    const m = this.push({
      kind: 'edit',
      file: step.file,
      add: step.add,
      del: step.del,
      diff: step.diff,
      isNew: !!step.isNew,
      pending: true,
      open: true,
      touched: false,
    });
    return this.timed(800, () => {
      m.pending = false;
      this.add += step.add;
      this.del += step.del;
      if (!this.files.includes(step.file)) this.files.push(step.file);
      const turn = this.turns[this.turns.length - 1];
      if (turn) {
        turn.add += step.add;
        turn.del += step.del;
      }
      const dot = this.sim.graph.commit(this.laneId);
      this.meta[this.meta.length - 1]?.dots.push(dot);
      this.tokens += 700 + step.add * 24;
      this.wait = 400;
    });
  }

  /** @param {any} step */
  beginBash(step) {
    const m = this.push({ kind: 'bash', cmd: step.cmd, out: [], summary: null, pending: true });
    const out = step.out;
    let t = 0;
    let i = 0;
    return (/** @type {number} */ dt) => {
      t += dt;
      const due = this.fast ? Infinity : t;
      while (i < out.length && due >= 500 + i * 360) {
        m.out.push(out[i]);
        i++;
        if (!this.fast) break;
      }
      if (i < out.length || due < 500 + out.length * 360 + 250) return false;
      m.summary = step.summary;
      m.pending = false;
      this.tokens += 600 + out.length * 90;
      this.wait = 500;
      return true;
    };
  }

  /** @param {any} step */
  beginPerm(step) {
    if (this.always.has(step.tool)) return this.begin(step.then);
    const m = this.push({
      kind: 'perm',
      tool: step.tool,
      target: step.file ?? step.cmd,
      diff: step.diff ?? null,
      decided: null,
      always: false,
      auto: false,
    });
    this.status = 'permission';
    this.perm = { left: PERMISSION_WAIT, total: PERMISSION_WAIT };
    this.pending = { step, msg: m };
    this.sim.onPermission(this);
    return null;
  }

  /** @param {'allow' | 'always' | 'deny'} kind @param {boolean} [auto] */
  decide(kind, auto = false) {
    if (this.status !== 'permission' || !this.pending) return;
    const { step, msg } = this.pending;
    msg.decided = kind === 'deny' ? 'deny' : 'allow';
    msg.always = kind === 'always';
    msg.auto = auto;
    this.pending = null;
    this.perm = null;
    this.status = 'working';
    if (kind === 'deny') {
      this.queue.unshift(...step.onDeny);
    } else {
      if (kind === 'always') this.always.add(step.tool);
      this.queue.unshift(step.then);
    }
    this.wait = 450;
  }

  /**
   * Rewinds to checkpoint `n` (1-based), undoing that turn and every turn
   * after it. `all` also restores files, `conv` keeps them.
   * @param {number} n @param {'all' | 'conv'} mode
   */
  rewind(n, mode) {
    const meta = this.meta[n - 1];
    if (!meta) return;
    this.active = null;
    this.pending = null;
    this.perm = null;
    this.wait = 0;
    const later = this.meta.splice(n - 1);
    this.messages.splice(meta.msgIndex);
    if (mode === 'all') {
      this.add = meta.add;
      this.del = meta.del;
      this.files = meta.files.slice();
      this.sim.graph.remove(later.flatMap((t) => t.dots));
    }
    this.tokens = meta.tokens;
    this.turns.splice(n - 1);
    this.queue = meta.queue.slice(1);
    this.resendStep = meta.queue[0];
    this.composer = meta.queue[0].text;
    this.status = 'ready';
    this.done = false;
    this.readyMs = 0;
    this.notice = {
      id: uid(),
      text: mode === 'all' ? `Rewound to #${n}. Files and conversation restored.` : `Rewound the conversation to #${n}. Files kept.`,
    };
  }

  resend() {
    if (this.composer === null || !this.resendStep) return;
    this.queue.unshift(this.resendStep);
    this.resendStep = null;
    this.composer = null;
    this.status = 'working';
    this.wait = 150;
  }
}

export class Sim {
  /** @type {Pane[]} */
  panes = $state([]);
  autoplay = $state(true);
  mergedFiles = $state(0);
  /** Merges since the page loaded. The CTA grows a tree for each. */
  trees = $state(0);
  /** Pane shown on narrow screens. */
  focusId = $state(0);
  graph = new Graph();

  running = $derived(this.panes.length);
  filesChanged = $derived(this.mergedFiles + this.panes.reduce((n, p) => n + p.files.length, 0));

  /** @param {{ reduced?: boolean }} [opts] */
  constructor({ reduced = false } = {}) {
    this.reduced = reduced;
    this.boot(!reduced);
  }

  /** @param {boolean} autoplay */
  boot(autoplay) {
    this.panes = [];
    this.graph.reset();
    this.mergedFiles = 0;
    this.now = 0;
    /** @type {{ at: number, fn: () => void }[]} */
    this.timers = [];
    this.cursor = 2;
    this.wtIndex = 0;
    this.cooldown = 7000;
    this.autoplay = autoplay;

    const a = /** @type {Pane} */ (this.spawn(PRESETS[0]));
    const b = /** @type {Pane} */ (this.spawn(PRESETS[1]));
    if (this.reduced && !autoplay) {
      // A still frame: one agent asking for permission, one ready to merge.
      a.fastForward({ until: 'permission' });
      b.fastForward({ until: 'ready' });
    } else {
      a.fastForward({ steps: 6 });
      b.fastForward({ steps: 3 });
    }
    this.focusId = a.id;
  }

  /** @param {number} dt milliseconds */
  tick(dt) {
    this.now += dt;
    for (const pane of this.panes.slice()) pane.update(dt);
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.now);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.now);
        for (const t of due) t.fn();
      }
    }
    if (this.autoplay) this.direct(dt);
  }

  /** @param {number} ms @param {() => void} fn */
  after(ms, fn) {
    this.timers.push({ at: this.now + ms, fn });
  }

  /** Autoplay: merge finished agents, keep two or three busy. @param {number} dt */
  direct(dt) {
    for (const pane of this.panes) {
      if (pane.status === 'ready' && pane.done && !pane.pressing && pane.readyMs > 2200) {
        pane.pressing = true;
        this.after(750, () => {
          if (this.autoplay && pane.pressing) this.merge(pane);
        });
      }
    }
    this.cooldown -= dt;
    if (this.cooldown <= 0 && this.panes.length < 3) {
      const preset = this.nextPreset();
      const pane = preset ? this.spawn(preset) : null;
      if (pane) this.focusId = pane.id;
      this.cooldown = 9000;
    }
  }

  nextPreset() {
    for (let i = 0; i < PRESETS.length; i++) {
      const preset = PRESETS[(this.cursor + i) % PRESETS.length];
      if (!this.panes.some((p) => p.preset.id === preset.id)) {
        this.cursor = (this.cursor + i + 1) % PRESETS.length;
        return preset;
      }
    }
    return null;
  }

  /** @param {typeof PRESETS[number]} preset */
  spawn(preset) {
    if (this.panes.length >= MAX_PANES) return null;
    const pane = new Pane(this, preset, this.wtIndex++);
    this.panes.push(pane);
    return pane;
  }

  /** @param {Pane} pane */
  onPermission(pane) {
    if (this.autoplay) this.focusId = pane.id;
  }

  /** @param {Pane} pane */
  merge(pane) {
    this.remove(pane, false);
    this.mergedFiles += pane.files.length;
    this.trees += 1;
  }

  /** @param {Pane} pane @param {boolean} closed */
  remove(pane, closed) {
    const i = this.panes.indexOf(pane);
    if (i < 0) return;
    this.graph.end(pane.laneId, closed);
    this.panes.splice(i, 1);
    if (this.focusId === pane.id) this.focusId = this.panes[Math.max(0, i - 1)]?.id ?? 0;
    this.cooldown = Math.min(this.cooldown, 1800);
  }

  // Visitor actions. Each one hands control to the visitor.

  takeOver() {
    if (!this.autoplay) return;
    this.autoplay = false;
    for (const pane of this.panes) pane.pressing = false;
  }

  /** @param {string} presetId */
  launch(presetId) {
    this.takeOver();
    const open = this.panes.find((p) => p.preset.id === presetId);
    if (open) {
      this.focusId = open.id;
      return;
    }
    const preset = PRESETS.find((p) => p.id === presetId);
    const pane = preset ? this.spawn(preset) : null;
    if (pane) this.focusId = pane.id;
  }

  addAgent() {
    this.takeOver();
    const preset = this.nextPreset();
    if (preset) this.launch(preset.id);
  }

  /** @param {Pane} pane @param {'allow' | 'always' | 'deny'} kind */
  decide(pane, kind) {
    this.takeOver();
    pane.decide(kind);
  }

  /** @param {Pane} pane @param {number} n @param {'all' | 'conv'} mode */
  rewind(pane, n, mode) {
    this.takeOver();
    pane.rewind(n, mode);
  }

  /** @param {Pane} pane */
  resend(pane) {
    this.takeOver();
    pane.resend();
  }

  /** @param {Pane} pane */
  mergeNow(pane) {
    this.takeOver();
    this.merge(pane);
  }

  /** @param {Pane} pane */
  close(pane) {
    this.takeOver();
    this.remove(pane, true);
  }

  /** @param {number} id */
  focus(id) {
    this.takeOver();
    this.focusId = id;
  }

  replay() {
    this.boot(true);
  }
}
