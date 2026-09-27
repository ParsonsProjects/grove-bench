// The last scene, in daylight: the gutter's main line runs in along the
// ground and a big tree grows where it ends. The three agents rest on their
// benches beside it, lamps green: their branches are home.
//
// The tree grows once, after the graph's ground line has been drawn. Reduced
// motion shows it grown.

import { treePalette } from '../../grove/palette.js';
import { P, clamp } from './engine.js';
import { bubbleAt, hitAt, bubbleTurn } from './common.js';
import { story } from '../story.svelte.js';
import { lanes } from '../lanes.js';

const KEYS = ['auth', 'api', 'fix'];
const bigPal = treePalette(0, 0.02);

export function ctaScene(env) {
  let plots = [];
  let treeX = 0;
  let block = 12;
  let t = -1;
  let burst = false;
  let last = '';

  function layout() {
    const { W } = env;
    block = env.compact ? 8 : 12;
    treeX = Math.round(W * (env.compact ? 0.27 : 0.3));
    const xs = env.compact ? [W - 96, W - 64, W - 32] : [W * 0.56, W * 0.71, W * 0.86].map(Math.round);
    plots = KEYS.map((key, i) =>
      env.makePlot(key, xs[i] - P.agent - 4, { tree: false, sign: 0, lampPost: !env.compact, status: 'ready' }),
    );
  }

  const progress = () => (env.reduced ? 99 : t);

  return {
    backdrop: { moon: null, sun: 0.82, clouds: 4, fireflies: 0, seed: 9, meteors: false, ground: (e) => (e.compact ? 30 : 34) },
    hitKeys: KEYS,
    height: (e) => (e.compact ? 156 : 172),
    layout,
    update(dt) {
      if (t < 0 && story.head >= (story.marks.ground ?? Infinity) + 110) t = 0;
      else if (t >= 0 && t < 99) t = t > 6 ? 99 : t + dt;
      const s = progress();
      if (!burst && s >= 3) {
        burst = true;
        const size = env.treeSize(block);
        env.burstLeaves(treeX, env.groundY - size.h * 0.7, 30, 1.3);
      }
      const key = s < 0 ? 'wait' : s < 3 ? 'grow' : 'done';
      if (key !== last) {
        last = key;
        env.changed();
      }
    },
    drawWorld(w) {
      const G = env.groundY;
      const s = progress();
      // Main, running in along the ground to the roots.
      const line = s < 0 ? 0 : clamp(s / 0.5, 0, 1);
      const rootX = treeX - 3;
      if (line > 0) {
        w.fillStyle = lanes.main.stroke;
        w.fillRect(0, G - 1, Math.round(rootX * line), 1);
      }
      const growth = s < 0.5 ? 0.02 : clamp((s - 0.5) / 2.4, 0.02, 1);
      env.drawTreeAt(w, treeX, G, bigPal, growth, block, 'big');
      for (const p of plots) env.drawPlot(w, p);
    },
    drawLights() {
      for (const p of plots) env.plotLights(p);
    },
    pin(key) {
      const [kind, id] = key.split(':');
      if (kind === 'ground') return [0, env.groundY - 0.5];
      const p = plots[KEYS.indexOf(id)];
      if (!p) return null;
      if (kind === 'bubble') return bubbleTurn(env, KEYS.indexOf(id)) ? bubbleAt(env, p) : null;
      if (kind === 'hit') return hitAt(env, p, env.compact ? 5 : 3);
      return null;
    },
    snapshot() {
      return { grown: progress() >= 3 };
    },
  };
}
