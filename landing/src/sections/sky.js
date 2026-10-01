// Pixel sun and moon for the day-into-night pages.

export const SUN = [
  '...yyyyy...',
  '..yhhyyyy..',
  '.yhhyyyyyy.',
  'yhhyyyyyyyy',
  'yhyyyyyyyyy',
  'yyyyyyyyyyy',
  'yyyyyyyyyyo',
  'yyyyyyyyyyo',
  '.yyyyyyyyo.',
  '..yyyyyoo..',
  '...ooooo...',
];
export const SUN_COLORS = { y: '#ffcf6e', h: '#fff1c4', o: '#f2a74b' };

export const MOON = [
  '...mmmmm...',
  '..mmmmmmm..',
  '.mmmsmmmmm.',
  'mmmsssmmmmm',
  'mmmmsmmmmmm',
  'mmmmmmmmsmm',
  'mmmmmmmmmmd',
  'mmsmmmmmmmd',
  '.mmmmmmmdd.',
  '..mmmmmdd..',
  '...ddddd...',
];
export const MOON_COLORS = { m: '#f4f1ff', s: '#d9d3f3', d: '#c9c2ec' };

/**
 * The sky behind each band, top and bottom (the same colours as day.css).
 * The nav reads this to match whatever is behind it.
 */
export const BANDS = [
  ['b-hero', '#fffdf7', '#fdf7ea'],
  ['b-founder', '#fdf7ea', '#faefd9'],
  ['b-features', '#faefd9', '#f7e3c4'],
  ['b-steps', '#f7e3c4', '#f3cda5'],
  ['b-free', '#f3cda5', '#eaa682'],
  ['b-sunset', '#eaa682', '#4b3f78'],
  ['b-dusk', '#4b3f78', '#232750'],
  ['b-night', '#232750', '#0c1224'],
  ['b-foot', '#090e1c', '#090e1c'],
];
