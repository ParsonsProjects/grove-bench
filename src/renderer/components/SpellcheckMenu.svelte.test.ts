import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import type { SpellcheckMenuRequest } from '../../shared/types.js';
import SpellcheckMenu from './SpellcheckMenu.svelte';

let showMenu: (req: SpellcheckMenuRequest) => void;

beforeEach(() => {
  vi.clearAllMocks();
  mockGroveBench.onSpellcheckMenu.mockImplementation(((cb: (req: SpellcheckMenuRequest) => void) => {
    showMenu = (req) => flushSync(() => cb(req));
    return () => {};
  }) as never);
});

afterEach(() => cleanup());

function open(suggestions: string[], at = { x: 30, y: 40 }) {
  // The DOM right-click always lands before main's message.
  document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: at.x, clientY: at.y }));
  showMenu({ x: 999, y: 999, misspelledWord: 'teh', suggestions });
}

describe('SpellcheckMenu', () => {
  it('shows nothing until main reports a misspelled word', () => {
    render(SpellcheckMenu);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lists suggestions at the right-click and replaces the word on click', async () => {
    render(SpellcheckMenu);
    open(['the', 'tech']);

    const menu = screen.getByRole('menu', { name: 'Spelling suggestions' });
    expect(menu.style.left).toBe('30px');
    expect(menu.style.top).toBe('40px');
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent?.trim())).toEqual(['the', 'tech', 'Add to Dictionary']);

    await fireEvent.click(screen.getByRole('menuitem', { name: 'tech' }));
    expect(mockGroveBench.spellcheckReplace).toHaveBeenCalledWith('tech');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens upwards when there is no room below, keeping the word visible', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = parseFloat(this.style.top) || 0;
      const left = parseFloat(this.style.left) || 0;
      return { top, left, bottom: top + 120, right: left + 160, width: 160, height: 120, x: left, y: top, toJSON: () => ({}) };
    });
    try {
      render(SpellcheckMenu);
      open(['the'], { x: 30, y: window.innerHeight - 20 });
      expect(screen.getByRole('menu').style.top).toBe(`${window.innerHeight - 20 - 120}px`);
    } finally {
      rect.mockRestore();
    }
  });

  it('shows a disabled placeholder with no suggestions and can add the word', async () => {
    render(SpellcheckMenu);
    open([]);

    expect(screen.getByRole('menuitem', { name: 'No suggestions' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Dictionary' }));
    expect(mockGroveBench.spellcheckAddWord).toHaveBeenCalled();
    expect(mockGroveBench.spellcheckReplace).not.toHaveBeenCalled();
  });

  it('keeps focus in the text box when an item is pressed', () => {
    render(SpellcheckMenu);
    open(['the']);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    screen.getByRole('menuitem', { name: 'the' }).dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('keeps its pointerdowns from reaching the page, so an open dialog stays open', () => {
    const outside = vi.fn();
    document.addEventListener('pointerdown', outside);
    try {
      render(SpellcheckMenu);
      open(['the']);
      screen.getByRole('menuitem', { name: 'the' }).dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(outside).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('pointerdown', outside);
    }
  });

  it('picks a suggestion from the keyboard without the keys reaching the text box', async () => {
    const underneath = vi.fn();
    document.addEventListener('keydown', underneath);
    try {
      render(SpellcheckMenu);
      open(['the', 'tech']);

      await fireEvent.keyDown(document.body, { key: 'ArrowDown' });
      await fireEvent.keyDown(document.body, { key: 'ArrowDown' });
      await fireEvent.keyDown(document.body, { key: 'Enter' });

      expect(mockGroveBench.spellcheckReplace).toHaveBeenCalledWith('tech');
      expect(underneath).not.toHaveBeenCalled();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    } finally {
      document.removeEventListener('keydown', underneath);
    }
  });

  it('skips the disabled placeholder when moving with the arrow keys', async () => {
    render(SpellcheckMenu);
    open([]);
    await fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    await fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(mockGroveBench.spellcheckAddWord).toHaveBeenCalled();
  });

  it('closes on Escape without it reaching the page', async () => {
    const underneath = vi.fn();
    document.addEventListener('keydown', underneath);
    try {
      render(SpellcheckMenu);
      open(['the']);
      await fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(underneath).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', underneath);
    }
  });

  it('gets out of the way when the user keeps typing', async () => {
    const underneath = vi.fn();
    document.addEventListener('keydown', underneath);
    try {
      render(SpellcheckMenu);
      open(['the']);
      await fireEvent.keyDown(document.body, { key: 'Shift' });
      expect(screen.getByRole('menu')).toBeInTheDocument();
      await fireEvent.keyDown(document.body, { key: 'a' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(underneath).toHaveBeenCalledTimes(2);
    } finally {
      document.removeEventListener('keydown', underneath);
    }
  });

  it('closes when clicking elsewhere', async () => {
    render(SpellcheckMenu);
    open(['the']);
    await fireEvent.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(mockGroveBench.spellcheckReplace).not.toHaveBeenCalled();
  });
});
