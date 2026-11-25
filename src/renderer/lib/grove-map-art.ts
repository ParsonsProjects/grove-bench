/**
 * The grove map's scenery (Settings > Grove map): pixel maps and their
 * colours, drawn on the map's 6px grid. A grove at night, so the greens are
 * the logo's leaves taken down a step, and the wood is the logo's bark and
 * roots. People are not here: they are the grove characters
 * (agent-sprite.ts), drawn over the scenery.
 *
 * Each map is rows of one width; '.' is empty, every other key must be in
 * the map's palette (grove-map-art.test.ts checks).
 */
import { PALETTE } from '../../shared/brand.js';

type Palette = Record<string, string>;

/** A map and the colours of its keys. */
export interface Art {
  rows: string[];
  pal: Palette;
}

const art = (rows: string[], pal: Palette): Art => ({ rows, pal });

/** The ground and paths. */
export const GROUND = {
  grass: '#132013',
  patch: '#162616',
  tuftDark: '#1f3a23',
  tuftLight: '#284a2c',
  path: '#3d3026',
  pathEdge: '#2f251d',
  pebble: '#4a4642',
  pebbleLight: '#57534e',
  bed: '#2f241c',
  bedEdge: '#4a382c',
};

/** Flowers in the grass and the beds, as in the context grove. */
export const BLOOMS = ['#e8c65a', '#e88aa6', '#e6e1d6'];

/** A log cabin room, one per project. */
export const ROOM = {
  wallCap: '#3f3025',
  log: PALETTE.root,
  logSeam: '#5a4436',
  trim: PALETTE.bark,
  side: '#4a382c',
  sideInner: '#3f3025',
  step: PALETTE.root,
  stepTop: PALETTE.bark,
  floor: '#6f5644',
  floorAlt: '#684f3e',
  shadow: 'rgba(0, 0, 0, 0.35)',
};

const LEAVES: Palette = { O: '#10241a', a: PALETTE.leaf, b: PALETTE.moss, c: PALETTE.fern, d: '#2f8040', e: PALETTE.forest, t: PALETTE.bark, T: PALETTE.root, S: '#0b130c' };

export const ROUND_TREE = art([
  '....OOOOOO....', '..OOaaaabbOO..', '.OaaaabbbbbbO.', 'OaaabbbbbbbccO', 'OabbbbbbbbcccO', 'ObbbbbbbbccccO',
  'ObbbbbbbccccdO', 'ObbbbbbcccdddO', '.ObbcccccdddO.', '.OccccccdddeO.', '..OOcdddeeOO..', '....OOttOO....',
  '......tT......', '......tT......', '.....TtTT.....', '....SSSSSS....',
], LEAVES);

export const PINE = art([
  '.....OO.....', '....OaaO....', '...OabbcO...', '...ObbccO...', '..OabbccdO..', '..ObbccddO..',
  '.OabbcccddO.', '.OObbccddOO.', '..OabbccdO..', '.OabbbccddO.', 'OabbbcccdddO', 'ObbbccccddeO',
  'OObcccdddeOO', '.OOOOddOOOO.', '.....tT.....', '.....tT.....', '....STTS....',
], LEAVES);

export const SMALL_TREE = art([
  '..OOOO..', '.OaabbO.', 'ObbbbccO', 'ObbbccdO', '.OccddO.', '..OttO..', '...tT...', '..STTS..',
], LEAVES);

export const BUSH = art(['..OOOO..', '.OabbcO.', 'ObbbccdO', 'ObccddeO', '.OOOOOO.'], LEAVES);

export const ROCK = art(['.rr.', 'rRrr', '.RR.'], { r: '#6b6560', R: '#4a4642' });
export const MUSHROOM = art(['.cc.', 'cccc', '.ss.'], { c: '#a0805a', s: '#e6e1d6' });

export const POND = art([
  '.....OOOOOOOOOOOO.....', '...OOwwwwwwwwwwwwOO...', '..OwwwwWwwwwwwwwwwwO..', '.OwwwwwwwwwwllwwwwwwO.',
  'OwwwwwwwwwwlLlwwwwwwwO', 'OwwwwwllwwwwlwwwwWwwwO', 'OwwwwlLlwwwwwwwwwwwwwO', '.OwwwwlwwwwwwwwwwwwwO.',
  '..OwwwwwwwwwWwwwwwwO..', '...OOwwwwwwwwwwwwOO...', '.....OOOOOOOOOOOO.....',
], { O: '#4a4642', w: '#1b3236', W: '#2e5257', l: PALETTE.fern, L: '#e88aa6' });

export const LAMP_POST = art([
  '.OOO.', 'OgggO', 'OgggO', 'OgggO', '.OmO.', '..m..', '..m..', '..m..', '..m..', '..m..', '..m..', '..m..', '..m..', '..m..', '.mmm.', 'mmmmm',
], { O: '#3f3f46', g: '#f3e6c4', m: '#57534e' });

/** The scenery's park bench, as in the empty states. */
export const BENCH = art(['WWWWWWWWWWWW', '.w........w.', 'wwwwwwwwwwww', '.W........W.', '.W........W.'], { w: PALETTE.bark, W: PALETTE.root });

export const SIGNPOST = art([
  'wwwwwwww', 'wWWWWWWw', 'wwwwwwww', '...W....', '...W....', '...W....', '...W....', '...W....', '..WWW...',
], { w: PALETTE.bark, W: PALETTE.root });

/** A fence `n` units long: a post every six units and two rails. */
export function fence(n: number): Art {
  const row = (rail: boolean) => Array.from({ length: n }, (_, x) => (x % 6 === 0 ? 'P' : rail ? 'r' : '.')).join('');
  return art([row(false), row(true), row(false), row(true), row(false)], { P: PALETTE.root, r: PALETTE.bark });
}

// Inside a room.
export const WINDOW = art([
  'FFFFFFFFFF', 'FnnnnFnnnF', 'FnxnnFnuuF', 'FnnnnFnuuF', 'FFFFFFFFFF', 'FnnnnFnnnF', 'FnnnxFnnnF', 'FnnnnFnnnF', 'FFFFFFFFFF', 'SSSSSSSSSS',
], { F: '#9a7652', n: '#1e2a3a', x: '#e6e1d6', u: '#e6e1d6', S: '#b08a62' });

export const CLOCK = art(['.WWW.', 'WpppW', 'WpkpW', 'WppkW', '.WWW.'], { W: PALETTE.bark, p: '#e6e1d6', k: '#3f3025' });

export const NOTICE_BOARD = art([
  'FFFFFFFFFFFF', 'FkppkkyykppF', 'FkppkkyykppF', 'FkkkkkkkkkkF', 'FyykppkkkyyF', 'FyykppkkkyyF', 'FFFFFFFFFFFF',
], { F: '#4f3b2f', k: '#a0805a', p: '#d6d3d1', y: '#e8c65a' });

export const BOOKSHELF = art([
  'OOOOOOOOOO', 'OBBBBBBBBO', 'O1234B561O', 'O1234B561O', 'O1234B561O', 'OWWWWWWWWO',
  'O56B12344O', 'O56B12344O', 'O56B12344O', 'OWWWWWWWWO', 'O3B6145B2O', 'O3B6145B2O',
  'O3B6145B2O', 'OWWWWWWWWO', 'O214B6B33O', 'O214B6B33O', 'O214B6B33O', 'OWWWWWWWWO', 'OBBBBBBBBO', 'OOOOOOOOOO',
], { O: '#3f3025', W: PALETTE.bark, B: '#2e231b', 1: '#7a4a3a', 2: '#4a5a7a', 3: '#5a6a3a', 4: '#8a7a4a', 5: '#6a4a6a', 6: '#4a6a6a' });

const POT: Palette = { l: PALETTE.moss, m: PALETTE.fern, t: '#8a5a40', T: '#6a4430' };
export const BIG_PLANT = art(['...lml...', '.lmlmlml.', 'lmlmlmlml', '.lmlmlml.', '..lmlml..', '...lml...', '..ttttt..', '..TtttT..', '..TtttT..', '...TTT...'], POT);
export const DESK_PLANT = art(['lml', 'mlm', 'ttt', '.T.'], POT);

export const LANTERN = art(['.mmm.', 'mgggm', 'mgggm', '.mmm.', '..m..', '..m..', '..m..', '..m..', '..m..', '..m..', '..m..', '.mmm.', 'mmmmm'], { m: '#57534e', g: '#f3e6c4' });

const WOOD: Palette = { w: PALETTE.bark, W: PALETTE.root, p: '#e6e1d6', q: '#a8a29e' };
export const CRATE = art(['WWWWWWWW', 'WwwwwwwW', 'WWwwwwWW', 'WwWwwWwW', 'WwwWWwwW', 'WWWWWWWW'], WOOD);
export const PAPERS = art(['pppp.', 'pqqpp', 'ppppp'], WOOD);
export const MUG = art(['pp.', 'ppp', 'pp.'], WOOD);

// Each room's own touch: the props of the Preview, Changes and Checkpoints
// tabs' empty states (agent-sprite.ts), in the same colours.
const PROP: Palette = { W: PALETTE.root, b: '#4a7aaa', p: '#d6d3d1', k: '#a8a29e', g: '#6b7f8e', G: '#4f5f6b', l: PALETTE.leaf, m: '#57534e', r: '#c2553d' };
export const EASEL = art(['....W....', 'WWWWWWWWW', 'WbbbbbbbW', 'WpkkkkppW', 'WpppppppW', 'WpkkpkkpW', 'WWWWWWWWW', '.W..W..W.', '.W..W..W.', 'W...W...W', 'W...W...W'], PROP);
export const WATERING_CAN = art(['....GGG.', '...G...G', 'g..ggggg', '.g.ggggg', '..gggggg', '...GGGGG'], PROP);
export const SPROUT = art(['l.l', '.l.', '.l.'], PROP);
export const FLAG = art(['.m....', '.mrrrr', '.mrrr.', '.mrrrr', '.m....', '.m....', '.m....', '.m....', '.m....', '.m....', 'mmm...'], PROP);

/** Desks pushed together, `cols` seats wide. Two-sided: a back half the back
 *  row works at, a seam, and a front half for the front row. */
export function desks(cols: number, twoSided: boolean): Art {
  const w = cols * 22;
  const line = (fill: string, seam = '') =>
    Array.from({ length: w }, (_, x) => (x === 0 || x === w - 1 ? 'O' : seam && x % 22 === 0 ? seam : fill)).join('');
  const rows = [line('H')];
  for (let i = 0; i < (twoSided ? 3 : 4); i++) rows.push(line('w', 'v'));
  if (twoSided) {
    rows.push(line('v'));
    for (let i = 0; i < 3; i++) rows.push(line('w', 'v'));
  }
  rows.push(line('F'), line('G'));
  const legs = Array.from({ length: w }, (_, x) => (x === 1 || x === w - 2 || (cols > 1 && (x === w / 2 - 1 || x === w / 2)) ? 'k' : '.')).join('');
  return art([...rows, legs, legs], { O: '#3f3025', H: '#c09a6e', w: '#a07c56', v: PALETTE.bark, F: PALETTE.root, G: '#4f3b2f', k: '#3f3025' });
}

/** Exported for tests: every fixed map. */
export const MAP_ART = {
  ROUND_TREE, PINE, SMALL_TREE, BUSH, ROCK, MUSHROOM, POND, LAMP_POST, BENCH, SIGNPOST, WINDOW, CLOCK, NOTICE_BOARD,
  BOOKSHELF, BIG_PLANT, DESK_PLANT, LANTERN, CRATE, PAPERS, MUG, EASEL, WATERING_CAN, SPROUT, FLAG,
};
