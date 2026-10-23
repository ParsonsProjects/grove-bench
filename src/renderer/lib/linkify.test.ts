import { describe, it, expect } from 'vitest';
import { linkifyLocalhost } from './linkify.js';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function render(text: string): HTMLElement {
  const el = document.createElement('pre');
  el.innerHTML = linkifyLocalhost(escapeHtml(text));
  return el;
}

describe('linkifyLocalhost', () => {
  it('links a local URL with a query string as written', () => {
    const a = render('Ready at http://localhost:3000/search?q=a&page=2 now').querySelector('a')!;
    expect(a.dataset.url).toBe('http://localhost:3000/search?q=a&page=2');
    expect(a.getAttribute('href')).toBe('http://localhost:3000/search?q=a&page=2');
    expect(a.textContent).toBe('http://localhost:3000/search?q=a&page=2');
  });

  it('keeps markup in the output inert', () => {
    const el = render('<img src=x onerror="alert(1)"> http://localhost:5173/"><script>x</script>');
    expect(el.querySelector('img, script')).toBeNull();
    expect(el.querySelector('a')!.dataset.url).toBe('http://localhost:5173/');
  });

  it('opens wildcard binds on localhost', () => {
    expect(render('http://0.0.0.0:8080/').querySelector('a')!.dataset.url).toBe('http://localhost:8080/');
  });
});
