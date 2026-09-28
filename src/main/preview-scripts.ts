/**
 * Scripts the agent's browser tools run inside Claude's Preview page.
 *
 * Each builder returns a self-contained expression for
 * webContents.executeJavaScript. Agent input is embedded as JSON, never
 * spliced in as code, so a selector or label can't break out of the script.
 * Clicks and typing are then sent as real input events over the DevTools
 * protocol; these scripts only find, scroll to and focus the element.
 */

export interface ElementTarget {
  /** CSS selector. */
  selector?: string;
  /** Visible text of a button, link or other clickable element. */
  text?: string;
  /** Label, placeholder, aria-label or name of a form field. */
  label?: string;
}

export type LocateResult =
  /** `selected` is set when the target was a <select> and the script chose
   *  the option itself. */
  | { ok: true; x: number; y: number; description: string; matches: number; selected?: string }
  | { ok: false; error: string };

export interface PageReadResult {
  ok: boolean;
  error?: string;
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  controls: string[];
}

/** Runs in the page. Kept as a real function so it is type-checked and can be
 *  unit-tested; toString() ships it. Must not reference anything outside. */
function locateInPage(spec: ElementTarget & { purpose: 'click' | 'type'; clear?: boolean; option?: string }) {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const norm = (s: string | null | undefined) => clean(s).toLowerCase();
  const describe = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    // Fields are named by their label; their text is option lists or nothing.
    const isField = el.matches('input, select, textarea');
    const labelText = isField ? clean(Array.from((el as HTMLInputElement).labels ?? []).map((l) => l.textContent).join(' ')) : '';
    const text = (isField ? labelText : clean((el as HTMLElement).innerText ?? el.textContent).slice(0, 60))
      || clean(el.getAttribute('aria-label')) || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('name'));
    return `<${tag}${type ? ` type="${type}"` : ''}>${text ? ` "${text}"` : ''}`;
  };
  const isVisible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const FIELDS = 'input:not([type=hidden]), textarea, select, [contenteditable=""], [contenteditable="true"], [role=textbox], [role=combobox], [role=searchbox]';
  const CLICKABLE = 'a, button, summary, label, option, input[type=button], input[type=submit], input[type=reset], input[type=checkbox], input[type=radio], [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=switch], [onclick], [tabindex]';

  let candidates: Element[] = [];
  if (spec.selector) {
    try {
      candidates = Array.from(document.querySelectorAll(spec.selector));
    } catch (e) {
      return { ok: false as const, error: `Invalid CSS selector ${JSON.stringify(spec.selector)}: ${(e as Error).message}` };
    }
  } else if (spec.text) {
    const want = norm(spec.text);
    const all = Array.from(document.querySelectorAll(CLICKABLE));
    const label = (el: Element) => norm((el as HTMLElement).innerText ?? el.textContent)
      || norm((el as HTMLInputElement).value) || norm(el.getAttribute('aria-label')) || norm(el.getAttribute('title'));
    const exact = all.filter((el) => label(el) === want);
    candidates = exact.length > 0 ? exact : all.filter((el) => label(el).includes(want));
    // The innermost match is the real control, not a wrapper that contains it.
    candidates = candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
  } else if (spec.label) {
    const want = norm(spec.label);
    const fields = Array.from(document.querySelectorAll(FIELDS));
    const names = (el: Element) => {
      const labels = Array.from((el as HTMLInputElement).labels ?? []).map((l) => norm(l.textContent));
      const labelledBy = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
        .map((id) => norm(document.getElementById(id)?.textContent));
      return [...labels, ...labelledBy, norm(el.getAttribute('aria-label')), norm(el.getAttribute('placeholder')),
        norm(el.getAttribute('name')), norm(el.id)].filter(Boolean);
    };
    const exact = fields.filter((el) => names(el).includes(want));
    candidates = exact.length > 0 ? exact : fields.filter((el) => names(el).some((n) => n.includes(want)));
  } else {
    return { ok: false as const, error: 'Give a selector, text or label.' };
  }

  const what = spec.selector ? `selector ${JSON.stringify(spec.selector)}` : spec.text ? `text ${JSON.stringify(spec.text)}` : `label ${JSON.stringify(spec.label)}`;
  if (candidates.length === 0) return { ok: false as const, error: `No element matches ${what}.` };
  const visible = candidates.filter(isVisible);
  if (visible.length === 0) return { ok: false as const, error: `${candidates.length} element(s) match ${what}, but none is visible.` };
  const el = visible[0] as HTMLElement;

  if (spec.purpose === 'type') {
    const editable = el.matches('input, textarea, select') || el.isContentEditable;
    if (!editable) return { ok: false as const, error: `${describe(el)} is not a text field.` };
    if ((el as HTMLInputElement).disabled) return { ok: false as const, error: `${describe(el)} is disabled.` };
  }

  // 'instant', not the default: pages with `scroll-behavior: smooth` would
  // still be scrolling when the position is read.
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
    return { ok: false as const, error: `${describe(el)} is outside the visible area even after scrolling (at ${x},${y}).` };
  }
  const top = document.elementFromPoint(x, y);
  if (spec.purpose === 'click' && top && top !== el && !el.contains(top) && !top.contains(el)) {
    return { ok: false as const, error: `${describe(el)} is covered by ${describe(top)} at that point.` };
  }

  if (spec.purpose === 'type' && el instanceof HTMLSelectElement) {
    // Typing can't pick an option, so choose it here by its text or value.
    const want = norm(spec.option);
    const options = Array.from(el.options);
    const option = options.find((o) => norm(o.text) === want || norm(o.value) === want)
      ?? options.find((o) => norm(o.text).includes(want));
    if (!option) {
      const list = options.map((o) => JSON.stringify(o.text.trim())).slice(0, 20).join(', ');
      return { ok: false as const, error: `${describe(el)} has no option ${JSON.stringify(spec.option ?? '')}. Options: ${list}` };
    }
    el.focus();
    el.value = option.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true as const, x, y, description: describe(el), matches: visible.length, selected: option.text.trim() };
  }

  if (spec.purpose === 'type') {
    el.focus();
    if (spec.clear !== false) {
      // Select the current value so the inserted text replaces it.
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        try { el.select(); } catch { /* some input types can't be selected */ }
      } else if (el.isContentEditable) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  return { ok: true as const, x, y, description: describe(el), matches: visible.length };
}

/** Runs in the page: visible text plus a list of the controls on it. */
function readInPage(spec: { selector?: string; maxChars: number }) {
  const base = { url: location.href, title: document.title };
  let root: Element | null = document.body;
  if (spec.selector) {
    try {
      root = document.querySelector(spec.selector);
    } catch (e) {
      return { ...base, ok: false, error: `Invalid CSS selector: ${(e as Error).message}`, text: '', truncated: false, controls: [] };
    }
    if (!root) return { ...base, ok: false, error: `No element matches ${JSON.stringify(spec.selector)}.`, text: '', truncated: false, controls: [] };
  }
  if (!root) return { ...base, ok: true, text: '', truncated: false, controls: [] };

  const raw = ((root as HTMLElement).innerText ?? root.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  const truncated = raw.length > spec.maxChars;
  const text = truncated ? raw.slice(0, spec.maxChars) : raw;

  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const controls: string[] = [];
  const els = Array.from(root.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=checkbox]'));
  for (const el of els) {
    if (controls.length >= 60) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const input = el as HTMLInputElement;
      const label = norm(Array.from(input.labels ?? []).map((l) => l.textContent).join(' '))
        || norm(el.getAttribute('aria-label')) || norm(el.getAttribute('placeholder')) || norm(el.getAttribute('name'));
      const type = tag === 'input' ? (input.type || 'text') : tag;
      const value = type === 'password' ? (input.value ? '••••' : '') : type === 'checkbox' || type === 'radio' ? (input.checked ? 'checked' : 'unchecked') : norm(input.value).slice(0, 80);
      controls.push(`[${type}] ${label ? JSON.stringify(label) : '(no label)'}${value ? ` = ${JSON.stringify(value)}` : ''}${input.disabled ? ' (disabled)' : ''}`);
    } else {
      const label = norm((el as HTMLElement).innerText ?? el.textContent).slice(0, 80) || norm(el.getAttribute('aria-label')) || norm(el.getAttribute('title'));
      const kind = role ?? (tag === 'a' ? 'link' : tag);
      const href = tag === 'a' ? ` → ${el.getAttribute('href')}` : '';
      controls.push(`[${kind}] ${label ? JSON.stringify(label) : '(no text)'}${href}${(el as HTMLButtonElement).disabled ? ' (disabled)' : ''}`);
    }
  }
  return { ...base, ok: true, text, truncated, controls };
}

/** `option` is the text being typed, used to pick an option when the target
 *  turns out to be a <select>. */
export function locateScript(target: ElementTarget, purpose: 'click' | 'type', clear?: boolean, option?: string): string {
  const spec = { selector: target.selector, text: target.text, label: target.label, purpose, clear, option };
  return `(${locateInPage.toString()})(${JSON.stringify(spec)})`;
}

export function readScript(opts: { selector?: string; maxChars: number }): string {
  return `(${readInPage.toString()})(${JSON.stringify(opts)})`;
}

// Exported for tests, which run them against jsdom.
export const __test = { locateInPage, readInPage };
