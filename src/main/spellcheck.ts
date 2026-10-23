import type { WebContents } from 'electron';
import { IPC, type SpellcheckMenuRequest } from '../shared/types.js';

// Chromium finds misspellings and suggestions; the renderer draws the menu so
// it matches the rest of the app instead of the native OS menu.

interface Offer {
  word: string;
  suggestions: string[];
}

/** What the last right-click on a misspelled word offered, per window. The
 *  renderer can only pick from this, not send arbitrary words. */
const offers = new WeakMap<WebContents, Offer>();

export function installSpellcheckMenu(webContents: WebContents): void {
  webContents.session.setSpellCheckerLanguages(['en-US']);
  webContents.on('context-menu', (_event, params) => {
    if (!params.misspelledWord) return;
    const offer: Offer = { word: params.misspelledWord, suggestions: [...params.dictionarySuggestions] };
    offers.set(webContents, offer);
    const req: SpellcheckMenuRequest = {
      x: params.x,
      y: params.y,
      misspelledWord: offer.word,
      suggestions: offer.suggestions,
    };
    webContents.send(IPC.SPELLCHECK_MENU, req);
  });
}

/** Replace the misspelled word under the caret. Ignored unless `suggestion`
 *  was offered for the last right-clicked word. */
export function replaceMisspelling(webContents: WebContents, suggestion: unknown): void {
  const offer = offers.get(webContents);
  if (!offer || typeof suggestion !== 'string' || !offer.suggestions.includes(suggestion)) return;
  offers.delete(webContents);
  webContents.replaceMisspelling(suggestion);
}

/** Add the last right-clicked misspelled word to the user's dictionary. */
export function addWordToDictionary(webContents: WebContents): void {
  const offer = offers.get(webContents);
  if (!offer) return;
  offers.delete(webContents);
  webContents.session.addWordToSpellCheckerDictionary(offer.word);
}
