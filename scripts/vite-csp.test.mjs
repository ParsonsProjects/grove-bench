import { describe, it, expect } from 'vitest';
import { contentSecurityPolicy } from './vite-csp.mjs';
import { ATTACHMENT_SCHEME } from '../src/shared/attachments.ts';

/** The app window's policy, by directive. */
function policy({ env = {}, server } = {}) {
  const plugin = contentSecurityPolicy();
  plugin.configResolved({ env });
  const [meta] = plugin.transformIndexHtml('', { server });
  return new Map(meta.attrs.content.split(';').map((d) => {
    const [name, ...sources] = d.trim().split(/\s+/);
    return [name, sources];
  }));
}

describe('contentSecurityPolicy', () => {
  // Without it every saved image in the thread (a pasted image once sent, a
  // tool's screenshot) is refused and shows as "Image not available".
  it('lets saved images load over the attachment scheme', () => {
    expect(policy().get('img-src')).toContain(`${ATTACHMENT_SCHEME}:`);
  });

  it('still refuses remote images', () => {
    expect(policy().get('img-src').some((s) => /^(https?:|\*)/.test(s))).toBe(false);
  });

  it('allows the analytics host, and the hot-reload socket only in dev', () => {
    expect(policy({ env: { VITE_POSTHOG_HOST: 'https://eu.i.posthog.com/x' } }).get('connect-src'))
      .toEqual(["'self'", 'https://eu.i.posthog.com']);
    expect(policy({ server: {} }).get('connect-src')).toContain('ws://localhost:*');
  });
});
