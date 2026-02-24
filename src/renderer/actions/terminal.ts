import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

export function terminal(node: HTMLElement, sessionId: string) {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
    theme: {
      background: '#0a0a0a',
      foreground: '#e5e5e5',
      cursor: '#e5e5e5',
      selectionBackground: '#3b82f680',
    },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(node);

  // Initial fit
  requestAnimationFrame(() => {
    fitAddon.fit();
    window.groveBench.termResize(sessionId, term.cols, term.rows);
  });

  // Wire user input → PTY
  const inputDisposable = term.onData((data) => {
    window.groveBench.termWrite(sessionId, data);
  });

  // Wire PTY output → terminal
  const cleanup = window.groveBench.onTermData(sessionId, (data) => {
    term.write(data);
  });

  // Handle resize
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    window.groveBench.termResize(sessionId, term.cols, term.rows);
  });
  resizeObserver.observe(node);

  return {
    destroy() {
      inputDisposable.dispose();
      cleanup();
      window.groveBench.offTermData(sessionId);
      resizeObserver.disconnect();
      term.dispose();
    },
  };
}
