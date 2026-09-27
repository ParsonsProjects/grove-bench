// Scene 7, Project memory: the old tree and the memory stone. Notes for the
// project (repo/, conventions/, architecture/, sessions/) are pinned to its
// crown, and threads of light run from the stone to every bench, because
// every conversation reads the notes when it starts.

import { C, oldTreePalette, mix } from '../../grove/palette.js';
import { drawStone, runePixels, halo, hash, treeBlocks } from '../../grove/sprites.js';
import { P, quad, clamp } from './engine.js';
import { bubbleAt, hitAt, bubbleTurn } from './common.js';

const KEYS = ['auth', 'api', 'fix'];

export function memoryScene(env) {
  let plots = [];
  let oldX = 0;
  let stoneX = 0;
  let block = 10;

  function layout() {
    const { W } = env;
    block = env.compact ? 7 : 10;
    oldX = Math.round(W * (env.compact ? 0.24 : 0.28));
    stoneX = oldX - (env.compact ? 14 : 30);
    const xs = env.compact ? [W - 98, W - 64, W - 30] : [W * 0.56, W * 0.72, W * 0.88].map(Math.round);
    plots = KEYS.map((key, i) =>
      env.makePlot(key, xs[i] - P.agent - 4, { tree: false, sign: 0, lampPost: !env.compact }),
    );
  }

  const oldSize = () => env.treeSize(block);
  const crownTop = () => env.groundY - oldSize().h + 1;

  function threads(tt, strength) {
    const ctx = env.ctx;
    const G = env.groundY;
    const x0 = stoneX + 1;
    const y0 = G - 8;
    plots.forEach((p, n) => {
      const box = env.agentBox(p);
      const x1 = box.cx;
      const y1 = box.y - 1;
      const cx = (x0 + x1) / 2;
      const cy = Math.min(y0, y1) - 22 - Math.abs(x1 - x0) * 0.16;
      const len = Math.abs(x1 - x0) + 40;
      const steps = Math.ceil(len / 1.2);
      ctx.fillStyle = C.primaryLight;
      for (let i = 0; i <= steps; i++) {
        const [px, py] = quad(x0, y0, x1, y1, cx, cy, i / steps);
        ctx.globalAlpha = strength * (0.32 + 0.25 * ((i + Math.floor(tt * 12)) % 6 === 0 ? 1 : 0));
        ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
      }
      if (env.reduced) return;
      ctx.globalCompositeOperation = 'lighter';
      for (let j = 0; j < 3; j++) {
        const t = (tt * 0.26 + j / 3 + n * 0.17) % 1;
        const [px, py] = quad(x0, y0, x1, y1, cx, cy, t);
        ctx.globalAlpha = strength * 0.9;
        ctx.drawImage(halo(C.primaryPale, 3, 1), Math.round(px) - 3, Math.round(py) - 3);
        ctx.fillStyle = C.primaryPale;
        ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
      }
      ctx.globalCompositeOperation = 'source-over';
    });
    ctx.globalAlpha = 1;
  }

  const blocksOld = treeBlocks(1);

  return {
    backdrop: { moon: [0.62, 0.14], sun: 0.78, clouds: 2, fireflies: 12, seed: 7, ground: (e) => (e.compact ? 30 : 34) },
    hitKeys: KEYS,
    height: (e) => (e.compact ? 156 : 156),
    layout,
    drawWorld(w) {
      env.drawTreeAt(w, oldX, env.groundY, oldTreePalette, 1, block, 'old');
      drawStone(w, stoneX, env.groundY);
      for (const p of plots) env.drawPlot(w, p);
    },
    drawLights(ctx, tt) {
      for (const p of plots) env.plotLights(p);
      const G = env.groundY;
      // The rune glows, and so do a few leaves of the old tree.
      const pulse = env.reduced ? 1 : 0.75 + 0.25 * Math.sin(tt * 2.2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = pulse;
      ctx.drawImage(halo(C.primaryLight, 16, 0.9), stoneX - 15, G - 21);
      const size = oldSize();
      const left = Math.round(oldX - (size.w - 1) / 2);
      const top = crownTop();
      blocksOld.forEach((b, i) => {
        if (b.kind !== 'leaf' || hash(i, 77) < 0.55) return;
        const pl = env.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(tt * 1.7 + i);
        ctx.globalAlpha = pl * 0.28;
        ctx.fillStyle = C.primaryLight;
        ctx.fillRect(left + b.c * size.step + 2, top + b.r * size.step + 2, block - 4, block - 4);
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = mix(C.primaryLight, '#ffffff', 0.3);
      for (const [rx, ry] of runePixels(stoneX, G)) ctx.fillRect(rx, ry, 1, 1);
      threads(tt, clamp(1 - env.tod * 0.4, 0.6, 1));
    },
    pin(key) {
      const [kind, id] = key.split(':');
      if (kind === 'note') {
        const i = +id;
        const top = crownTop();
        if (env.compact) return [oldX + (i % 2 ? 58 : -14), top + 6 + Math.floor(i / 2) * 16];
        return [oldX + (i % 2 ? 20 : -20), top + 16 + Math.floor(i / 2) * 20];
      }
      if (kind === 'stone') return [stoneX + 0.5, env.groundY + 2];
      const p = plots[KEYS.indexOf(id)];
      if (!p) return null;
      if (kind === 'bubble') return bubbleTurn(env, KEYS.indexOf(id)) ? bubbleAt(env, p) : null;
      if (kind === 'hit') return hitAt(env, p, env.compact ? 6 : 3);
      return null;
    },
    snapshot() {
      return { compact: env.compact };
    },
  };
}
