// Extra sprites for the Grove Log scenes, built with the Night Grove helpers.

import { spriteFromMap, agentSprites, makeCanvas } from '../../grove/sprites.js';
import { C, mix } from '../../grove/palette.js';

// Sitting with the laptop on the lap, hands up: the "oh well" of an agent
// whose request was denied. 11 wide, drawn one pixel left of SITTING.
const SHRUG = [
  '...hhhhh...',
  '..hhhhhhh..',
  '..hsssssh..',
  '..sessses..',
  '..sssssss..',
  's..sSSSs..s',
  'bb.bbbbb.bb',
  '.bbbBbBbbb.',
  '..LLLLLLL..',
  '..lllglll..',
  '.blllllllb.',
  '..LLLLLLL..',
  '..pp...pp..',
  '..pp...pp..',
  '..ff...ff..',
];

/** All the sprites one agent needs: sit, shrug, walk frames. */
export function characterSprites(look) {
  const base = agentSprites(look);
  const colours = {
    h: look.hair,
    s: C.skin,
    S: C.skinShade,
    e: '#1e1e1e',
    b: look.hoodie,
    B: mix(look.hoodie, '#000000', 0.25),
    l: C.laptop,
    L: C.laptopEdge,
    g: mix(C.laptop, C.primaryLight, 0.6),
    p: C.pants,
    f: C.shoes,
  };
  return { ...base, shrug: spriteFromMap(SHRUG, colours) };
}

/** A sheet of paper with a folded corner. `lines` 0..1 fills it with text. */
export function drawPaper(ctx, x, y, lines = 1, tint = C.primaryLight) {
  const w = 11;
  const h = 13;
  ctx.fillStyle = '#1b1f2a';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = C.cream;
  ctx.fillRect(x, y, w, h);
  // Folded corner.
  ctx.fillStyle = '#1b1f2a';
  ctx.fillRect(x + w - 3, y - 1, 4, 1);
  ctx.fillRect(x + w, y, 1, 3);
  ctx.fillStyle = mix(C.cream, '#000000', 0.2);
  ctx.fillRect(x + w - 3, y, 3, 3);
  ctx.fillStyle = C.cream;
  ctx.fillRect(x + w - 3, y, 1, 1);
  ctx.fillRect(x + w - 2, y + 1, 1, 1);
  // Lines of text.
  const rows = [3, 5, 7, 9, 11];
  const shown = Math.round(lines * rows.length);
  rows.forEach((ry, i) => {
    const len = [6, 8, 5, 7, 4][i];
    ctx.fillStyle = i < shown ? tint : mix(C.cream, '#000000', 0.12);
    ctx.fillRect(x + 2, y + ry, len, 1);
  });
}

/** A small wooden notice board on two posts. The text is an HTML overlay. */
export function drawBoard(ctx, x, groundY, w = 30, h = 12) {
  const top = groundY - h - 8;
  ctx.fillStyle = C.woodDark;
  ctx.fillRect(x + 3, top + h, 2, groundY - top - h + 1);
  ctx.fillRect(x + w - 5, top + h, 2, groundY - top - h + 1);
  ctx.fillStyle = C.woodDeep;
  ctx.fillRect(x, top, w, h);
  ctx.fillStyle = C.wood;
  ctx.fillRect(x + 1, top + 1, w - 2, h - 2);
  ctx.fillStyle = C.woodPale;
  ctx.fillRect(x + 1, top + 1, w - 2, 1);
  return { cx: x + w / 2, top, h };
}

/** A tiny cached canvas, drawn once. */
export function cached(w, h, draw) {
  const { canvas, ctx } = makeCanvas(w, h);
  draw(ctx);
  return canvas;
}
