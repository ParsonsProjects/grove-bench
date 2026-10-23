import { describe, it, expect } from 'vitest';
import { meterCells } from './pixel-meter.js';

describe('meterCells', () => {
  it('is all empty at 0% and all full at 100%', () => {
    expect(meterCells(0, 10)).toEqual(Array(10).fill('empty'));
    expect(meterCells(100, 10)).toEqual(Array(10).fill('full'));
  });

  it('fills whole blocks and part-lights the one the percent is inside', () => {
    expect(meterCells(62, 10)).toEqual([...Array(6).fill('full'), 'part', ...Array(3).fill('empty')]);
  });

  it('fills a block exactly at its end, with no part-lit block after it', () => {
    expect(meterCells(90, 10)).toEqual([...Array(9).fill('full'), 'empty']);
    expect(meterCells(25, 20)).toEqual([...Array(5).fill('full'), ...Array(15).fill('empty')]);
  });

  it('shows any use at all', () => {
    expect(meterCells(0.5, 10)[0]).toBe('part');
  });
});
