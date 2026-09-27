// Scene 8, Review and ship: dawn. As each lane merges back into main in the
// gutter, its agent gets up, walks along the path to the main gate and its
// lamp turns green with a burst of leaves. feat/api stays at its bench,
// amber, until the visitor has answered its permission prompt.
//
// Each walk starts once, when the graph's merge node is drawn, and only
// plays forward. Reduced motion shows everyone at the gate.

import { C } from '../../grove/palette.js';
import { drawGate, halo } from '../../grove/sprites.js';
import { P } from './engine.js';
import { spreadPlots, bubbleAt, hitAt, bubbleTurn } from './common.js';
import { story, passed } from '../story.svelte.js';

const KEYS = ['auth', 'api', 'fix'];
const SPEED = 50;

export function shipScene(env) {
  let plots = [];
  let gateX = 0;
  /** Seconds since each agent set off, or -1. */
  const started = [-1, -1, -1];
  const arrived = [false, false, false];
  let last = '';

  function layout() {
    const { W } = env;
    gateX = W - (env.compact ? 16 : 34);
    const xs = spreadPlots(env, 2, gateX - (env.compact ? 16 : 40), env.compact ? 64 : 88);
    plots = KEYS.map((key, i) => env.makePlot(key, xs[i], { sign: 0 }));
    apply();
  }

  const answered = () => story.permission !== 'pending';
  const queueX = (i) => gateX - 18 - i * 10;

  function apply() {
    const G = env.groundY;
    plots.forEach((p, i) => {
      const seat = Math.round(p.x) + P.agent + 4;
      const s = env.reduced && (i !== 1 || answered()) ? 99 : started[i];
      if (s < 0) {
        p.pose = 'sit';
        p.status = i === 1 && !answered() ? 'permission' : 'working';
        return;
      }
      if (s < 0.5) {
        p.pose = 'stand';
        p.ax = seat;
        p.ay = G;
        p.status = 'working';
        return;
      }
      const drop = 5;
      const run = queueX(i) - seat;
      const d = (s - 0.5) * SPEED;
      if (d < drop + run) {
        p.pose = 'walk';
        p.walkT = s;
        p.ax = d < drop ? seat : seat + (d - drop);
        p.ay = G + Math.min(drop, d);
        p.status = 'working';
        return;
      }
      p.pose = 'stand';
      p.ax = queueX(i);
      p.ay = G + drop;
      p.status = 'ready';
      if (!arrived[i]) {
        arrived[i] = true;
        if (!env.reduced) {
          env.burstLeaves(p.x, G - 44, 16, 0.9);
          env.burstLeaves(gateX, G - 30, 8, 1);
        }
      }
    });
    const key = plots.map((p) => p.pose + p.status).join();
    if (key !== last) {
      last = key;
      env.changed();
    }
  }

  const allHome = () => plots.length && plots.every((p) => p.status === 'ready');

  return {
    backdrop: { moon: [0.3, 0.12], sun: 0.72, clouds: 3, fireflies: 8, seed: 8, ground: (e) => (e.compact ? 30 : 34) },
    hitKeys: KEYS,
    height: (e) => (e.compact ? 150 : 150),
    layout,
    setReduced() {
      apply();
    },
    update(dt) {
      KEYS.forEach((key, i) => {
        if (started[i] >= 0) started[i] += dt;
        else if (passed(`merge-${key}`) && (key !== 'api' || answered())) started[i] = 0;
      });
      apply();
    },
    drawWorld(w) {
      if (env.reduced) apply();
      for (const p of plots) {
        const pose = p.pose;
        p.pose = 'none';
        env.drawPlot(w, p);
        p.pose = pose;
      }
      drawGate(w, gateX, env.groundY + 1);
      // Walkers on the path in front of the benches.
      for (const p of plots) env.drawAgent(w, p);
    },
    drawLights(ctx, tt) {
      for (const p of plots) env.plotLights(p);
      if (allHome()) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = env.reduced ? 0.8 : 0.6 + 0.3 * Math.sin(tt * 2);
        ctx.drawImage(halo(C.green, 22, 0.8), gateX - 22, env.groundY - 38);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
    },
    pin(key) {
      const [kind, id] = key.split(':');
      const G = env.groundY;
      if (kind === 'merge') return [0, Math.round(env.H * { auth: 0.28, api: 0.52, fix: 0.76 }[id])];
      if (kind === 'gate') return [gateX + 0.5, G - 25];
      if (kind === 'ready') return [gateX + 0.5, G - 46];
      const i = KEYS.indexOf(id);
      const p = plots[i];
      if (!p) return null;
      if (kind === 'bubble') {
        const asking = i === 1 && !answered();
        return p.pose === 'sit' && (asking || bubbleTurn(env, i)) ? bubbleAt(env, p) : null;
      }
      if (kind === 'hit') return hitAt(env, p, env.compact ? 5 : 3);
      return null;
    },
    snapshot() {
      return {
        home: plots.filter((p) => p.status === 'ready').length,
        all: !!allHome(),
        waiting: !answered(),
        poses: Object.fromEntries(plots.map((p) => [p.key, p.pose])),
      };
    },
  };
}
