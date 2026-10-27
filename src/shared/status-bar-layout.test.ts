import { describe, it, expect } from 'vitest';
import {
  STATUS_BAR_PART_IDS,
  defaultStatusBarLayout,
  isDefaultStatusBarLayout,
  moveStatusBarPart,
  normalizeStatusBarLayout,
  setStatusBarPartShown,
  stepStatusBarPart,
  type StatusBarPart,
} from './status-bar-layout.js';

/** A layout as "side:id" strings, hidden parts marked with a minus. */
const shape = (layout: readonly StatusBarPart[]) =>
  layout.map((p) => `${p.side}:${p.shown ? '' : '-'}${p.id}`);

describe('defaultStatusBarLayout', () => {
  it('shows every part, Context and Keys on the right', () => {
    expect(shape(defaultStatusBarLayout())).toEqual([
      'left:agent', 'left:activity', 'left:thread-items', 'left:last-turn',
      'left:capabilities', 'left:branch', 'right:context', 'right:keys',
    ]);
  });

  it('hands out a fresh copy each time', () => {
    const a = defaultStatusBarLayout();
    a[0].shown = false;
    expect(defaultStatusBarLayout()[0].shown).toBe(true);
  });
});

describe('normalizeStatusBarLayout', () => {
  it('uses the default for anything that is not a list', () => {
    for (const saved of [undefined, null, 'agent', 3, { agent: true }]) {
      expect(normalizeStatusBarLayout(saved)).toEqual(defaultStatusBarLayout());
    }
  });

  it('keeps a saved order, side and hidden parts', () => {
    const saved = [
      { id: 'branch', side: 'left', shown: true },
      { id: 'agent', side: 'left', shown: true },
      { id: 'keys', side: 'left', shown: false },
      { id: 'activity', side: 'right', shown: true },
      { id: 'thread-items', side: 'left', shown: true },
      { id: 'last-turn', side: 'left', shown: true },
      { id: 'capabilities', side: 'left', shown: true },
      { id: 'context', side: 'right', shown: true },
    ];
    expect(shape(normalizeStatusBarLayout(saved))).toEqual([
      'left:branch', 'left:agent', 'left:-keys', 'left:thread-items',
      'left:last-turn', 'left:capabilities', 'right:activity', 'right:context',
    ]);
  });

  it('drops unknown parts and repeats, and adds missing parts at the end of their default side', () => {
    const saved = [
      { id: 'keys', side: 'left', shown: true },
      { id: 'clock', side: 'left', shown: true },
      { id: 'keys', side: 'right', shown: false },
      'activity',
      null,
    ];
    const layout = normalizeStatusBarLayout(saved);
    expect(layout.map((p) => p.id).sort()).toEqual([...STATUS_BAR_PART_IDS].sort());
    expect(shape(layout)).toEqual([
      'left:keys', 'left:agent', 'left:activity', 'left:thread-items', 'left:last-turn',
      'left:capabilities', 'left:branch', 'right:context',
    ]);
  });

  it('falls back to the default side and shows a part unless it says otherwise', () => {
    const layout = normalizeStatusBarLayout([{ id: 'context', side: 'up' }, { id: 'keys', side: 'left', shown: 'no' }]);
    expect(layout.find((p) => p.id === 'context')).toEqual({ id: 'context', side: 'right', shown: true });
    expect(layout.find((p) => p.id === 'keys')).toEqual({ id: 'keys', side: 'left', shown: true });
  });

  it('always shows the agent settings', () => {
    const layout = normalizeStatusBarLayout([{ id: 'agent', side: 'right', shown: false }]);
    expect(layout.find((p) => p.id === 'agent')).toEqual({ id: 'agent', side: 'right', shown: true });
  });

  it('lists the left side first', () => {
    const layout = normalizeStatusBarLayout([{ id: 'keys', side: 'right' }, { id: 'agent', side: 'left' }]);
    const sides = layout.map((p) => p.side);
    expect(sides.lastIndexOf('left')).toBeLessThan(sides.indexOf('right'));
  });
});

describe('isDefaultStatusBarLayout', () => {
  it('is true only for the default order, sides and visibility', () => {
    expect(isDefaultStatusBarLayout(defaultStatusBarLayout())).toBe(true);
    expect(isDefaultStatusBarLayout(setStatusBarPartShown(defaultStatusBarLayout(), 'keys', false))).toBe(false);
    expect(isDefaultStatusBarLayout(stepStatusBarPart(defaultStatusBarLayout(), 'keys', -1))).toBe(false);
    expect(isDefaultStatusBarLayout(moveStatusBarPart(defaultStatusBarLayout(), 'keys', 'left', null))).toBe(false);
  });
});

describe('moveStatusBarPart', () => {
  it('moves a part before another on the same side', () => {
    const layout = moveStatusBarPart(defaultStatusBarLayout(), 'branch', 'left', 'activity');
    expect(layout.filter((p) => p.side === 'left').map((p) => p.id)).toEqual([
      'agent', 'branch', 'activity', 'thread-items', 'last-turn', 'capabilities',
    ]);
  });

  it('moves a part to the other side, before a part or at its end', () => {
    const before = moveStatusBarPart(defaultStatusBarLayout(), 'activity', 'right', 'keys');
    expect(shape(before).slice(-3)).toEqual(['right:context', 'right:activity', 'right:keys']);
    const end = moveStatusBarPart(defaultStatusBarLayout(), 'context', 'left', null);
    expect(shape(end)).toEqual([
      'left:agent', 'left:activity', 'left:thread-items', 'left:last-turn',
      'left:capabilities', 'left:branch', 'left:context', 'right:keys',
    ]);
  });

  it('keeps a hidden part hidden as it moves', () => {
    const hidden = setStatusBarPartShown(defaultStatusBarLayout(), 'keys', false);
    expect(moveStatusBarPart(hidden, 'keys', 'left', 'agent')[0]).toEqual({ id: 'keys', side: 'left', shown: false });
  });

  it('leaves the layout as it was when dropped on itself or given an unknown part', () => {
    const layout = defaultStatusBarLayout();
    expect(moveStatusBarPart(layout, 'branch', 'left', 'branch')).toEqual(layout);
    expect(moveStatusBarPart(layout, 'clock' as never, 'left', null)).toEqual(layout);
  });
});

describe('stepStatusBarPart', () => {
  it('moves a part one place up or down its side', () => {
    expect(shape(stepStatusBarPart(defaultStatusBarLayout(), 'activity', -1)).slice(0, 2)).toEqual(['left:activity', 'left:agent']);
    expect(shape(stepStatusBarPart(defaultStatusBarLayout(), 'agent', 1)).slice(0, 2)).toEqual(['left:activity', 'left:agent']);
  });

  it('crosses from the end of the left side to the top of the right, and back', () => {
    const down = stepStatusBarPart(defaultStatusBarLayout(), 'branch', 1);
    expect(shape(down).slice(-3)).toEqual(['right:branch', 'right:context', 'right:keys']);
    const up = stepStatusBarPart(down, 'branch', -1);
    expect(up).toEqual(defaultStatusBarLayout());
  });

  it('crosses into an empty right side', () => {
    let layout = moveStatusBarPart(defaultStatusBarLayout(), 'context', 'left', null);
    layout = moveStatusBarPart(layout, 'keys', 'left', null);
    expect(shape(stepStatusBarPart(layout, 'keys', 1)).at(-1)).toBe('right:keys');
  });

  it('stays put at either end', () => {
    const layout = defaultStatusBarLayout();
    expect(stepStatusBarPart(layout, 'agent', -1)).toEqual(layout);
    expect(stepStatusBarPart(layout, 'keys', 1)).toEqual(layout);
  });
});

describe('setStatusBarPartShown', () => {
  it('hides and shows a part where it is', () => {
    const hidden = setStatusBarPartShown(defaultStatusBarLayout(), 'branch', false);
    expect(shape(hidden)[5]).toBe('left:-branch');
    expect(setStatusBarPartShown(hidden, 'branch', true)).toEqual(defaultStatusBarLayout());
  });

  it('will not hide the agent settings', () => {
    expect(setStatusBarPartShown(defaultStatusBarLayout(), 'agent', false)[0].shown).toBe(true);
  });
});
