// Colour helpers and the grove palette.
//
// Every colour here is derived from the brand: the tree greens and trunk
// browns of the pixel logo, the blue primary, the status colours and the
// neutral greys of the app theme. Sky palettes are interpolations between the
// primary blue and the permission amber in OKLab.

import { treeGreens, statusColors } from '../lib/brand.js';

// ---------------------------------------------------------------------------
// Conversions (sRGB <-> OKLab / OKLCH)

/** @param {string} hex */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @param {number[]} rgb */
export function rgbToHex([r, g, b]) {
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);

/** @param {number[]} rgb @returns {number[]} [L, a, b] */
export function rgbToOklab([r, g, b]) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** @param {number[]} lab @returns {number[]} rgb */
export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** OKLCH to hex. */
export function oklch(L, C, h) {
  const r = (h * Math.PI) / 180;
  return rgbToHex(oklabToRgb([L, C * Math.cos(r), C * Math.sin(r)]));
}

/** Mix two hex colours in OKLab. */
export function mix(a, b, t) {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  return rgbToHex(oklabToRgb(A.map((v, i) => v + (B[i] - v) * t)));
}

/** Shift lightness (dL) and hue (dh, degrees) of a hex colour. */
export function adjust(hex, dL = 0, dh = 0, cScale = 1) {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  const C = Math.hypot(a, b) * cScale;
  const h = Math.atan2(b, a) + (dh * Math.PI) / 180;
  return rgbToHex(oklabToRgb([L + dL, C * Math.cos(h), C * Math.sin(h)]));
}

/** "#rrggbb" + alpha to an rgba() string. */
export function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// Brand base colours

const PRIMARY_HUE = 254.624;
export const primary = oklch(0.541, 0.181, PRIMARY_HUE); // statusColors.working
export const amber = statusColors.permission;
export const green = statusColors.ready;

const leafFills = [...new Set(treeGreens.filter((p) => p.y < 15).map((p) => p.fill))];
// ['#6ec87a', '#5ab868', '#4aaa58', '#3a9a48'] light to dark
export const leaves = leafFills;
export const woodLight = '#8a6a4a';
export const woodDark = '#6a5040';

export const C = {
  primary,
  primaryLight: oklch(0.7, 0.14, PRIMARY_HUE),
  primaryPale: oklch(0.87, 0.07, PRIMARY_HUE),
  screen: oklch(0.78, 0.11, PRIMARY_HUE - 20),
  amber,
  amberLight: mix(amber, '#ffffff', 0.45),
  green,
  greenLight: mix(green, '#ffffff', 0.4),
  leafTop: leaves[0],
  leafDeep: mix(leaves[3], '#101a14', 0.45),
  leafSeam: mix(leaves[3], '#101a14', 0.2),
  firefly: mix(leaves[0], '#fff6c8', 0.55),
  wood: woodLight,
  woodDark,
  woodDeep: mix(woodDark, '#141010', 0.45),
  woodPale: mix(woodLight, '#ffffff', 0.3),
  cream: mix(woodLight, '#ffffff', 0.84),
  ink: '#111111',
  // Stone greys are the app's neutral greys nudged toward the primary hue.
  stoneLight: mix('#a8a8a8', primary, 0.08),
  stone: mix('#797979', primary, 0.08),
  stoneDark: mix('#4a4a4a', primary, 0.1),
  stoneDeep: mix('#2a2a2a', primary, 0.12),
  moss: mix(leaves[3], '#797979', 0.35),
  // Meadow and path.
  grassTop: leaves[1],
  grass: leaves[2],
  grassDark: leaves[3],
  meadow: mix(leaves[3], '#16241c', 0.45),
  meadowDeep: mix(leaves[3], '#0c120f', 0.72),
  path: mix(woodLight, '#c9c9c9', 0.35),
  pathDark: mix(woodDark, '#797979', 0.3),
  pathEdge: mix(woodDark, '#2a2a2a', 0.2),
  skin: mix(mix(woodLight, amber, 0.2), '#ffffff', 0.45),
  skinShade: mix(mix(woodLight, amber, 0.2), '#ffffff', 0.2),
  laptop: mix('#a8a8a8', primary, 0.12),
  laptopEdge: mix('#5a5a5a', primary, 0.15),
  pants: mix('#2a2a2a', primary, 0.25),
  shoes: '#1e1e1e',
};

export const statusHex = {
  working: primary,
  permission: amber,
  ready: green,
};

// Agent looks: hoodie + hair. Hoodies use brand colours.
export const looks = [
  { hoodie: primary, hair: mix(woodDark, '#111111', 0.5) },
  { hoodie: leaves[2], hair: '#1e1e1e' },
  { hoodie: woodLight, hair: mix(woodLight, amber, 0.55) },
  { hoodie: mix(primary, leaves[2], 0.5), hair: mix(woodDark, '#111111', 0.2), beanie: amber },
  { hoodie: '#797979', hair: mix(amber, '#ffffff', 0.5) },
];

/** Per-tree leaf palette with a small hue/lightness variation. */
export function treePalette(dh = 0, dL = 0) {
  const lv = leaves.map((c) => adjust(c, dL, dh));
  return {
    leaves: lv,
    hi: adjust(mix(lv[0], '#fff6c8', 0.35), 0, 0),
    seam: adjust(C.leafSeam, dL * 0.5, dh),
    deep: adjust(C.leafDeep, dL * 0.5, dh),
    trunk: woodLight,
    trunkHi: mix(woodLight, '#ffffff', 0.18),
    trunkLo: woodDark,
    root: woodDark,
    rootLo: C.woodDeep,
  };
}

export const oldTreePalette = (() => {
  const lv = leaves.map((c) => adjust(c, -0.1, 12, 0.8));
  return {
    leaves: lv,
    hi: mix(lv[0], '#dfe8ff', 0.3),
    seam: adjust(C.leafSeam, -0.08, 12),
    deep: adjust(C.leafDeep, -0.06, 12),
    trunk: mix(woodDark, '#797979', 0.2),
    trunkHi: mix(woodLight, '#797979', 0.3),
    trunkLo: C.woodDeep,
    root: C.woodDeep,
    rootLo: mix(C.woodDeep, '#000000', 0.3),
  };
})();

// ---------------------------------------------------------------------------
// Sky and light over the course of the story (tod: 0 night, 0.5 dawn, 1 day)

const lab = (hex) => rgbToOklab(hexToRgb(hex));

const SKY_NIGHT = [
  oklch(0.13, 0.035, 265),
  oklch(0.145, 0.042, 264),
  oklch(0.16, 0.048, 262),
  oklch(0.175, 0.054, 260),
  oklch(0.19, 0.06, 258),
  oklch(0.21, 0.066, 256),
  oklch(0.235, 0.07, PRIMARY_HUE),
  oklch(0.265, 0.074, 252),
].map(lab);

// Blue primary to permission amber, the long way round through violet.
const SKY_DAWN = [
  oklch(0.3, 0.085, 262),
  oklch(0.35, 0.09, 276),
  oklch(0.42, 0.095, 296),
  oklch(0.5, 0.1, 322),
  oklch(0.59, 0.11, 350),
  oklch(0.68, 0.12, 22),
  oklch(0.76, 0.13, 50),
  oklch(0.83, 0.13, 70),
].map(lab);

const SKY_DAY = [
  oklch(0.6, 0.12, PRIMARY_HUE - 2),
  oklch(0.64, 0.115, 250),
  oklch(0.68, 0.105, 247),
  oklch(0.72, 0.095, 244),
  oklch(0.76, 0.083, 240),
  oklch(0.8, 0.07, 234),
  oklch(0.84, 0.056, 226),
  oklch(0.88, 0.042, 214),
].map(lab);

function lerpLab(A, B, t) {
  return A.map((v, i) => v + (B[i] - v) * t);
}

/** Three-key interpolation night -> dawn -> day. */
function keyed(night, dawn, day, tod) {
  if (tod <= 0.5) return lerpLab(night, dawn, tod / 0.5);
  return lerpLab(dawn, day, (tod - 0.5) / 0.5);
}

/** @returns {string[]} hex sky bands top to horizon */
export function skyBands(tod) {
  return SKY_NIGHT.map((n, i) => rgbToHex(oklabToRgb(keyed(n, SKY_DAWN[i], SKY_DAY[i], tod))));
}

const TINT = {
  night: lab(oklch(0.14, 0.05, 264)),
  dawn: lab(oklch(0.34, 0.08, 318)),
  day: lab('#ffffff'),
};

/** The colour and alpha laid over the world layer to light it for the hour. */
export function worldTint(tod) {
  const colour = rgbToHex(oklabToRgb(keyed(TINT.night, TINT.dawn, TINT.day, tod)));
  // 0.5 at night, 0.24 at dawn, 0 by day.
  const alpha = tod <= 0.5 ? 0.5 - (0.26 * tod) / 0.5 : 0.24 * (1 - (tod - 0.5) / 0.5);
  return { colour, alpha };
}

const HILL_FAR = [lab(oklch(0.22, 0.05, 258)), lab(oklch(0.46, 0.07, 300)), lab(oklch(0.7, 0.07, 230))];
const HILL_NEAR = [lab(oklch(0.25, 0.05, 200)), lab(oklch(0.42, 0.06, 170)), lab(oklch(0.58, 0.09, 160))];

/** Distant hill colours (drawn untinted, they sit in the sky's haze). */
export function hillColours(tod) {
  return {
    far: rgbToHex(oklabToRgb(keyed(HILL_FAR[0], HILL_FAR[1], HILL_FAR[2], tod))),
    near: rgbToHex(oklabToRgb(keyed(HILL_NEAR[0], HILL_NEAR[1], HILL_NEAR[2], tod))),
  };
}

const CLOUD = {
  top: [lab(oklch(0.34, 0.05, 262)), lab(oklch(0.86, 0.09, 55)), lab('#ffffff')],
  body: [lab(oklch(0.26, 0.05, 262)), lab(oklch(0.68, 0.1, 350)), lab(oklch(0.95, 0.015, 250))],
  shade: [lab(oklch(0.21, 0.05, 264)), lab(oklch(0.54, 0.09, 318)), lab(oklch(0.86, 0.035, 250))],
};

/** Cloud colours for the hour: moonlit slate, dawn pink, day white. */
export function cloudColours(tod) {
  const pick = (k) => rgbToHex(oklabToRgb(keyed(CLOUD[k][0], CLOUD[k][1], CLOUD[k][2], tod)));
  return { top: pick('top'), body: pick('body'), shade: pick('shade') };
}
