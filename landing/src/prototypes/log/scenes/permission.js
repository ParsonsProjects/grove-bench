// Scene 5, Permissions: feat/api wants to run a command and waits for you,
// its lamp amber and a question mark over its head. Allow: the lamp goes
// blue and it gets on with the job. Deny: it shrugs and says what it will
// do instead. The answer lives in the shared story state, because the
// gutter lane for feat/api waits on it too.

import { spreadPlots, bubbleAt, hitAt } from './common.js';
import { story } from '../story.svelte.js';
import { afterAllow, afterDeny, denyLine } from '../data.js';

const KEYS = ['auth', 'api', 'fix'];
const STEP = 2.4;
const SHRUG = 2.8;

export function permissionScene(env) {
  let plots = [];
  let answer = story.permission;
  let answeredAt = 0;
  let lastKey = '';

  function layout() {
    const xs = spreadPlots(env, 2, env.W - 2, env.compact ? 72 : 100);
    plots = KEYS.map((key, i) => env.makePlot(key, xs[i], { sign: key === 'api' ? 1 : 0 }));
    sync();
  }

  /** Where feat/api is in its reply to your answer. */
  function apiState() {
    if (answer === 'pending') return { pose: 'sit', status: 'permission', bubble: { tool: '?', detail: '' } };
    const since = env.reduced ? 0.1 : env.time - answeredAt;
    const denied = answer === 'deny';
    if (denied && since < SHRUG) return { pose: 'shrug', status: 'working', bubble: { tool: 'say', detail: denyLine } };
    const steps = denied ? afterDeny : afterAllow;
    const i = Math.min(steps.length - 1, Math.floor((since - (denied ? SHRUG : 0)) / STEP));
    const [tool, detail] = steps[i];
    return { pose: 'sit', status: tool === 'done' ? 'ready' : 'working', bubble: { tool, detail } };
  }

  function sync() {
    if (story.permission !== answer) {
      answer = story.permission;
      answeredAt = env.time;
    }
    const api = plots[1];
    if (!api) return;
    const s = apiState();
    api.pose = s.pose;
    api.status = s.status;
    const key = `${s.pose}|${s.status}|${s.bubble.tool}|${s.bubble.detail}`;
    if (key !== lastKey) {
      lastKey = key;
      env.changed();
    }
  }

  return {
    backdrop: { moon: [0.22, 0.2], sun: 0.7, clouds: 2, fireflies: 12, seed: 5, ground: (e) => (e.compact ? 30 : 34) },
    hitKeys: KEYS,
    height: (e) => (e.compact ? 150 : 150),
    layout,
    setReduced() {
      sync();
    },
    update() {
      sync();
    },
    drawWorld(w) {
      sync();
      for (const p of plots) env.drawPlot(w, p);
    },
    drawLights() {
      for (const p of plots) env.plotLights(p);
    },
    pin(key) {
      const [kind, id] = key.split(':');
      const p = plots[KEYS.indexOf(id)];
      if (!p) return null;
      if (kind === 'bubble') return bubbleAt(env, p);
      if (kind === 'sign') return [Math.round(p.x) - 17, env.groundY - 8];
      if (kind === 'hit') return hitAt(env, p, env.compact ? 6 : 3);
      return null;
    },
    snapshot() {
      return { api: apiState(), answer };
    },
  };
}
