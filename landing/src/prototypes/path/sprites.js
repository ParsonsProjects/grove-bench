// Extra sprites for Grove Path, built with the Night Grove helpers:
// a four-frame walk towards the camera, the same walk seen from behind (for
// walking back up a lane), and a few small props.

import { spriteFromMap, agentSprites, hash } from '../grove/sprites.js';
import { C, mix } from '../grove/palette.js';

const HEAD = ['..hhhhh..', '.hhhhhhh.', '.hsssssh.', '.sessses.', '.sssssss.', '..sSSSs..'];
const BACK_HEAD = ['..hhhhh..', '.hhhhhhh.', '.hhhhhhh.', 'shhhhhhhs', '.hhhhhhh.', '..sssss..'];
const BODY = ['.bbbbbbb.', 'bbbbbbbbb', 'bbBbbbBbb'];
const BACK_BODY = ['.bbbbbbb.', 'bbBBBBBbb', 'bbbBBBbbb'];

// Arms and legs for: standing, left foot forward, right foot forward.
const ARMS = {
  idle: ['bbbbbbbbb', 's.bbbbb.s'],
  left: ['bbbbbbbbs', 's.bbbbb..'],
  right: ['sbbbbbbbb', '..bbbbb.s'],
};
const LEGS = {
  idle: ['..ppppp..', '..pp.pp..', '..pp.pp..', '..ff.ff..'],
  left: ['..ppppp..', '..pp.pp..', '..pp.ff..', '..ff.....'],
  right: ['..ppppp..', '..pp.pp..', '..ff.pp..', '.....ff..'],
};

function build(head, body, pose) {
  return [...head, ...body, ...ARMS[pose], ...LEGS[pose]];
}

/** Rows of the standing front frame, for small HTML icons. */
export const FRONT_ROWS = [...HEAD, ...BODY, ...ARMS.idle, ...LEGS.idle];

function withBeanie(rows) {
  return ['..kkkkk..', '.kkkkkkk.', ...rows.slice(2)];
}

/**
 * All frames for one agent. `front` and `back` are walk cycles of four frames
 * (idle, left, idle, right); `sit` is the Night Grove bench pose with a laptop.
 */
export function agentFrames(look) {
  const colours = {
    h: look.hair,
    k: look.beanie ?? look.hair,
    s: C.skin,
    S: C.skinShade,
    e: '#1e1e1e',
    b: look.hoodie,
    B: mix(look.hoodie, '#000000', 0.25),
    p: C.pants,
    f: C.shoes,
  };
  const map = (rows) => spriteFromMap(look.beanie ? withBeanie(rows) : rows, colours);
  const front = ['idle', 'left', 'idle', 'right'].map((p) => map(build(HEAD, BODY, p)));
  const back = ['idle', 'left', 'idle', 'right'].map((p) => map(build(BACK_HEAD, BACK_BODY, p)));
  return { front, back, sit: agentSprites(look).sit, w: 9, h: 15 };
}

/** A small checkpoint stone, 7 x 5, whose top left sits at (x, y). */
export function drawCheckpointStone(ctx, x, y, lit) {
  const rows = ['.sssss.', 'sSSSSSd', 'sSSSSSd', 'dSSSSdd', '.ddddd.'];
  const colours = { s: C.stoneLight, S: C.stone, d: C.stoneDark };
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx];
      if (ch === '.') continue;
      ctx.fillStyle = colours[ch];
      ctx.fillRect(x + rx, y + ry, 1, 1);
    }
  });
  // A carved mark that glows once the conversation has reached this turn.
  ctx.fillStyle = lit ? mix(C.amber, '#ffffff', 0.35) : C.stoneDark;
  ctx.fillRect(x + 3, y + 1, 1, 3);
  ctx.fillRect(x + 2, y + 2, 3, 1);
}

/**
 * A small wooden gate across a lane. `open` 0..1 swings the two leaves
 * towards you. (cx, groundY) is the middle of the lane at the gate.
 */
export function drawLaneGate(ctx, cx, groundY, open = 0) {
  const top = groundY - 9;
  // Posts.
  for (const px of [cx - 7, cx + 6]) {
    ctx.fillStyle = C.woodDark;
    ctx.fillRect(px, top, 2, 10);
    ctx.fillStyle = C.woodPale;
    ctx.fillRect(px, top, 1, 10);
    ctx.fillStyle = C.wood;
    ctx.fillRect(px, top - 1, 2, 1);
  }
  if (open < 0.5) {
    // Closed: two rails and slats.
    ctx.fillStyle = C.wood;
    ctx.fillRect(cx - 5, top + 2, 11, 1);
    ctx.fillRect(cx - 5, top + 6, 11, 1);
    ctx.fillStyle = C.woodPale;
    for (let sx = cx - 4; sx <= cx + 4; sx += 2) ctx.fillRect(sx, top + 1, 1, 7);
    ctx.fillStyle = C.woodDeep;
    ctx.fillRect(cx - 5, top + 8, 11, 1);
    return;
  }
  // Open: each leaf swung towards you, seen nearly edge on.
  for (const [px, dir] of [[cx - 5, -1], [cx + 5, 1]]) {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? C.woodPale : C.wood;
      ctx.fillRect(px + dir * Math.floor(i / 2), top + 2 + i * 2, 1, 3);
    }
  }
}

/** A round bush, base on `base`. */
export function drawBush(ctx, x, base, seed, small = false) {
  const puffs = small ? [[-3, 3, 3], [2, 4, 3]] : [[-5, 3, 4], [0, 6, 5], [5, 3, 4]];
  for (const pass of [0, 1, 2]) {
    for (const [dx, h, r] of puffs) {
      const cx = x + dx;
      const top = base - h - r + 1;
      for (let yy = 0; yy <= r * 2; yy++) {
        const half = Math.round(Math.sqrt(Math.max(0, r * r - (yy - r) ** 2)));
        const y = top + yy;
        if (y > base) continue;
        if (pass === 0) {
          ctx.fillStyle = C.leafSeam;
          ctx.fillRect(cx - half - 1, y, half * 2 + 3, 1);
        } else if (pass === 1) {
          ctx.fillStyle = yy < 2 ? C.grassTop : hash(seed + dx, yy) < 0.2 ? C.grassDark : C.grass;
          ctx.fillRect(cx - half, y, half * 2 + 1, 1);
        }
      }
      if (pass === 2) {
        ctx.fillStyle = C.leafTop;
        ctx.fillRect(cx - 1, top + 1, 2, 1);
      }
    }
  }
}

/** A glowing memory note: a folded page, 5 x 4. */
export function drawNote(ctx, x, y) {
  ctx.fillStyle = C.cream;
  ctx.fillRect(x, y, 5, 4);
  ctx.fillStyle = C.primaryPale;
  ctx.fillRect(x + 1, y + 1, 3, 1);
  ctx.fillRect(x + 1, y + 2, 2, 1);
  ctx.fillStyle = mix(C.cream, C.stone, 0.4);
  ctx.fillRect(x + 4, y, 1, 1);
}
