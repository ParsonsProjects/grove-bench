/**
 * Pixel characters for the sidebar's conversation status (opt-in via the
 * `groveCharacters` setting).
 *
 * Each state gets its own pose, so the status reads from shape as well as
 * colour. The hoodie and symbol take the same Tailwind colour as the status
 * dot they replace, via `currentColor`. The logo on the back of the laptop lid
 * takes the project colour. Skin and hair vary per conversation (see
 * `agentLook`).
 */

export type AgentSpriteState =
  | 'removing'
  | 'error'
  | 'starting'
  | 'installing'
  | 'permission'
  | 'working'
  | 'unread'
  | 'stopped'
  | 'sleeping'
  | 'ready'
  // Permission prompts once answered.
  | 'allowed'
  | 'denied'
  // Question prompts, in the question block's own colours.
  | 'asking'
  | 'answered';

export interface AgentSpriteInput {
  destroying: boolean;
  status: string;
  hasPending: boolean;
  isRunning: boolean;
  needsAttention: boolean;
}

/** Same precedence as the sidebar's status dot. */
export function agentSpriteState(s: AgentSpriteInput): AgentSpriteState {
  if (s.destroying) return 'removing';
  if (s.status === 'error') return 'error';
  if (s.status === 'starting') return 'starting';
  if (s.status === 'installing') return 'installing';
  if (s.hasPending) return 'permission';
  if (s.isRunning) return 'working';
  if (s.needsAttention) return 'unread';
  if (s.status === 'stopped') return 'stopped';
  if (s.status === 'sleeping') return 'sleeping';
  return 'ready';
}

export const SPRITE_W = 10;
export const SPRITE_H = 9;

// Map legend. `c` cells use currentColor (the state colour). Hair, skin and
// logo here are the fallback look, for a character not tied to a conversation
// or a project without a colour.
const PALETTE: Record<string, string> = {
  h: '#4a3426', // hair
  s: '#e8b48a', // skin
  z: '#b9825d', // closed eyes, a shade darker than the skin
  e: '#1c1917', // eyes
  L: '#57534e', // laptop edge
  o: '#a8a29e', // logo on the back of the lid, in the project colour
  p: '#3f3f46', // trousers
  f: '#18181b', // shoes
  c: 'currentColor',
};

// Sitting on a bench with a laptop on the lap, lid open towards the agent, so
// we see its back and logo. Columns 6 to 9 hold symbols.
const HEAD = ['.hhhh.....', 'hhhhhh....', 'hesseh....', '.ssss.....'];
const HEAD_ASLEEP = ['.hhhh.....', 'hhhhhh....', 'hzsszh....', '.ssss.....'];
const HOODIE = ['cccccc....', 'cccccc....'];
// The open lid covers the hoodie's lower middle. Dark all round, so the logo
// still stands out when the project and state colours match.
const HOODIE_BEHIND_LID = ['cccccc....', 'cLLLLc....'];
const LEGS_SIT = ['.pppp.....', '.f..f.....'];

const SIT = [...HEAD, ...HOODIE_BEHIND_LID, 'sLooLs....', ...LEGS_SIT];
// Typing: one hand on the keys, then the other.
const TYPE_A = [...HEAD, ...HOODIE_BEHIND_LID, 'sLooL.....', ...LEGS_SIT];
const TYPE_B = [...HEAD, ...HOODIE_BEHIND_LID, '.LooLs....', ...LEGS_SIT];
// Asleep over a closed laptop, lying flat with the logo on top.
const ASLEEP = [...HEAD_ASLEEP, ...HOODIE, 'sLooLs....', ...LEGS_SIT];

/** Overlays a symbol drawn in columns 6 to 9 onto a pose. */
function withSymbol(pose: string[], symbol: string[]): string[] {
  return pose.map((row, i) => row.slice(0, 6) + (symbol[i] ?? '').padEnd(4, '.'));
}

const QUESTION = ['.ccc', '...c', '..cc', '....', '..c.'];
const BANG = ['..c.', '..c.', '..c.', '....', '..c.'];
const ZZZ = ['cccc', '..c.', '.c..', 'cccc'];
const CHECK = ['', '...c', 'c.c.', '.c..'];
const CROSS = ['', '.c.c', '..c.', '.c.c'];
const BUBBLE = ['', 'cccc', 'cccc', 'c...'];

// Waving: the right arm is raised and the hand rocks side to side.
const WAVE_POSE = [...HEAD, ...HOODIE_BEHIND_LID, 'sLooL.....', ...LEGS_SIT];
const WAVE_A = withSymbol(WAVE_POSE, ['', 's', 'c', 'c', 'c']);
const WAVE_B = withSymbol(WAVE_POSE, ['', '.s', 'c', 'c', 'c']);

// Walking in: no laptop yet, legs apart then together.
const WALK_TOP = [...HEAD, 'cccccc....', 'sccccs....', '.cccc.....'];
const WALK_A = [...WALK_TOP, '.p..p.....', '.f..f.....'];
const WALK_B = [...WALK_TOP, '..pp......', '..ff......'];

// Walking side-on, facing right, for the grove walk. The first frame is the
// passing pose, which also stands in for the still one. It is a pixel taller
// than the stride, so the head bobs as the frames swap.
const SIDE_HEAD = ['.hhhh.', 'hhhhhh', 'hhsses', '.hsss.'];
const SIDE_PASS = [...SIDE_HEAD, '.cccc.', '.cccc.', '.cccc.', '..pp..', '..pp..', '..fff.'];
const SIDE_STRIDE = ['......', ...SIDE_HEAD, '.cccc.', 'cccccs', '.cccc.', '.p..p.', '.f..ff'];

export const SIDE_WALK_W = 6;
export const SIDE_WALK_H = 10;
export const SIDE_WALK_MAPS = [SIDE_PASS, SIDE_STRIDE];

/** Palette overrides for one character, keyed like the pixel maps. */
export type AgentLook = Record<'h' | 's' | 'z', string>;

/**
 * Palette overrides for one character: its look, plus the project colour on
 * the laptop logo when there is one.
 */
export function agentColors(seed: string | undefined, projectColor?: string | null): Record<string, string> {
  return { ...(seed ? agentLook(seed) : {}), ...(projectColor ? { o: projectColor } : {}) };
}

// Each skin tone comes with the darker shade its closed eyes use.
export const SKIN_TONES: Omit<AgentLook, 'h'>[] = [
  { s: '#f3d3b6', z: '#c9a07e' },
  { s: '#e8b48a', z: '#b9825d' },
  { s: '#d09a6a', z: '#a06c42' },
  { s: '#b07a4e', z: '#825432' },
  { s: '#8e5c3b', z: '#643c24' },
  { s: '#6e4530', z: '#4a2b1c' },
];

// Lifted a little where needed so dark hair still shows on the dark sidebar.
export const HAIR_TONES: string[] = [
  '#37313b', // black
  '#4a3426', // dark brown
  '#7a5230', // brown
  '#8e3b24', // auburn
  '#c4632e', // ginger
  '#d9b46a', // blonde
  '#a19c96', // grey
];

/** FNV-1a: a small stable hash, so a conversation keeps its look across restarts. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Picks a skin tone and hair colour from a seed, normally the conversation id. */
export function agentLook(seed: string): AgentLook {
  const n = hashString(seed) % (SKIN_TONES.length * HAIR_TONES.length);
  return { ...SKIN_TONES[n % SKIN_TONES.length], h: HAIR_TONES[Math.floor(n / SKIN_TONES.length)] };
}

export interface SpriteRun {
  x: number;
  y: number;
  w: number;
  /** Map key, so a look can recolour the run. */
  key: string;
  fill: string;
  /** Part of the symbol (question mark, exclamation mark, zzz), which may pulse. */
  symbol: boolean;
}

export interface AgentSprite {
  label: string;
  /** Tailwind text colour class; matches the status dot's background colour. */
  colorClass: string;
  /** One frame is a still; two frames alternate. */
  frames: SpriteRun[][];
  /** Frame length in seconds when there are two frames. */
  frameSeconds: number;
  /** Pulse the symbol, like the dot's animate-pulse. */
  pulseSymbol: boolean;
  /** Fade the whole sprite in and out. */
  fade: boolean;
}

/** Turns a pixel map into horizontal runs of the same colour. */
export function toRuns(map: string[], palette: Record<string, string> = PALETTE): SpriteRun[] {
  const runs: SpriteRun[] = [];
  map.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      if (key === '.' || !(key in palette)) {
        x++;
        continue;
      }
      let w = 1;
      while (row[x + w] === key) w++;
      runs.push({ x, y, w, key, fill: palette[key], symbol: key === 'c' && x >= 6 });
      x += w;
    }
  });
  return runs;
}

function sprite(label: string, colorClass: string, maps: string[][], opts: Partial<Pick<AgentSprite, 'frameSeconds' | 'pulseSymbol' | 'fade'>> = {}): AgentSprite {
  return {
    label,
    colorClass,
    frames: maps.map((map) => toRuns(map)),
    frameSeconds: opts.frameSeconds ?? 0.5,
    pulseSymbol: opts.pulseSymbol ?? false,
    fade: opts.fade ?? false,
  };
}

export const AGENT_SPRITES: Record<AgentSpriteState, AgentSprite> = {
  working: sprite('Working', 'text-primary', [TYPE_A, TYPE_B], { frameSeconds: 0.4 }),
  // Covers questions as well as permissions, like the sidebar's "Needs you" filter.
  permission: sprite('Waiting for you', 'text-amber-500', [withSymbol(SIT, QUESTION)], { pulseSymbol: true }),
  unread: sprite('Finished a turn', 'text-green-400', [WAVE_A, WAVE_B], { frameSeconds: 0.45 }),
  ready: sprite('Ready', 'text-green-500', [SIT]),
  stopped: sprite('Stopped', 'text-neutral-500', [withSymbol(ASLEEP, ZZZ)]),
  // Still open, agent shut down until it is opened: a dimmed Ready.
  sleeping: sprite('Sleeping', 'text-green-500/50', [withSymbol(ASLEEP, ZZZ)]),
  error: sprite('Error', 'text-red-500', [withSymbol(SIT, BANG)]),
  starting: sprite('Starting', 'text-yellow-500', [WALK_A, WALK_B], { frameSeconds: 0.35 }),
  installing: sprite('Installing dependencies', 'text-yellow-500', [WALK_A, WALK_B], { frameSeconds: 0.35 }),
  removing: sprite('Removing', 'text-muted-foreground', [ASLEEP], { fade: true }),
  allowed: sprite('Allowed', 'text-green-400', [withSymbol(SIT, CHECK)]),
  denied: sprite('Denied', 'text-destructive', [withSymbol(SIT, CROSS)]),
  asking: sprite('Asking you a question', 'text-cyan-400', [withSymbol(SIT, QUESTION)], { pulseSymbol: true }),
  answered: sprite('Answered', 'text-blue-400', [withSymbol(SIT, BUBBLE)]),
};

/** Exported for tests: every pose map, so their sizes can be checked. */
export const SPRITE_MAPS = { SIT, TYPE_A, TYPE_B, ASLEEP, WAVE_A, WAVE_B, WALK_A, WALK_B };

// Scenery for the empty states: a park bench and an unlit lamp post, and
// each workspace tab's own props, which stand in for the lamp.
export const SCENERY_PALETTE: Record<string, string> = {
  w: '#8a6a4a', // wood
  W: '#6a5040', // dark wood
  m: '#57534e', // metal
  o: '#3f3f46', // unlit lamp
  g: '#6b7f8e', // watering can
  G: '#4f5f6b', // watering can, shaded
  l: '#5ab868', // leaf, the tree's middle green
  r: '#c2553d', // flag cloth, muted so it doesn't read as an error
  p: '#d6d3d1', // paper
  b: '#4a7aaa', // page title bar, the background pixels' blue
  k: '#a8a29e', // page content
};

export const BENCH = ['WWWWWWWWWWWW', '.w........w.', 'wwwwwwwwwwww', '.W........W.', '.W........W.'];
export const LAMP = ['mmm', '.o.', 'mmm', '.m.', '.m.', '.m.', '.m.', '.m.', '.m.', '.m.', 'mmm'];

/** The workspace tabs whose empty states have their own props. */
export type GroveTab = 'changes' | 'checkpoints' | 'preview';

// Changes: a watering can by a sprout, for the agent tending your files.
export const WATERING_CAN = ['....GGG.', '...G...G', 'g..ggggg', '.g.ggggg', '..gggggg', '...GGGGG'];
export const SPROUT = ['l.l', '.l.', '.l.'];
// Checkpoints: a flag on a pole, as in a game.
export const FLAG = [
  '.m....', '.mrrrr', '.mrrr.', '.mrrrr', '.m....', '.m....',
  '.m....', '.m....', '.m....', '.m....', 'mmm...',
];
// Preview: an easel holding a small web page.
export const EASEL = [
  '....W....', 'WWWWWWWWW', 'WbbbbbbbW', 'WpkkkkppW', 'WpppppppW', 'WpkkpkkpW',
  'WWWWWWWWW', '.W..W..W.', '.W..W..W.', 'W...W...W', 'W...W...W',
];

/** Exported for tests: every scenery map, so their sizes and colours can be checked. */
export const SCENERY_MAPS = { BENCH, LAMP, WATERING_CAN, SPROUT, FLAG, EASEL };
