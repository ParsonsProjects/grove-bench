import { describe, it, expect } from 'vitest';
import { SHORTCUT_GROUPS, formatShortcut } from './shortcut-list.js';
import { GROVE_WINDOW_SHORTCUTS } from '../../shared/grove-shortcuts.js';
import { TAB_BY_KEY } from './keyboard-shortcuts.js';

const rows = SHORTCUT_GROUPS.flatMap((g) => g.rows);
const same = (a: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }, b: typeof a) =>
  a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt;

describe('SHORTCUT_GROUPS', () => {
  it('lists every window shortcut', () => {
    for (const s of GROVE_WINDOW_SHORTCUTS) {
      expect(rows.some((r) => same(r.key, s)), formatShortcut(s)).toBe(true);
    }
  });

  it('labels each tab shortcut with the tab it opens', () => {
    const tabs = SHORTCUT_GROUPS.find((g) => g.title === 'Tabs')!.rows;
    expect(tabs.map((r) => `${formatShortcut(r.key)} ${r.label}`)).toEqual([
      'Alt+1 Thread tab',
      'Alt+2 Changes tab',
      'Alt+3 Checkpoints tab',
      'Alt+4 Terminal tab',
      'Alt+5 Preview tab',
    ]);
    expect(tabs).toHaveLength(Object.keys(TAB_BY_KEY).length);
  });

  it('has no shortcut twice', () => {
    const combos = rows.map((r) => formatShortcut(r.key));
    expect(new Set(combos).size).toBe(combos.length);
  });

  it('reads the agent control keys from CONTROL_SHORTCUTS', () => {
    const agent = SHORTCUT_GROUPS.find((g) => g.title === 'Agent')!.rows;
    expect(agent.map((r) => `${formatShortcut(r.key)} ${r.label}`)).toEqual([
      'Alt+M Cycle mode',
      'Alt+T Toggle thinking',
      'Alt+E Cycle effort level',
    ]);
  });
});

describe('formatShortcut', () => {
  it.each([
    [{ key: 't', ctrl: true, shift: true }, 'Ctrl+Shift+T'],
    [{ key: '1', alt: true }, 'Alt+1'],
    [{ key: 'f1' }, 'F1'],
    [{ key: ',', ctrl: true }, 'Ctrl+,'],
  ])('%o -> %s', (k, out) => {
    expect(formatShortcut(k)).toBe(out);
  });
});
