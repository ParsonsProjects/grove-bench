// Scene 4, Isolation: all three agents edit the same file at once, each its
// own copy in its own worktree. Low fences between the benches, a sheet of
// paper filling up over each agent and a wooden sign: conflicts: 0.

import { C } from '../../grove/palette.js';
import { spreadPlots, bubbleAt, hitAt } from './common.js';
import { drawPaper } from './sprites.js';
import { lanes } from '../lanes.js';

const KEYS = ['auth', 'api', 'fix'];

export function isolationScene(env) {
  let plots = [];
  let fences = [];

  function layout() {
    const xs = spreadPlots(env, 2, env.W - 2, env.compact ? 72 : 100);
    plots = KEYS.map((key, i) => env.makePlot(key, xs[i], { sign: 0, screen: 0.5 }));
    const half = (xs[1] - xs[0]) / 2;
    fences = [xs[0] - half + 2, (xs[0] + xs[1]) / 2 + 2, (xs[1] + xs[2]) / 2 + 2, xs[2] + half + 2].map(Math.round);
  }

  function drawFence(w, cx) {
    const base = env.groundY + 1;
    const h = 7;
    for (let px = -6; px <= 6; px += 3) {
      w.fillStyle = C.cream;
      w.fillRect(cx + px, base - h + 1, 1, h);
      w.fillStyle = C.woodPale;
      w.fillRect(cx + px, base - h + 1, 1, 1);
    }
    w.fillStyle = C.woodPale;
    w.fillRect(cx - 7, base - h + 3, 15, 1);
    w.fillRect(cx - 7, base - 2, 15, 1);
  }

  function boardPos() {
    return { x: Math.round(env.W / 2), base: env.H - 4 };
  }

  function paperY() {
    return env.groundY - (env.compact ? 52 : 47);
  }

  return {
    backdrop: { moon: [0.78, 0.18], sun: 0.3, clouds: 3, fireflies: 10, seed: 4, ground: (e) => (e.compact ? 32 : 36) },
    hitKeys: KEYS,
    height: (e) => (e.compact ? 156 : 150),
    layout,
    drawWorld(w) {
      for (const f of fences) drawFence(w, f);
      for (const p of plots) env.drawPlot(w, p);
      // Posts for the sign in the meadow; the board itself is HTML.
      const b = boardPos();
      w.fillStyle = C.woodDark;
      w.fillRect(b.x - 12, b.base - 12, 2, 13);
      w.fillRect(b.x + 10, b.base - 12, 2, 13);
      w.fillStyle = C.woodDeep;
      w.fillRect(b.x - 11, b.base - 12, 1, 13);
      w.fillRect(b.x + 11, b.base - 12, 1, 13);
    },
    drawLights(ctx, tt) {
      for (const p of plots) env.plotLights(p);
      // The same file, three copies, each being written in its own worktree.
      plots.forEach((p, i) => {
        const box = env.agentBox(p);
        const t = env.reduced ? 0.8 : ((tt * 0.35 + i * 0.37) % 1.25) / 1.0;
        drawPaper(ctx, Math.round(box.cx) - 6, paperY(), Math.min(1, t), lanes[p.key].stroke);
      });
    },
    pin(key) {
      const [kind, id] = key.split(':');
      if (kind === 'board') {
        const b = boardPos();
        return [b.x + 0.5, b.base - 10];
      }
      const p = plots[KEYS.indexOf(id)];
      if (!p) return null;
      if (kind === 'bubble') return bubbleAt(env, p);
      if (kind === 'hit') return hitAt(env, p, env.compact ? 6 : 3);
      return null;
    },
  };
}
