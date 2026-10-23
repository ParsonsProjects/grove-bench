import { describe, it, expect } from 'vitest';
import { findLocalUrls, isLocalHostname, isLocalHttpUrl, normalizeTypedUrl, toBrowsableUrl } from './preview-url.js';

describe('isLocalHostname', () => {
  it.each(['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1', '0.0.0.0', '[::]'])('%s is local', (h) => {
    expect(isLocalHostname(h)).toBe(true);
  });

  it.each(['example.com', 'localhost.example.com', '192.168.1.10', '10.0.0.1', '128.0.0.1', 'notlocalhost'])('%s is not local', (h) => {
    expect(isLocalHostname(h)).toBe(false);
  });
});

describe('isLocalHttpUrl', () => {
  it('accepts http and https on local hosts', () => {
    expect(isLocalHttpUrl('http://localhost:5173/')).toBe(true);
    expect(isLocalHttpUrl('https://127.0.0.1:8443/login')).toBe(true);
    expect(isLocalHttpUrl('http://[::1]:3000')).toBe(true);
  });

  it('rejects other hosts, other schemes and junk', () => {
    expect(isLocalHttpUrl('https://example.com')).toBe(false);
    expect(isLocalHttpUrl('http://localhost.evil.com/')).toBe(false);
    expect(isLocalHttpUrl('file:///C:/repo/index.html')).toBe(false);
    expect(isLocalHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isLocalHttpUrl('not a url')).toBe(false);
  });

  it('is not fooled by credentials that look like a host', () => {
    expect(isLocalHttpUrl('http://localhost@evil.com/')).toBe(false);
    expect(isLocalHttpUrl('http://localhost:3000@evil.com/')).toBe(false);
  });
});

describe('toBrowsableUrl', () => {
  it('rewrites wildcard bind addresses to localhost', () => {
    expect(toBrowsableUrl('http://0.0.0.0:3000/app')).toBe('http://localhost:3000/app');
    expect(toBrowsableUrl('http://[::]:8080/')).toBe('http://localhost:8080/');
  });

  it('leaves other URLs alone', () => {
    expect(toBrowsableUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000/');
    expect(toBrowsableUrl('garbage')).toBe('garbage');
  });
});

describe('normalizeTypedUrl', () => {
  it('opens a bare port on localhost', () => {
    expect(normalizeTypedUrl('5173')).toBe('http://localhost:5173/');
    expect(normalizeTypedUrl(':3000/admin')).toBe('http://localhost:3000/admin');
  });

  it('adds http:// for local hosts and IPs', () => {
    expect(normalizeTypedUrl('localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeTypedUrl('127.0.0.1:8080/x?y=1')).toBe('http://127.0.0.1:8080/x?y=1');
    expect(normalizeTypedUrl('192.168.1.5:3000')).toBe('http://192.168.1.5:3000/');
  });

  it('adds https:// for other hosts', () => {
    expect(normalizeTypedUrl('example.com/docs')).toBe('https://example.com/docs');
  });

  it('keeps explicit http, https, file and about:blank', () => {
    expect(normalizeTypedUrl('  https://example.com  ')).toBe('https://example.com/');
    expect(normalizeTypedUrl('file:///C:/repo/index.html')).toBe('file:///C:/repo/index.html');
    expect(normalizeTypedUrl('about:blank')).toBe('about:blank');
  });

  it('turns a Windows path into a file URL', () => {
    expect(normalizeTypedUrl('C:\\repo\\my app\\index.html')).toBe('file:///C:/repo/my%20app/index.html');
  });

  it('rewrites wildcard hosts', () => {
    expect(normalizeTypedUrl('0.0.0.0:4000')).toBe('http://localhost:4000/');
  });

  it('rejects other schemes and non-URLs', () => {
    expect(normalizeTypedUrl('')).toBeNull();
    expect(normalizeTypedUrl('   ')).toBeNull();
    expect(normalizeTypedUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeTypedUrl('vscode://file/x')).toBeNull();
    expect(normalizeTypedUrl('hello')).toBeNull();
  });
});

describe('findLocalUrls', () => {
  it('finds URLs in Vite output with ANSI colour on the port', () => {
    const out = '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n';
    expect(findLocalUrls(out)).toEqual(['http://localhost:5173/']);
  });

  it('finds several URLs, drops duplicates and trailing punctuation', () => {
    const out = 'Ready on http://localhost:3000. Also http://127.0.0.1:3000/api, and http://localhost:3000.';
    expect(findLocalUrls(out)).toEqual(['http://localhost:3000/', 'http://127.0.0.1:3000/api']);
  });

  it('rewrites wildcard hosts', () => {
    expect(findLocalUrls('Listening on http://0.0.0.0:8000')).toEqual(['http://localhost:8000/']);
  });

  it('ignores non-local URLs', () => {
    expect(findLocalUrls('see https://example.com and http://192.168.0.2:3000')).toEqual([]);
  });

  it('strips OSC 8 hyperlink wrappers', () => {
    const out = '\x1b]8;;http://localhost:4321/\x07http://localhost:4321/\x1b]8;;\x07';
    expect(findLocalUrls(out)).toEqual(['http://localhost:4321/']);
  });
});
