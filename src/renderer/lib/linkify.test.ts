import { describe, it, expect } from 'vitest';
import { linkifyLocalhost, hasLocalhostUrl } from './linkify.js';

describe('hasLocalhostUrl()', () => {
  it('returns true for http://localhost:3000', () => {
    expect(hasLocalhostUrl('http://localhost:3000')).toBe(true);
  });

  it('returns true for https://localhost:8080', () => {
    expect(hasLocalhostUrl('https://localhost:8080')).toBe(true);
  });

  it('returns true for http://127.0.0.1:5173', () => {
    expect(hasLocalhostUrl('http://127.0.0.1:5173')).toBe(true);
  });

  it('returns true for http://0.0.0.0:4000', () => {
    expect(hasLocalhostUrl('http://0.0.0.0:4000')).toBe(true);
  });

  it('returns true for http://[::]:3000', () => {
    expect(hasLocalhostUrl('http://[::]:3000')).toBe(true);
  });

  it('returns false for regular URLs', () => {
    expect(hasLocalhostUrl('https://example.com')).toBe(false);
  });

  it('returns false for localhost without port', () => {
    expect(hasLocalhostUrl('http://localhost')).toBe(false);
  });

  it('returns false for plain text', () => {
    expect(hasLocalhostUrl('no urls here')).toBe(false);
  });

  it('detects URL embedded in text', () => {
    expect(hasLocalhostUrl('Server running at http://localhost:3000 ready')).toBe(true);
  });
});

describe('linkifyLocalhost()', () => {
  it('wraps localhost URL in an anchor tag', () => {
    const result = linkifyLocalhost('http://localhost:3000');
    expect(result).toBe(
      '<a href="http://localhost:3000" class="localhost-link" data-url="http://localhost:3000">http://localhost:3000</a>',
    );
  });

  it('normalizes 0.0.0.0 to localhost in href', () => {
    const result = linkifyLocalhost('http://0.0.0.0:4000');
    expect(result).toContain('href="http://localhost:4000"');
    // Original text preserved in visible content
    expect(result).toContain('>http://0.0.0.0:4000</a>');
  });

  it('normalizes [::] to localhost in href', () => {
    const result = linkifyLocalhost('http://[::]:5000');
    expect(result).toContain('href="http://localhost:5000"');
    expect(result).toContain('>http://[::]:5000</a>');
  });

  it('preserves 127.0.0.1 as-is in href', () => {
    const result = linkifyLocalhost('http://127.0.0.1:8080');
    expect(result).toContain('href="http://127.0.0.1:8080"');
  });

  it('handles URL with path', () => {
    const result = linkifyLocalhost('http://localhost:3000/api/health');
    expect(result).toContain('href="http://localhost:3000/api/health"');
  });

  it('leaves non-localhost text unchanged', () => {
    const text = 'No URLs here, just plain text.';
    expect(linkifyLocalhost(text)).toBe(text);
  });

  it('handles multiple URLs in one string', () => {
    const text = 'Frontend: http://localhost:3000 Backend: http://localhost:4000';
    const result = linkifyLocalhost(text);
    expect(result).toContain('href="http://localhost:3000"');
    expect(result).toContain('href="http://localhost:4000"');
  });

  it('escapes HTML special characters in URLs', () => {
    const result = linkifyLocalhost('http://localhost:3000/path?a=1&b=2');
    expect(result).toContain('href="http://localhost:3000/path?a=1&amp;b=2"');
  });

  it('does not linkify non-local URLs', () => {
    const text = 'https://example.com:3000/path';
    expect(linkifyLocalhost(text)).toBe(text);
  });
});
