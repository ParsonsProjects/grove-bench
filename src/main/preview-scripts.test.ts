// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { __test, locateScript, readScript } from './preview-scripts.js';

const { locateInPage, readInPage } = __test;

/** jsdom has no layout: give every element a box unless it's marked zero-size,
 *  and let tests decide what sits on top at a point. */
let topElement: (() => Element | null) | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
  topElement = null;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const zero = this.hasAttribute('data-zero');
    return { left: 10, top: 20, width: zero ? 0 : 100, height: zero ? 0 : 30, right: 110, bottom: 50, x: 10, y: 20, toJSON() {} } as DOMRect;
  });
  Element.prototype.scrollIntoView = vi.fn();
  document.elementFromPoint = vi.fn((_x: number, _y: number) => topElement?.() ?? null);
});

describe('locateInPage', () => {
  it('finds an element by selector and returns its centre', () => {
    document.body.innerHTML = '<button id="save">Save</button>';
    const res = locateInPage({ selector: '#save', purpose: 'click' });
    expect(res).toEqual({ ok: true, x: 60, y: 35, description: '<button> "Save"', matches: 1 });
  });

  it('reports an invalid selector', () => {
    const res = locateInPage({ selector: 'button[', purpose: 'click' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Invalid CSS selector');
  });

  it('prefers an exact text match and the innermost element', () => {
    document.body.innerHTML = '<div role="button" id="wrap"><button id="inner">Save</button></div><button id="more">Save all</button>';
    const res = locateInPage({ text: 'save', purpose: 'click' });
    expect(res.ok && res.description).toBe('<button> "Save"');
    expect(res.ok && res.matches).toBe(1);
  });

  it('falls back to a partial text match', () => {
    document.body.innerHTML = '<a href="/x">Open settings page</a>';
    const res = locateInPage({ text: 'settings', purpose: 'click' });
    expect(res.ok && res.description).toBe('<a> "Open settings page"');
  });

  it('finds a field by its label, placeholder or aria-label', () => {
    document.body.innerHTML = `
      <label for="e">Email address</label><input id="e" type="email">
      <input placeholder="Search" id="s">
      <textarea aria-label="Notes" id="n"></textarea>`;
    expect(locateInPage({ label: 'email address', purpose: 'type' }).ok).toBe(true);
    expect(document.activeElement?.id).toBe('e');
    expect(locateInPage({ label: 'Search', purpose: 'type' }).ok).toBe(true);
    expect(document.activeElement?.id).toBe('s');
    expect(locateInPage({ label: 'notes', purpose: 'type' }).ok).toBe(true);
    expect(document.activeElement?.id).toBe('n');
  });

  it('selects the current value so typing replaces it, unless clear is false', () => {
    document.body.innerHTML = '<input id="q" value="old text">';
    const input = document.getElementById('q') as HTMLInputElement;
    locateInPage({ selector: '#q', purpose: 'type' });
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 8]);
    input.setSelectionRange(8, 8);
    locateInPage({ selector: '#q', purpose: 'type', clear: false });
    expect([input.selectionStart, input.selectionEnd]).toEqual([8, 8]);
  });

  it('skips hidden matches and says when none is visible', () => {
    document.body.innerHTML = '<button style="display:none">Go</button><button data-zero>Go</button>';
    const res = locateInPage({ text: 'go', purpose: 'click' });
    expect(res).toEqual({ ok: false, error: '2 element(s) match text "go", but none is visible.' });
  });

  it('reports when nothing matches', () => {
    const res = locateInPage({ selector: '.missing', purpose: 'click' });
    expect(res).toEqual({ ok: false, error: 'No element matches selector ".missing".' });
  });

  it('refuses to click an element covered by another one', () => {
    document.body.innerHTML = '<button id="b">Buy</button><div id="modal">Cookie banner</div>';
    topElement = () => document.getElementById('modal');
    const res = locateInPage({ selector: '#b', purpose: 'click' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('covered by <div> "Cookie banner"');
  });

  it('allows a click that lands on a child of the element', () => {
    document.body.innerHTML = '<button id="b"><span id="icon">★</span> Star</button>';
    topElement = () => document.getElementById('icon');
    expect(locateInPage({ selector: '#b', purpose: 'click' }).ok).toBe(true);
  });

  it('refuses to type into something that is not a field', () => {
    document.body.innerHTML = '<div id="d">text</div><input id="x" disabled>';
    const notField = locateInPage({ selector: '#d', purpose: 'type' });
    expect(notField.ok || notField.error).toBe('<div> "text" is not a text field.');
    const disabled = locateInPage({ selector: '#x', purpose: 'type' });
    expect(disabled.ok || disabled.error).toContain('is disabled');
  });

  it('chooses a <select> option by text or value and fires change', () => {
    document.body.innerHTML = '<label for="c">Country</label><select id="c"><option value="">Pick</option><option value="gb">United Kingdom</option><option value="us">United States</option></select>';
    const select = document.getElementById('c') as HTMLSelectElement;
    const changed = vi.fn();
    select.addEventListener('change', changed);
    const byText = locateInPage({ label: 'country', purpose: 'type', option: 'united kingdom' });
    expect(byText).toMatchObject({ ok: true, selected: 'United Kingdom' });
    expect(select.value).toBe('gb');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(locateInPage({ selector: '#c', purpose: 'type', option: 'us' })).toMatchObject({ ok: true, selected: 'United States' });
    const missing = locateInPage({ selector: '#c', purpose: 'type', option: 'France' });
    expect(missing.ok || missing.error).toBe('<select> "Country" has no option "France". Options: "Pick", "United Kingdom", "United States"');
  });

  it('asks for a target when none is given', () => {
    expect(locateInPage({ purpose: 'click' })).toEqual({ ok: false, error: 'Give a selector, text or label.' });
  });
});

describe('readInPage', () => {
  it('returns page text and a list of controls, masking passwords', () => {
    document.title = 'Login';
    document.body.innerHTML = `
      <h1>Welcome</h1>
      <label for="u">User</label><input id="u" value="ada">
      <label for="p">Password</label><input id="p" type="password" value="hunter2">
      <input type="checkbox" aria-label="Remember me" checked>
      <button disabled>Sign in</button>
      <a href="/help">Help</a>`;
    const res = readInPage({ maxChars: 1000 });
    expect(res.ok).toBe(true);
    expect(res.title).toBe('Login');
    expect(res.text).toContain('Welcome');
    expect(res.controls).toEqual([
      '[text] "User" = "ada"',
      '[password] "Password" = "••••"',
      '[checkbox] "Remember me" = "checked"',
      '[button] "Sign in" (disabled)',
      '[link] "Help" → /help',
    ]);
  });

  it('truncates long text', () => {
    document.body.innerHTML = `<p>${'a'.repeat(50)}</p>`;
    const res = readInPage({ maxChars: 10 });
    expect(res.text).toBe('a'.repeat(10));
    expect(res.truncated).toBe(true);
  });

  it('reads a single element by selector and reports misses', () => {
    document.body.innerHTML = '<main><p id="msg">Saved!</p></main><footer>foot</footer>';
    expect(readInPage({ selector: '#msg', maxChars: 100 }).text).toBe('Saved!');
    expect(readInPage({ selector: '#nope', maxChars: 100 })).toMatchObject({ ok: false, error: 'No element matches "#nope".' });
  });
});

describe('script builders', () => {
  it('embed agent input as JSON so it cannot break out of the script', () => {
    const nasty = '"); alert(1); ("';
    const script = locateScript({ selector: nasty }, 'click');
    expect(script).toContain(JSON.stringify(nasty));
    // The script is a single call expression that evaluates cleanly.
    document.body.innerHTML = '';
    // eslint-disable-next-line no-eval
    const result = (0, eval)(script);
    expect(result.ok).toBe(false);
  });

  it('produce scripts that run on their own', () => {
    document.body.innerHTML = '<button>Go</button>';
    // eslint-disable-next-line no-eval
    expect((0, eval)(locateScript({ text: 'Go' }, 'click')).ok).toBe(true);
    // eslint-disable-next-line no-eval
    expect((0, eval)(readScript({ maxChars: 100 })).text).toContain('Go');
  });
});
