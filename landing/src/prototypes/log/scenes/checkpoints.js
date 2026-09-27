// Scene 6, Checkpoints: a sundial beside the fix/login-bug tree. One tick
// per message you sent. Dragging the shadow back shrinks the tree to what it
// was at that turn, and the bubble shows that turn's tool call. Rewind all
// keeps it there (files and conversation), Conv. only regrows it (files
// kept, just the conversation goes back).

import { drawSundial } from '../../grove/sprites.js';
import { P, clamp } from './engine.js';
import { bubbleAt, hitAt } from './common.js';
import { turns } from '../data.js';

const MAX = turns.length;

export function checkpointsScene(env) {
  let plots = [];
  let fix = null;
  let dialX = 0;
  let turn = MAX;
  /** @type {{ mode: 'all' | 'conv', turn: number } | null} */
  let note = null;
  let touched = false;

  const growthFor = (n) => {
    const total = env.blocksFor(1).length;
    return Math.round((0.3 + (0.7 * (n - 1)) / (MAX - 1)) * total) / total;
  };
  const target = () => (note?.mode === 'conv' ? 1 : growthFor(turn));

  function layout() {
    const { W } = env;
    plots = [];
    if (!env.compact) {
      plots.push(env.makePlot('auth', Math.round(W * 0.13), { sign: 0 }));
      plots.push(env.makePlot('api', Math.round(W * 0.35), { sign: 0 }));
    }
    const fx = env.compact ? Math.round(W * 0.34) : Math.round(W * 0.6);
    fix = env.makePlot('fix', fx, { status: 'ready', growth: target() });
    plots.push(fix);
    dialX = Math.min(W - 16, fx + P.lamp + (env.compact ? 34 : 30));
  }

  const angleFor = (n) => Math.PI + ((n - 1) / (MAX - 1)) * Math.PI;

  function bubble() {
    if (note) return { tool: 'say', detail: note.mode === 'all' ? `Rewound to turn ${note.turn}` : `Chat at turn ${note.turn}, files kept` };
    const [tool, detail] = turns[turn - 1].step;
    return { tool, detail: `${detail}`, turn };
  }

  return {
    backdrop: { moon: [0.5, 0.16], sun: 0.66, clouds: 3, fireflies: 10, seed: 6, ground: (e) => (e.compact ? 32 : 34) },
    hitKeys: ['fix'],
    height: (e) => (e.compact ? 150 : 150),
    layout,
    setReduced() {
      if (fix) fix.growth = target();
    },
    update(dt) {
      if (!fix) return;
      const before = Math.floor(fix.growth * env.blocksFor(1).length);
      const goal = target();
      fix.growth += Math.sign(goal - fix.growth) * Math.min(Math.abs(goal - fix.growth), dt * 0.9);
      const after = Math.floor(fix.growth * env.blocksFor(1).length);
      if (after < before) {
        const size = env.treeSize();
        for (let i = after; i < before; i++) {
          env.dropLeaf(fix.x - size.w / 2 + Math.random() * size.w, env.groundY - size.h * 0.6, fix.pal.leaves[i % 4]);
        }
      }
    },
    drawWorld(w) {
      if (env.reduced && fix) fix.growth = target();
      for (const p of plots) env.drawPlot(w, p);
      const ticks = [];
      for (let i = 1; i <= MAX; i++) ticks.push({ angle: angleFor(i), active: i <= turn });
      drawSundial(w, dialX, env.groundY + 1, angleFor(turn), ticks);
    },
    drawLights() {
      for (const p of plots) env.plotLights(p);
    },
    pin(key) {
      const [kind, id] = key.split(':');
      const G = env.groundY;
      if (kind === 'dial') return [dialX - 15, G - 27, 31, 22];
      if (kind === 'hint') return touched ? null : [dialX + 0.5, G - 28];
      if (kind === 'sign') return fix ? [Math.round(fix.x) + P.sign + 1, G - 8] : null;
      const p = plots.find((q) => q.key === id);
      if (!p) return null;
      if (kind === 'bubble') return p === fix ? bubbleAt(env, p) : null;
      if (kind === 'hit') return hitAt(env, p, env.compact ? 6 : 3);
      return null;
    },
    snapshot() {
      return { turn, max: MAX, note, bubble: bubble(), touched };
    },
    setTurn(n) {
      const next = clamp(Math.round(n), 1, MAX);
      touched = true;
      if (next === turn && !note) return;
      turn = next;
      note = null;
      env.changed();
    },
    rewind(mode) {
      if (turn >= MAX) return;
      note = { mode, turn };
      if (mode === 'conv' && !env.reduced) env.burstLeaves(fix.x, env.groundY - 40, 10, 0.7);
      env.changed();
    },
    reset() {
      turn = MAX;
      note = null;
      env.changed();
    },
  };
}
