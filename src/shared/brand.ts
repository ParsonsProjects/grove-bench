/**
 * The Grove Bench brand in one place: the named colours of the grove, the
 * fonts, and the colour each thread status wears. The app theme
 * (styles/globals.css) and the landing page (landing/src/lib/brand.js) both
 * take their colours from here; brand.test.ts fails if globals.css drifts.
 * BRAND.md says when to use each one.
 */

/** The named colours. Every colour in the theme is one of these or a step
 *  between them. */
export const PALETTE = {
  // The pixel tree's leaves, top (new growth) to bottom.
  sprout: '#6ec87a',
  leaf: '#5ab868', // primary, dark theme
  moss: '#4aaa58',
  fern: '#3a9a48',
  // Leaf darkened until white text reads on it (5.6:1).
  forest: '#257635', // primary, light theme
  // Darkest green: text on a leaf-green fill (7.3:1).
  canopy: '#091a0d',

  // The pixel tree's trunk and roots.
  bark: '#8a6a4a',
  root: '#6a5040',

  // Sky and sun, the other two colours of the grove scene.
  sky: '#52adef', // dark theme
  skyDeep: '#1469bc', // light theme
  sun: '#f59e0b', // dark theme
  sunDeep: '#b45309', // light theme

  // Errors. Dark is VS Code's error red; light is deep enough for text.
  ember: '#f14c4c',
  emberDeep: '#c72e0f',
  // Text on an ember fill in the dark theme: white on ember is only 3.6:1.
  cinder: '#250e0d',
} as const;

/** Neutrals: the bench at night (dark theme) and paper in daylight (light
 *  theme). Both lean a little warm, towards the bench's wood, so they read
 *  as Grove's rather than a stock grey. */
export const NIGHT = {
  sidebar: '#13110f',
  background: '#191815',
  card: '#201e1b',
  border: '#272522',
  muted: '#2b2825',
  input: '#383531',
  subtle: '#898680', // sidebar text
  mutedForeground: '#9f9b95',
  foreground: '#d3d1cc',
  bright: '#f6f5f2', // dialog text
  accent: '#233323', // hover and selection: a moss tint
} as const;

export const PAPER = {
  background: '#fefdfa',
  card: '#f9f8f4',
  border: '#e5e3de',
  muted: '#eae8e3',
  input: '#cdcac4',
  subtle: '#76706a',
  mutedForeground: '#68625b',
  foreground: '#393530',
  ink: '#221e1a', // strongest text
  accent: '#d3edd3', // hover and selection: a moss tint
} as const;

export type ThemeName = 'dark' | 'light';

/**
 * What each thread status colour means, and its colour in each theme. The
 * sidebar's filter chips, the status dots and the grove characters all wear
 * these. Blue is in progress (and moves); green is done, as it is for a
 * passing check or a copied tick, and is also the colour of an action.
 */
export const STATUS = {
  working: { label: 'Working', dark: PALETTE.sky, light: PALETTE.skyDeep },
  attention: { label: 'Needs you', dark: PALETTE.sun, light: PALETTE.sunDeep },
  unread: { label: 'Finished a turn', dark: PALETTE.leaf, light: PALETTE.forest },
  error: { label: 'Error', dark: PALETTE.ember, light: PALETTE.emberDeep },
} as const;

export type StatusTone = keyof typeof STATUS;

/** Typefaces. Both ship with the app (fontsource, SIL Open Font License),
 *  so they look the same on every machine. */
export const FONTS = {
  /** Everything: UI, code, terminal. */
  mono: "'JetBrains Mono Variable', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  /** Brand moments only: the wordmark, empty-state titles, the landing page. */
  pixel: "'Pixelify Sans Variable', 'Pixelify Sans', monospace",
} as const;
