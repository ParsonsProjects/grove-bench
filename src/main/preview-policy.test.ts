import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkFileRequest, checkNavigation } from './preview-policy.js';

const worktree = path.resolve('/tmp/grove/wt-abc');
const inside = pathToFileURL(path.join(worktree, 'dist', 'index.html')).href;
const outside = pathToFileURL(path.resolve('/tmp/grove/other/secret.html')).href;
const sibling = pathToFileURL(path.resolve('/tmp/grove/wt-abc-evil/index.html')).href;

describe('checkNavigation', () => {
  it('lets both pages open about:blank', () => {
    expect(checkNavigation('about:blank', 'user', worktree).ok).toBe(true);
    expect(checkNavigation('about:blank', 'agent', worktree).ok).toBe(true);
  });

  it('lets your page open any http(s) site', () => {
    expect(checkNavigation('https://example.com/docs', 'user', worktree).ok).toBe(true);
    expect(checkNavigation('http://localhost:3000/', 'user', worktree).ok).toBe(true);
  });

  it("keeps the agent's page on local hosts", () => {
    expect(checkNavigation('http://localhost:5173/', 'agent', worktree).ok).toBe(true);
    expect(checkNavigation('https://127.0.0.1:8443/', 'agent', worktree).ok).toBe(true);
    const external = checkNavigation('https://example.com/', 'agent', worktree);
    expect(external.ok).toBe(false);
    if (!external.ok) expect(external.reason).toContain('example.com');
    expect(checkNavigation('http://localhost@evil.com/', 'agent', worktree).ok).toBe(false);
  });

  it('allows files inside the worktree only', () => {
    for (const who of ['user', 'agent'] as const) {
      expect(checkNavigation(inside, who, worktree).ok).toBe(true);
      expect(checkNavigation(outside, who, worktree).ok).toBe(false);
      expect(checkNavigation(sibling, who, worktree).ok).toBe(false);
    }
  });

  it("keeps the agent's page to HTML files, so it can't read other files", () => {
    const env = pathToFileURL(path.join(worktree, '.env')).href;
    const upper = pathToFileURL(path.join(worktree, 'docs', 'INDEX.HTM')).href;
    expect(checkNavigation(env, 'agent', worktree)).toMatchObject({ ok: false, reason: expect.stringContaining('.html') });
    expect(checkNavigation(upper, 'agent', worktree).ok).toBe(true);
    expect(checkNavigation(env, 'user', worktree).ok).toBe(true);
  });

  it('refuses file URLs when the worktree is unknown', () => {
    expect(checkNavigation(inside, 'user', '').ok).toBe(false);
  });

  it('refuses other schemes', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'vscode://file/x', 'chrome://settings', 'devtools://devtools/x']) {
      expect(checkNavigation(url, 'user', worktree).ok).toBe(false);
      expect(checkNavigation(url, 'agent', worktree).ok).toBe(false);
    }
  });

  it('refuses junk', () => {
    expect(checkNavigation('not a url', 'user', worktree).ok).toBe(false);
  });
});

describe('checkFileRequest', () => {
  const file = (...parts: string[]) => pathToFileURL(path.join(worktree, ...parts)).href;
  const secret = pathToFileURL(path.resolve('/home/me/.aws/credentials')).href;

  it('lets both pages load web files from the worktree', () => {
    for (const who of ['user', 'agent'] as const) {
      for (const f of [file('index.html'), file('app.js'), file('style.css'), file('img', 'logo.PNG'), file('fonts', 'a.woff2')]) {
        expect(checkFileRequest(f, who, worktree).ok).toBe(true);
      }
    }
  });

  it('blocks files outside the worktree for both pages, e.g. an iframe to ../../.aws/credentials', () => {
    for (const who of ['user', 'agent'] as const) {
      expect(checkFileRequest(secret, who, worktree)).toMatchObject({ ok: false, reason: expect.stringContaining('outside') });
      expect(checkFileRequest(pathToFileURL(path.resolve('/tmp/grove/wt-abc-evil/x.js')).href, who, worktree).ok).toBe(false);
    }
  });

  it("keeps non-web files in the worktree away from the agent's page only", () => {
    for (const f of [file('.env'), file('config', 'service-account.json'), file('notes.txt'), file('id_rsa')]) {
      expect(checkFileRequest(f, 'agent', worktree)).toMatchObject({ ok: false, reason: expect.stringContaining('non-web') });
      expect(checkFileRequest(f, 'user', worktree).ok).toBe(true);
    }
  });

  it('blocks UNC paths (file://server/share)', () => {
    for (const who of ['user', 'agent'] as const) {
      expect(checkFileRequest('file://evil-server/share/x.html', who, worktree).ok).toBe(false);
    }
  });

  it('ignores non-file URLs', () => {
    expect(checkFileRequest('http://localhost:5173/app.js', 'agent', worktree).ok).toBe(true);
    expect(checkFileRequest('https://cdn.example.com/x.js', 'agent', worktree).ok).toBe(true);
  });
});
