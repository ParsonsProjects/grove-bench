import { describe, it, expect } from 'vitest';
import { isCovered, sameBounds, samplePoints, toBounds } from './preview-viewport.js';

describe('toBounds', () => {
  it('rounds to whole pixels', () => {
    expect(toBounds({ left: 10.4, top: 20.6, width: 300.5, height: 199.4 })).toEqual({ x: 10, y: 21, width: 301, height: 199 });
  });

  it('returns null for an empty box (hidden tab or pane)', () => {
    expect(toBounds({ left: 0, top: 0, width: 0, height: 0 })).toBeNull();
    expect(toBounds({ left: 5, top: 5, width: 100, height: 0 })).toBeNull();
  });
});

describe('sameBounds', () => {
  it('compares by value and handles null', () => {
    expect(sameBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })).toBe(true);
    expect(sameBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 })).toBe(false);
    expect(sameBounds(null, null)).toBe(true);
    expect(sameBounds(null, { x: 0, y: 0, width: 1, height: 1 })).toBe(false);
  });
});

describe('samplePoints', () => {
  it('spreads a grid inside the box, inset from the edges', () => {
    const pts = samplePoints({ x: 100, y: 50, width: 206, height: 106 }, 3, 2, 3);
    expect(pts).toEqual([[103, 53], [203, 53], [303, 53], [103, 153], [203, 153], [303, 153]]);
  });
});

describe('isCovered', () => {
  const bounds = { x: 0, y: 0, width: 800, height: 600 };

  it('is false when every point hits the host or its children', () => {
    const host = document.createElement('div');
    const child = document.createElement('img');
    host.appendChild(child);
    expect(isCovered(bounds, host, (x) => (x < 400 ? host : child))).toBe(false);
  });

  it('is true when anything else is on top at any point', () => {
    const host = document.createElement('div');
    const menu = document.createElement('div');
    // A small dropdown near the bottom-left corner.
    expect(isCovered(bounds, host, (x, y) => (x < 120 && y > 480 ? menu : host))).toBe(true);
  });

  it('ignores points that hit nothing', () => {
    const host = document.createElement('div');
    expect(isCovered(bounds, host, () => null)).toBe(false);
  });
});
