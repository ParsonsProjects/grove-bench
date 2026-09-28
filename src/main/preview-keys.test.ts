import { describe, it, expect } from 'vitest';
import { previewKeyAction, type KeyInput } from './preview-keys.js';

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: 'keyDown', key: k, control: false, shift: false, alt: false, meta: false, ...mods,
});

describe('previewKeyAction', () => {
  it('reloads with F5 and Ctrl+R, hard reloads with modifiers', () => {
    expect(previewKeyAction(key('F5'))).toEqual({ kind: 'page', command: 'reload' });
    expect(previewKeyAction(key('r', { control: true }))).toEqual({ kind: 'page', command: 'reload' });
    expect(previewKeyAction(key('F5', { control: true }))).toEqual({ kind: 'page', command: 'hardReload' });
    expect(previewKeyAction(key('R', { control: true, shift: true }))).toEqual({ kind: 'page', command: 'hardReload' });
  });

  it('opens DevTools with F12 and Ctrl+Shift+I', () => {
    expect(previewKeyAction(key('F12'))).toEqual({ kind: 'page', command: 'devtools' });
    expect(previewKeyAction(key('I', { control: true, shift: true }))).toEqual({ kind: 'page', command: 'devtools' });
  });

  it('goes back and forward with Alt+arrows', () => {
    expect(previewKeyAction(key('ArrowLeft', { alt: true }))).toEqual({ kind: 'page', command: 'back' });
    expect(previewKeyAction(key('ArrowRight', { alt: true }))).toEqual({ kind: 'page', command: 'forward' });
    expect(previewKeyAction(key('ArrowLeft'))).toBeNull();
  });

  it('focuses the address bar with Ctrl+L and Alt+D', () => {
    expect(previewKeyAction(key('l', { control: true }))).toEqual({ kind: 'focusAddress' });
    expect(previewKeyAction(key('d', { alt: true }))).toEqual({ kind: 'focusAddress' });
  });

  it("hands Grove's shortcuts back to Grove", () => {
    for (const n of ['1', '2', '3', '4', '5']) expect(previewKeyAction(key(n, { alt: true }))).toEqual({ kind: 'grove' });
    expect(previewKeyAction(key('b', { control: true }))).toEqual({ kind: 'grove' });
    expect(previewKeyAction(key('T', { control: true, shift: true }))).toEqual({ kind: 'grove' });
    // Mode, thinking and effort.
    for (const k of ['m', 't', 'e']) expect(previewKeyAction(key(k, { alt: true }))).toEqual({ kind: 'grove' });
  });

  it('keeps Ctrl+R and Ctrl+F in the page', () => {
    expect(previewKeyAction(key('r', { control: true }))).toEqual({ kind: 'page', command: 'reload' });
    expect(previewKeyAction(key('f', { control: true }))).toBeNull();
  });

  it('leaves normal typing and editing keys to the page', () => {
    for (const k of [key('a'), key('c', { control: true }), key('v', { control: true }), key('z', { control: true }), key('6', { alt: true }), key('Enter')]) {
      expect(previewKeyAction(k)).toBeNull();
    }
  });

  it('ignores key-up events', () => {
    expect(previewKeyAction({ ...key('F5'), type: 'keyUp' })).toBeNull();
  });
});
