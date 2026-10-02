import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The default export is a factory in this environment; build a real
// sanitizer on jsdom's window rather than stubbing it out.
vi.mock('dompurify', async () => {
  const actual = await vi.importActual<{ default: (w: Window) => unknown }>('dompurify');
  return { default: actual.default(window) };
});

type Module = typeof import('./code-highlight.js');

/** A fresh copy of the module, so each test gets its own observer and queue
 *  built against the globals it stubbed. */
async function load(): Promise<Module> {
  vi.resetModules();
  return import('./code-highlight.js');
}

function codeBlock(mod: Module, text: string, opts: { lang?: string; mark?: string } = {}): HTMLElement {
  const wrapper = document.createElement('div');
  const code = document.createElement('code');
  code.className = `language-${opts.lang ?? 'ts'}`;
  code.dataset.hl = opts.mark ?? mod.HIGHLIGHT_MARK;
  code.textContent = text;
  wrapper.appendChild(document.createElement('pre')).appendChild(code);
  document.body.appendChild(wrapper);
  return wrapper;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An IntersectionObserver whose entries the test fires by hand. */
class FakeObserver {
  static last: FakeObserver | null = null;
  observed = new Set<Element>();
  constructor(private callback: IntersectionObserverCallback) { FakeObserver.last = this; }
  observe(el: Element) { this.observed.add(el); }
  unobserve(el: Element) { this.observed.delete(el); }
  disconnect() { this.observed.clear(); }
  show(el: Element) {
    this.callback([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
  FakeObserver.last = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('highlightWhenVisible', () => {
  it('colours a marked block without changing its text', async () => {
    const mod = await load();
    const root = codeBlock(mod, 'const a = 1;');
    mod.highlightWhenVisible(root);
    const code = root.querySelector('code')!;
    expect(code.querySelector('.hljs-keyword')).toBeNull();

    await flush();
    expect(code.querySelector('.hljs-keyword')).toHaveProperty('textContent', 'const');
    expect(code.textContent).toBe('const a = 1;');
    expect(code.dataset.hl).toBeUndefined();
  });

  it('waits until the block is on screen', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const mod = await load();
    const root = codeBlock(mod, 'const a = 1;');
    const code = root.querySelector('code')!;
    mod.highlightWhenVisible(root);

    await flush();
    expect(code.querySelector('.hljs-keyword')).toBeNull();

    FakeObserver.last!.show(code);
    await flush();
    expect(code.querySelector('.hljs-keyword')).not.toBeNull();
    expect(FakeObserver.last!.observed.has(code)).toBe(false);
  });

  it('uses idle time when the browser offers it', async () => {
    const idle = vi.fn((cb: IdleRequestCallback) => { setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 10 }), 0); return 1; });
    vi.stubGlobal('requestIdleCallback', idle);
    const mod = await load();
    const root = codeBlock(mod, 'let b = 2;');
    mod.highlightWhenVisible(root);

    await flush();
    expect(idle).toHaveBeenCalledOnce();
    expect(root.querySelector('.hljs-keyword')).not.toBeNull();
  });

  it('stops waiting on blocks once released', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const mod = await load();
    const root = codeBlock(mod, 'const a = 1;');
    const code = root.querySelector('code')!;
    const release = mod.highlightWhenVisible(root);
    expect(FakeObserver.last!.observed.has(code)).toBe(true);

    release();
    expect(FakeObserver.last!.observed.has(code)).toBe(false);
  });

  it('skips a block removed before its turn', async () => {
    const mod = await load();
    const root = codeBlock(mod, 'const a = 1;');
    mod.highlightWhenVisible(root);
    root.remove();

    await flush();
    expect(root.querySelector('.hljs-keyword')).toBeNull();
  });

  it('ignores code the reply marked itself', async () => {
    const mod = await load();
    const root = codeBlock(mod, 'const a = 1;', { mark: 'guess' });
    mod.highlightWhenVisible(root);

    await flush();
    expect(root.querySelector('.hljs-keyword')).toBeNull();
    expect(root.querySelector('code')!.dataset.hl).toBe('guess');
  });

  it('keeps markup in the code as text', async () => {
    const mod = await load();
    const text = 'const html = "<img src=x onerror=alert(1)>";';
    const root = codeBlock(mod, text);
    mod.highlightWhenVisible(root);

    await flush();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('code')!.textContent).toBe(text);
  });

  it('leaves a block in a language it has no grammar for plain', async () => {
    const mod = await load();
    const root = codeBlock(mod, 'IDENTIFICATION DIVISION.', { lang: 'cobol' });
    mod.highlightWhenVisible(root);

    await flush();
    const code = root.querySelector('code')!;
    expect(code.children).toHaveLength(0);
    expect(code.textContent).toBe('IDENTIFICATION DIVISION.');
  });
});
