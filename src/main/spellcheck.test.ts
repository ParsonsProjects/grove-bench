import { describe, it, expect, vi } from 'vitest';
import type { WebContents } from 'electron';
import { IPC } from '../shared/types.js';
import { installSpellcheckMenu, replaceMisspelling, addWordToDictionary } from './spellcheck.js';

function makeWebContents() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const wc = {
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => { listeners.set(event, fn); }),
    send: vi.fn(),
    replaceMisspelling: vi.fn(),
    session: {
      setSpellCheckerLanguages: vi.fn(),
      addWordToSpellCheckerDictionary: vi.fn(),
    },
  };
  const rightClick = (params: { misspelledWord: string; dictionarySuggestions: string[]; x?: number; y?: number }) =>
    listeners.get('context-menu')?.({}, { x: 10, y: 20, ...params });
  return { wc, webContents: wc as unknown as WebContents, rightClick };
}

describe('installSpellcheckMenu', () => {
  it('sets the language and asks the renderer to show the menu for a misspelled word', () => {
    const { wc, webContents, rightClick } = makeWebContents();
    installSpellcheckMenu(webContents);
    expect(wc.session.setSpellCheckerLanguages).toHaveBeenCalledWith(['en-US']);

    rightClick({ misspelledWord: 'teh', dictionarySuggestions: ['the', 'tech'], x: 40, y: 50 });
    expect(wc.send).toHaveBeenCalledWith(IPC.SPELLCHECK_MENU, {
      x: 40, y: 50, misspelledWord: 'teh', suggestions: ['the', 'tech'],
    });
  });

  it('does nothing for a right-click that is not on a misspelled word', () => {
    const { wc, webContents, rightClick } = makeWebContents();
    installSpellcheckMenu(webContents);
    rightClick({ misspelledWord: '', dictionarySuggestions: [] });
    expect(wc.send).not.toHaveBeenCalled();
  });
});

describe('replaceMisspelling', () => {
  it('replaces with an offered suggestion, once', () => {
    const { wc, webContents, rightClick } = makeWebContents();
    installSpellcheckMenu(webContents);
    rightClick({ misspelledWord: 'teh', dictionarySuggestions: ['the', 'tech'] });

    replaceMisspelling(webContents, 'tech');
    expect(wc.replaceMisspelling).toHaveBeenCalledWith('tech');

    replaceMisspelling(webContents, 'the');
    expect(wc.replaceMisspelling).toHaveBeenCalledTimes(1);
  });

  it('ignores words that were not offered', () => {
    const { wc, webContents, rightClick } = makeWebContents();
    installSpellcheckMenu(webContents);

    replaceMisspelling(webContents, 'the');
    rightClick({ misspelledWord: 'teh', dictionarySuggestions: ['the'] });
    replaceMisspelling(webContents, 'something else');
    replaceMisspelling(webContents, 42);

    expect(wc.replaceMisspelling).not.toHaveBeenCalled();
  });
});

describe('addWordToDictionary', () => {
  it('adds the right-clicked word, once', () => {
    const { wc, webContents, rightClick } = makeWebContents();
    installSpellcheckMenu(webContents);

    addWordToDictionary(webContents);
    expect(wc.session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();

    rightClick({ misspelledWord: 'worktree', dictionarySuggestions: [] });
    addWordToDictionary(webContents);
    addWordToDictionary(webContents);
    expect(wc.session.addWordToSpellCheckerDictionary).toHaveBeenCalledTimes(1);
    expect(wc.session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith('worktree');
  });
});
