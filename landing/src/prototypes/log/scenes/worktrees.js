// Scene 2, Worktrees: three saplings sprout from bare ground as the gutter
// lanes fork beside them. Each gets a signpost for its branch and a tag for
// its worktree folder, then its agent walks in and sits down.
//
// The sequence starts once, when the graph's fork is drawn, and only plays
// forward. Under reduced motion it shows the finished grove.

import { C } from '../../grove/palette.js';
import { P, clamp } from './engine.js';
import { spreadPlots, bubbleAt, signAt, hitAt, bubbleTurn } from './common.js';
import { passed } from '../story.svelte.js';

const KEYS = ['auth', 'api', 'fix'];
const WALK_SPEED = 62;

export function worktreesScene(env) {
  let plots = [];
  let t = -1; // seconds since the sequence started, -1 before
  let lastPhase = '';

  function layout() {
    const xs = spreadPlots(env, 2, env.W - 2, env.compact ? 72 : 96);
    plots = KEYS.map((key, i) =>
      env.makePlot(key, xs[i], { growth: 0, sign: 0, bench: 0, lampPost: false, pose: 'none', status: 'off' }),
    );
    apply();
  }

  const walkStart = (i) => 1.9 + (i === 1 ? 0.5 : 0);
  const fromLeft = (i) => i < 2;

  function apply() {
    const G = env.groundY;
    const done = env.reduced || t >= 99;
    plots.forEach((p, i) => {
      const s = done ? 99 : t;
      const before = p.growth;
      p.growth = s < 0 ? 0 : clamp((s - 0.25 * i) / 1.3, 0, 1);
      if (!env.reduced && before < 1 && p.growth >= 1) p.shake = 0.4;
      p.sign = clamp((s - 0.7 - 0.25 * i) / 0.3, 0, 1);
      p.bench = clamp((s - 1.2 - 0.25 * i) / 0.4, 0, 1);
      p.lampPost = p.bench >= 1;
      const seat = Math.round(p.x) + P.agent + 4;
      if (s < walkStart(i)) {
        p.pose = 'none';
        p.status = 'off';
        return;
      }
      const startX = fromLeft(i) ? -8 : env.W + 8;
      const dist = Math.abs(seat - startX);
      const walked = (s - walkStart(i)) * WALK_SPEED;
      if (walked < dist) {
        p.pose = 'walk';
        p.ax = startX + Math.sign(seat - startX) * walked;
        p.ay = G + 5;
        p.walkT = s;
        p.status = 'off';
      } else {
        if (p.pose === 'walk') env.puff(seat, G);
        p.pose = 'sit';
        p.status = 'working';
      }
    });
    const phase = plots.map((p) => `${p.sign >= 1 ? 1 : 0}${p.pose}`).join();
    if (phase !== lastPhase) {
      lastPhase = phase;
      env.changed();
    }
  }

  function drawSoil(w, x) {
    const G = env.groundY;
    w.fillStyle = C.woodDark;
    w.fillRect(x - 6, G, 13, 2);
    w.fillRect(x - 4, G - 1, 9, 1);
    w.fillStyle = C.woodDeep;
    w.fillRect(x - 3, G + 1, 7, 1);
    w.fillStyle = C.wood;
    w.fillRect(x - 2, G - 1, 1, 1);
    w.fillRect(x + 2, G, 1, 1);
  }

  return {
    backdrop: { moon: [0.62, 0.24], sun: 0.2, clouds: 2, fireflies: 12, seed: 2, ground: (e) => (e.compact ? 30 : 34) },
    hitKeys: KEYS,
    height: (e) => (e.compact ? 150 : 150),
    layout,
    setReduced() {
      apply();
    },
    update(dt) {
      if (t < 0 && passed('fork')) t = 0;
      else if (t >= 0 && t < 99) t = t > 8 ? 99 : t + dt;
      for (const p of plots) p.shake = Math.max(0, p.shake - dt);
      apply();
    },
    drawWorld(w) {
      for (const p of plots) {
        if (p.growth < 0.2) drawSoil(w, Math.round(p.x));
        env.drawPlot(w, p);
      }
    },
    drawLights() {
      for (const p of plots) env.plotLights(p);
    },
    pin(key) {
      const [kind, id] = key.split(':');
      if (kind === 'fork') return [0, env.treeTop() + 12];
      const i = KEYS.indexOf(id);
      const p = plots[i];
      if (!p) return null;
      if (kind === 'sign') return p.sign >= 1 ? signAt(env, p) : null;
      if (kind === 'tag') {
        if (p.growth < 1) return null;
        const top = env.treeTop();
        const lift = env.compact && i === 1 ? 17 : 0;
        return [Math.round(p.x), top - 4 - lift];
      }
      if (kind === 'bubble') return p.pose === 'sit' && bubbleTurn(env, i) ? bubbleAt(env, p) : null;
      if (kind === 'hit') return p.pose === 'sit' ? hitAt(env, p, env.compact ? 6 : 3) : null;
      return null;
    },
    snapshot() {
      return Object.fromEntries(plots.map((p) => [p.key, { sign: p.sign >= 1, seated: p.pose === 'sit' }]));
    },
  };
}
