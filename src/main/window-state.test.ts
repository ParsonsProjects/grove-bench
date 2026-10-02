import { describe, it, expect } from 'vitest';
import { keepOnScreen } from './window-state.js';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 2560, height: 1400 };

describe('keepOnScreen', () => {
  it('keeps a position that is on a display', () => {
    const state = { x: 100, y: 100, width: 1400, height: 900 };
    expect(keepOnScreen(state, [primary])).toEqual(state);
  });

  it('keeps a position on a second display', () => {
    const state = { x: 2000, y: 50, width: 1400, height: 900 };
    expect(keepOnScreen(state, [primary, right])).toEqual(state);
  });

  it('drops the position when its display is gone', () => {
    const state = { x: 2000, y: 50, width: 1400, height: 900, isMaximized: false };
    expect(keepOnScreen(state, [primary])).toEqual({ width: 1400, height: 900, isMaximized: false });
  });

  it('drops the position when the title bar is above or below every display', () => {
    expect(keepOnScreen({ x: 100, y: -500, width: 1400, height: 900 }, [primary])).toEqual({ width: 1400, height: 900 });
    expect(keepOnScreen({ x: 100, y: 1030, width: 1400, height: 900 }, [primary])).toEqual({ width: 1400, height: 900 });
  });

  it('tolerates a snapped window a few pixels past the edge', () => {
    const state = { x: -7, y: -7, width: 960, height: 1047 };
    expect(keepOnScreen(state, [primary])).toEqual(state);
  });

  it('drops a position that is not a number', () => {
    const state = { x: 'a' as unknown as number, y: 10, width: 1400, height: 900 };
    expect(keepOnScreen(state, [primary])).toEqual({ width: 1400, height: 900 });
  });

  it('leaves a state without a position alone', () => {
    expect(keepOnScreen({ width: 1400, height: 900 }, [primary])).toEqual({ width: 1400, height: 900 });
  });
});
