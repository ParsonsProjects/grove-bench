import { describe, it, expect } from 'vitest';
import { iso, roomLayout, TILE_W, TILE_H } from './tycoon-iso.js';

describe('iso', () => {
  it('projects the origin to 0,0', () => {
    expect(iso(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('moves +x down-right and +y down-left', () => {
    expect(iso(1, 0)).toEqual({ x: TILE_W / 2, y: TILE_H / 2 });
    expect(iso(0, 1)).toEqual({ x: -TILE_W / 2, y: TILE_H / 2 });
  });

  it('supports fractional tiles', () => {
    expect(iso(0.5, 0.5)).toEqual({ x: 0, y: TILE_H / 2 });
  });
});

describe('roomLayout', () => {
  it('upgrades the room tier with the session count', () => {
    expect(roomLayout(0).tier.name).toBe('Garage');
    expect(roomLayout(2).tier.name).toBe('Garage');
    expect(roomLayout(3).tier.name).toBe('Startup Office');
    expect(roomLayout(6).tier.name).toBe('Startup Office');
    expect(roomLayout(7).tier.name).toBe('Studio');
    expect(roomLayout(12).tier.name).toBe('Studio');
    expect(roomLayout(13).tier.name).toBe('Studio HQ');
  });

  it('creates one desk per session', () => {
    for (const n of [0, 1, 2, 5, 9, 16]) {
      expect(roomLayout(n).desks).toHaveLength(n);
    }
  });

  it('grows the room to fit the desks', () => {
    const small = roomLayout(1);
    const big = roomLayout(12);
    expect(big.cols).toBeGreaterThan(small.cols);
    expect(big.rows).toBeGreaterThan(small.rows);
  });

  it('keeps every desk footprint inside the room', () => {
    for (const n of [1, 2, 6, 12, 20]) {
      const { desks, cols, rows } = roomLayout(n);
      for (const d of desks) {
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x + 2).toBeLessThanOrEqual(cols); // desk is 2 tiles wide
        expect(d.y).toBeGreaterThanOrEqual(0);
        expect(d.y + 1).toBeLessThanOrEqual(rows);
      }
    }
  });

  it('never overlaps desk positions', () => {
    const { desks } = roomLayout(20);
    const keys = new Set(desks.map((d) => `${d.x},${d.y}`));
    expect(keys.size).toBe(20);
  });

  it('produces a viewBox that contains the whole floor and walls', () => {
    for (const n of [1, 8, 16]) {
      const { cols, rows, viewBox } = roomLayout(n);
      const corners = [iso(0, 0), iso(cols, 0), iso(0, rows), iso(cols, rows)];
      for (const c of corners) {
        expect(c.x).toBeGreaterThanOrEqual(viewBox.x);
        expect(c.x).toBeLessThanOrEqual(viewBox.x + viewBox.w);
        expect(c.y).toBeGreaterThanOrEqual(viewBox.y);
        expect(c.y).toBeLessThanOrEqual(viewBox.y + viewBox.h);
      }
    }
  });
});
