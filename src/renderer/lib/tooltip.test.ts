import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installTooltips, placeTooltip, SHOW_DELAY_MS, WARM_WINDOW_MS } from './tooltip.js';

describe('placeTooltip', () => {
  const viewport = { width: 800, height: 600 };
  const tip = { width: 100, height: 20 };

  it('centres the tooltip under the target', () => {
    expect(placeTooltip({ left: 100, top: 100, width: 40, height: 20 }, tip, viewport))
      .toEqual({ x: 70, y: 124, side: 'bottom' });
  });

  it('flips above when there is no room below', () => {
    expect(placeTooltip({ left: 100, top: 570, width: 40, height: 20 }, tip, viewport))
      .toEqual({ x: 70, y: 546, side: 'top' });
  });

  it('keeps the tooltip inside the viewport edges', () => {
    expect(placeTooltip({ left: 0, top: 0, width: 20, height: 20 }, tip, viewport).x).toBe(4);
    expect(placeTooltip({ left: 790, top: 0, width: 10, height: 20 }, tip, viewport).x).toBe(696);
  });
});

describe('installTooltips', () => {
  let uninstall: () => void;
  let focusVisible = true;
  const tip = () => document.getElementById('grove-tooltip')!;
  const shown = () => !tip().hidden;
  const $ = (id: string) => document.getElementById(id)!;

  function over(el: Element, from: Element | null = null) {
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: from, pointerType: 'mouse' }));
  }
  function out(el: Element, to: Element | null = null) {
    el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: to, pointerType: 'mouse' }));
  }
  function move(from: Element, to: Element) {
    out(from, to);
    over(to, from);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    focusVisible = true;
    document.body.innerHTML = `
      <button id="a" title="Stage this file">Stage</button>
      <button id="b" title="Refresh"><svg></svg></button>
      <div id="row" title="Row info"><span id="inner">text</span><button id="blank" title="">x</button></div>
      <input id="field" title="Search" />
      <span id="clip" style="text-overflow: ellipsis" title="src/lib/file.ts">src/lib/file.ts</span>
      <span id="clip2" style="text-overflow: ellipsis" title="first\nsecond">first</span>
    `;
    uninstall = installTooltips(document, { isFocusVisible: () => focusVisible });
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });

  it('shows after the delay and blanks the title so the native one stays away', () => {
    over($('a'));
    expect($('a').getAttribute('title')).toBe('');
    vi.advanceTimersByTime(SHOW_DELAY_MS - 1);
    expect(shown()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shown()).toBe(true);
    expect(tip().textContent).toBe('Stage this file');
  });

  it('hides and restores the title when the pointer leaves', () => {
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    out($('a'), document.body);
    expect(shown()).toBe(false);
    expect($('a').getAttribute('title')).toBe('Stage this file');
  });

  it('shows the next tooltip at once while warm, then waits again', () => {
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    move($('a'), $('b'));
    expect(shown()).toBe(true);
    expect(tip().textContent).toBe('Refresh');
    expect(tip().hasAttribute('data-instant')).toBe(true);

    out($('b'), document.body);
    vi.advanceTimersByTime(WARM_WINDOW_MS);
    over($('a'));
    expect(shown()).toBe(false);
  });

  it('keeps showing while the pointer moves inside the element', () => {
    over($('row'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    move($('row'), $('inner'));
    expect(shown()).toBe(true);
    expect(tip().textContent).toBe('Row info');
  });

  it('treats an empty title as blocking its ancestors', () => {
    over($('row'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    move($('row'), $('blank'));
    expect(shown()).toBe(false);
    expect($('row').getAttribute('title')).toBe('Row info');
  });

  it('stays hidden after a click until the pointer leaves, without restoring the title', () => {
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    $('a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(shown()).toBe(false);
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(shown()).toBe(false);
    expect($('a').getAttribute('title')).toBe('');
    out($('a'), document.body);
    expect($('a').getAttribute('title')).toBe('Stage this file');
  });

  it('hides when a focused control is activated from the keyboard', () => {
    $('a').focus();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    $('a').click();
    expect(shown()).toBe(false);
  });

  it('keeps a temporary accessible name in step with title changes', async () => {
    over($('b'));
    $('b').setAttribute('title', 'Reload');
    await Promise.resolve();
    expect($('b').getAttribute('aria-label')).toBe('Reload');
  });

  it('hides on Escape', () => {
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(shown()).toBe(false);
  });

  it('follows title changes made while the tooltip is up', async () => {
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    $('a').setAttribute('title', 'Unstage this file');
    await Promise.resolve();
    expect(tip().textContent).toBe('Unstage this file');
    expect($('a').getAttribute('title')).toBe('');
    out($('a'), document.body);
    expect($('a').getAttribute('title')).toBe('Unstage this file');
  });

  it('hides and leaves no title when it is removed while the tooltip is up', async () => {
    over($('a'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    $('a').removeAttribute('title');
    await Promise.resolve();
    expect(shown()).toBe(false);
    out($('a'), document.body);
    expect($('a').hasAttribute('title')).toBe(false);
  });

  it('releases an element removed from the page', async () => {
    const a = $('a');
    over(a);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    a.remove();
    await Promise.resolve();
    expect(shown()).toBe(false);
    expect(a.getAttribute('title')).toBe('Stage this file');
  });

  it('shows on keyboard focus and hides on blur', () => {
    $('a').focus();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(shown()).toBe(true);
    $('a').blur();
    expect(shown()).toBe(false);
    expect($('a').getAttribute('title')).toBe('Stage this file');
  });

  it('ignores focus that is not focus-visible, and text fields', () => {
    focusVisible = false;
    $('a').focus();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(shown()).toBe(false);

    focusVisible = true;
    $('field').focus();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(shown()).toBe(false);
  });

  it('skips truncated text that fits and already shows the whole title', () => {
    over($('clip'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(shown()).toBe(false);
    expect($('clip').getAttribute('title')).toBe('');
  });

  it('still shows truncated text whose title says more than the text', () => {
    over($('clip2'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(shown()).toBe(true);
  });

  it('keeps the accessible name and description while the title is blank', () => {
    over($('b'));
    expect($('b').getAttribute('aria-label')).toBe('Refresh');
    move($('b'), $('a'));
    expect($('b').hasAttribute('aria-label')).toBe(false);
    expect($('a').getAttribute('aria-describedby')).toBe('grove-tooltip');
    out($('a'), document.body);
    expect($('a').hasAttribute('aria-describedby')).toBe(false);
  });

  it('restores the title and removes the tooltip on uninstall', () => {
    over($('a'));
    uninstall();
    expect($('a').getAttribute('title')).toBe('Stage this file');
    expect(document.getElementById('grove-tooltip')).toBeNull();
    uninstall = () => {};
  });
});
