// Scene 1, the hero: the whole grove at night. Three trees (worktrees), three
// agents on their benches (conversations) and three lamps (status), with
// labelled callouts pointing at one of each. Fireflies drift to the pointer.

import { P } from './engine.js';
import { spreadPlots, cycle, bubbleAt, signAt, hitAt } from './common.js';
import { agents } from '../data.js';
import { story } from '../story.svelte.js';

const AUTH_STEPS = agents.auth.script.filter(([tool]) => tool !== 'done');

/**
 * @param {any} env
 * @param {{ inset: number }} opts inset: CSS px on the left kept clear for the title
 */
export function heroScene(env, opts) {
  let plots = [];
  let step = 0;
  const wide = () => opts.inset > 0;

  function layout() {
    const { W } = env;
    const left = wide() ? Math.ceil(opts.inset / env.k) + 6 : 4;
    const xs = spreadPlots(env, left, W - 4, env.compact ? 72 : 88);
    plots = ['auth', 'api', 'fix'].map((key, i) => env.makePlot(key, xs[i], { status: 'working' }));
    sync();
  }

  function sync() {
    if (!plots.length) return;
    plots[1].status = story.permission === 'pending' ? 'permission' : 'working';
    plots[2].status = 'ready';
  }

  function callouts() {
    if (!plots.length) return [];
    const G = env.groundY;
    const top = env.treeTop();
    const [p0, p1, p2] = plots;
    const row = top - 7;
    const ax = Math.round(p1.x) + P.agent + 12;
    const lx = Math.round(p2.x) + P.lamp + 1;
    return [
      { key: 'tree', label: [Math.round(p0.x), row], path: [[p0.x, row + 1], [p0.x, top - 2]], end: 'down' },
      { key: 'agent', label: [ax, row], path: [[ax, row + 1], [ax, G - 10], [ax - 1, G - 10]], end: 'left' },
      { key: 'lamp', label: [lx, row], path: [[lx, row + 1], [lx, G - 24]], end: 'down' },
    ];
  }

  return {
    backdrop: { moon: [0.5, 0.22], sun: 0.8, clouds: 3, fireflies: 22, seed: 1, ground: (e) => (e.compact ? 30 : 34) },
    hitKeys: ['auth', 'api', 'fix'],
    height: (e) => (wide() ? 186 : e.compact ? 158 : 166),
    layout,
    update(dt) {
      const next = cycle(env.time, AUTH_STEPS.length, 2.6);
      if (next !== step) {
        step = next;
        env.changed();
      }
      sync();
    },
    drawWorld(w) {
      for (const p of plots) env.drawPlot(w, p);
    },
    drawLights(ctx) {
      sync();
      for (const p of plots) env.plotLights(p);
    },
    drawTop() {
      for (const c of callouts()) env.drawLeader(c.path, c.end, 1);
    },
    pin(key) {
      const [kind, id] = key.split(':');
      const p = plots.find((q) => q.key === id);
      if (kind === 'bubble' && p) return bubbleAt(env, p);
      if (kind === 'sign' && p) return signAt(env, p);
      if (kind === 'hit' && p) return hitAt(env, p, env.compact ? 6 : 3);
      if (kind === 'callout') return callouts().find((c) => c.key === id)?.label ?? null;
      return null;
    },
    snapshot() {
      const [tool, detail] = AUTH_STEPS[step];
      return {
        auth: { tool, detail },
        api: story.permission === 'pending' ? { tool: '?', detail: '' } : { tool: 'Write', detail: 'profile.ts +89' },
        fix: { tool: 'done', detail: agents.fix.readyText },
      };
    },
  };
}
