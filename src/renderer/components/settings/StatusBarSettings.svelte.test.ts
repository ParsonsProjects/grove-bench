import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/svelte';

import StatusBarSettings from './StatusBarSettings.svelte';
import { settingsStore } from '../../stores/settings.svelte.js';
import { defaultStatusBarLayout, moveStatusBarPart, type StatusBarPart } from '../../../shared/status-bar-layout.js';

beforeEach(() => {
  settingsStore.draft = { ...settingsStore.draft, statusBarLayout: defaultStatusBarLayout() };
});

afterEach(cleanup);

const layout = () => settingsStore.draft.statusBarLayout;
/** The parts on a side, as their ids. */
const side = (s: 'left' | 'right') => layout().filter((p) => p.side === s).map((p) => p.id);
const list = (s: 'left' | 'right') => screen.getByTestId(`status-bar-${s}`);
const row = (id: string) => document.querySelector<HTMLElement>(`[data-part="${id}"]`)!;

/** jsdom has no DragEvent or layout: a drag event carrying the pointer's
 *  height, and rows 40px tall stacked from the top of each list. */
async function drag(type: string, target: HTMLElement, clientY = 0, setData = vi.fn()) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'dataTransfer', { value: { setData, effectAllowed: '', dropEffect: '' } });
  await fireEvent(target, event);
}

function stackRows() {
  for (const s of ['left', 'right'] as const) {
    list(s).querySelectorAll<HTMLElement>('[data-part]').forEach((el, i) => {
      el.getBoundingClientRect = () => ({ top: i * 40, height: 40, bottom: i * 40 + 40, left: 0, right: 200, width: 200, x: 0, y: i * 40, toJSON: () => ({}) });
    });
  }
}

describe('StatusBarSettings', () => {
  it('lists each side of the bar in order', () => {
    render(StatusBarSettings);
    const names = (s: 'left' | 'right') =>
      within(list(s)).getAllByRole('button', { name: /^Move / }).map((b) => b.getAttribute('aria-label'));
    expect(names('left')).toEqual([
      'Move Agent settings', 'Move Activity', 'Move Tasks and Files', 'Move Last turn', 'Move MCP and Skills', 'Move Project and branch',
    ]);
    expect(names('right')).toEqual(['Move Context', 'Move Keys']);
  });

  it('hides a part when unticked, and keeps the agent settings shown', async () => {
    render(StatusBarSettings);
    await fireEvent.click(within(row('keys')).getByRole('checkbox'));
    expect(layout().find((p) => p.id === 'keys')?.shown).toBe(false);
    expect(within(row('agent')).getByRole('checkbox')).toBeDisabled();
  });

  it('drops a dragged part before the row under the pointer', async () => {
    render(StatusBarSettings);
    stackRows();
    await drag('dragstart', row('keys'));
    // The upper half of the second row on the left: Activity.
    await drag('dragover', row('activity'), 45);
    await drag('drop', row('activity'), 45);
    expect(side('left')).toEqual(['agent', 'keys', 'activity', 'thread-items', 'last-turn', 'capabilities', 'branch']);
    expect(side('right')).toEqual(['context']);
  });

  it('carries the part as its own data type, not text a text field would take', async () => {
    render(StatusBarSettings);
    const setData = vi.fn();
    await drag('dragstart', row('keys'), 0, setData);
    expect(setData).toHaveBeenCalledWith('application/x-grove-status-bar-part', 'keys');
    expect(setData).not.toHaveBeenCalledWith('text/plain', expect.anything());
  });

  it('drops at the end of a side below its last row', async () => {
    render(StatusBarSettings);
    stackRows();
    await drag('dragstart', row('activity'));
    await drag('dragover', list('right'), 500);
    await drag('drop', list('right'), 500);
    expect(side('right')).toEqual(['context', 'keys', 'activity']);
  });

  it('takes drops on a side left empty', async () => {
    let start: StatusBarPart[] = moveStatusBarPart(defaultStatusBarLayout(), 'context', 'left', null);
    start = moveStatusBarPart(start, 'keys', 'left', null);
    settingsStore.draft = { ...settingsStore.draft, statusBarLayout: start };
    render(StatusBarSettings);
    expect(within(list('right')).getByText('Drag a part here')).toBeInTheDocument();
    await drag('dragstart', row('keys'));
    await drag('dragover', list('right'));
    await drag('drop', list('right'));
    expect(side('right')).toEqual(['keys']);
  });

  it('ignores a drop that did not start from a part', async () => {
    render(StatusBarSettings);
    await drag('dragover', list('right'));
    await drag('drop', list('right'));
    expect(layout()).toEqual(defaultStatusBarLayout());
  });

  it('moves a part from the keyboard, across sides, keeping focus on its handle', async () => {
    render(StatusBarSettings);
    const handle = screen.getByRole('button', { name: 'Move Project and branch' });
    handle.focus();
    await fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(side('right')).toEqual(['branch', 'context', 'keys']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Project and branch' }));
    expect(screen.getByText('Project and branch: Right, 1 of 3')).toBeInTheDocument();
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(layout()).toEqual(defaultStatusBarLayout());
  });

  it('says when a part is already at either end, each time, and leaves the layout alone', async () => {
    render(StatusBarSettings);
    const first = screen.getByRole('button', { name: 'Move Agent settings' });
    await fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(await screen.findByText('Agent settings is already first')).toBeInTheDocument();
    // Cleared and said again, so a screen reader reads the second press too.
    const live = screen.getByText('Agent settings is already first');
    const said: string[] = [];
    const watcher = new MutationObserver(() => said.push(live.textContent ?? ''));
    watcher.observe(live, { childList: true, characterData: true, subtree: true });
    await fireEvent.keyDown(first, { key: 'ArrowUp' });
    await screen.findByText('Agent settings is already first');
    watcher.disconnect();
    expect(said).toContain('');
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Move Keys' }), { key: 'ArrowDown' });
    expect(await screen.findByText('Keys is already last')).toBeInTheDocument();
    expect(layout()).toEqual(defaultStatusBarLayout());
  });

  it('resets to the default layout', async () => {
    render(StatusBarSettings);
    const reset = screen.getByRole('button', { name: 'Reset' });
    expect(reset).toBeDisabled();
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Move Keys' }), { key: 'ArrowUp' });
    expect(reset).toBeEnabled();
    await fireEvent.click(reset);
    expect(layout()).toEqual(defaultStatusBarLayout());
  });
});
