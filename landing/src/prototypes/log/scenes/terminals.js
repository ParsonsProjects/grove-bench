// Scene 3, Terminals: the agents at their benches with laptops glowing. Each
// laptop's screen is shown as a tiny terminal over its agent (npm test and
// its ticks), and speech bubbles show the tool calls. Ambient, it loops.

import { spreadPlots, bubbleAt, hitAt, bubbleTurn } from './common.js';
import { toolCalls, terminals } from '../data.js';

const KEYS = ['auth', 'api', 'fix'];
const STEP = 3.2;

export function terminalsScene(env) {
  let plots = [];
  let last = '';

  function layout() {
    const xs = spreadPlots(env, 2, env.W - 2, env.compact ? 72 : 100);
    plots = KEYS.map((key, i) => env.makePlot(key, xs[i], { screen: 1 }));
  }

  /** What agent `key` is doing right now. */
  function stateOf(key, i) {
    const steps = toolCalls[key];
    const time = env.reduced ? STEP * (steps.length - 1) + STEP * 0.99 : env.time + i * 1.1;
    const n = Math.floor(time / STEP);
    const idx = n % steps.length;
    const within = (time - n * STEP) / STEP;
    const [tool, detail] = steps[idx];
    const term = terminals[key];
    let ticks = 0;
    let done = false;
    let running = false;
    if (tool === 'Bash') {
      running = true;
      if (term.ticks) {
        ticks = Math.min(term.ticks, Math.floor(within * (term.ticks + 2)));
        done = within > (term.ticks + 1) / (term.ticks + 2);
      } else {
        done = within > 0.35;
      }
    }
    return { tool, detail, cmd: term.cmd, ticks, total: term.ticks, result: term.result, running, done };
  }

  function snapshot() {
    return { ...Object.fromEntries(KEYS.map((k, i) => [k, stateOf(k, i)])), compact: env.compact };
  }

  return {
    backdrop: { moon: [0.16, 0.2], sun: 0.85, clouds: 2, fireflies: 10, seed: 3, ground: (e) => (e.compact ? 30 : 34) },
    hitKeys: KEYS,
    height: (e) => (e.compact ? 158 : 150),
    layout,
    update() {
      const key = JSON.stringify(snapshot());
      if (key !== last) {
        last = key;
        env.changed();
      }
    },
    drawWorld(w) {
      for (const p of plots) env.drawPlot(w, p);
    },
    drawLights() {
      for (const p of plots) env.plotLights(p, 0.3);
    },
    pin(key) {
      const [kind, id] = key.split(':');
      const i = KEYS.indexOf(id);
      const p = plots[i];
      if (!p) return null;
      const head = bubbleAt(env, p);
      if (kind === 'bubble') return bubbleTurn(env, i) ? head : null;
      if (kind === 'term') {
        // Stacked above the bubble; on phones the middle one sits higher.
        const bubbleH = Math.ceil(26 / env.k);
        const lift = env.compact && i === 1 ? Math.ceil(52 / env.k) : 0;
        return [head[0], head[1] - bubbleH - lift];
      }
      if (kind === 'hit') return hitAt(env, p, env.compact ? 6 : 3);
      return null;
    },
    snapshot,
  };
}
