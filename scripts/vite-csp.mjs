import { ATTACHMENT_SCHEME } from '../src/shared/attachments.ts';

/**
 * Content Security Policy for the app window, as a <meta> tag (the renderer
 * loads from file://, which has no response headers). The preload bridge can
 * reach the shell and PTYs, so script injection must not run: only the app's
 * own bundled scripts, no inline scripts or eval. Inline styles stay allowed
 * (Svelte, bits-ui and xterm set them). Images are local, data:, blob: or a
 * conversation's saved images (the attachment scheme) only, so agent markdown
 * can't make the app request a remote image URL, a known way to leak
 * conversation data. connect-src allows the analytics host.
 */
export function contentSecurityPolicy() {
  let env = {};
  return {
    name: 'grove-csp',
    configResolved(config) {
      env = config.env;
    },
    transformIndexHtml(_html, ctx) {
      const connect = ["'self'", new URL(env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').origin];
      // Vite's hot-reload websocket in dev.
      if (ctx.server) connect.push('ws://localhost:*');
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: blob: ${ATTACHMENT_SCHEME}:`,
        "font-src 'self' data:",
        "media-src 'self' data: blob:",
        `connect-src ${connect.join(' ')}`,
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ');
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
    },
  };
}
