import { PALETTE } from './brand.js';

/**
 * The Grove Bench pixel tree, the logo (BRAND.md): 2px pixels with 1px gaps
 * on a 3px grid, in a 21x24 box. Its colours are the brand palette's leaves,
 * bark and root.
 */
export const PIXEL_TREE_W = 21;
export const PIXEL_TREE_H = 24;

export const PIXEL_TREE: { x: number; y: number; fill: string }[] = [
  { x: 9, y: 0, fill: PALETTE.sprout },
  { x: 6, y: 3, fill: PALETTE.leaf },
  { x: 9, y: 3, fill: PALETTE.leaf },
  { x: 12, y: 3, fill: PALETTE.leaf },
  { x: 3, y: 6, fill: PALETTE.moss },
  { x: 6, y: 6, fill: PALETTE.moss },
  { x: 9, y: 6, fill: PALETTE.moss },
  { x: 12, y: 6, fill: PALETTE.moss },
  { x: 15, y: 6, fill: PALETTE.moss },
  { x: 0, y: 9, fill: PALETTE.fern },
  { x: 3, y: 9, fill: PALETTE.fern },
  { x: 6, y: 9, fill: PALETTE.fern },
  { x: 9, y: 9, fill: PALETTE.fern },
  { x: 12, y: 9, fill: PALETTE.fern },
  { x: 15, y: 9, fill: PALETTE.fern },
  { x: 18, y: 9, fill: PALETTE.fern },
  { x: 3, y: 12, fill: PALETTE.fern },
  { x: 6, y: 12, fill: PALETTE.fern },
  { x: 9, y: 12, fill: PALETTE.fern },
  { x: 12, y: 12, fill: PALETTE.fern },
  { x: 15, y: 12, fill: PALETTE.fern },
  { x: 9, y: 15, fill: PALETTE.bark },
  { x: 9, y: 18, fill: PALETTE.bark },
  { x: 6, y: 21, fill: PALETTE.root },
  { x: 9, y: 21, fill: PALETTE.root },
  { x: 12, y: 21, fill: PALETTE.root },
];
