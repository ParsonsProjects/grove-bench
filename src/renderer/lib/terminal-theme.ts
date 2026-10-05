import type { ITheme } from '@xterm/xterm';

/**
 * Terminal tab colours, VS Code's own for each theme. The ANSI colours are
 * VS Code's defaults (ansiColorMap in
 * src/vs/workbench/contrib/terminal/common/terminalColorRegistry.ts).
 * DARK's other colours are the ones the terminal has always used.
 */
const DARK: ITheme = {
  background: '#1f1f1f',
  foreground: '#cccccc',
  cursor: '#cccccc',
  selectionBackground: '#04395e',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

const LIGHT: ITheme = {
  background: '#ffffff',
  // Light Modern's terminal.foreground and terminalCursor.foreground, and
  // the light editor.selectionBackground default (editorColors.ts)
  foreground: '#3b3b3b',
  cursor: '#005fb8',
  // The character under the block cursor (xterm's default is black, 3.3:1)
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  black: '#000000',
  red: '#cd3131',
  green: '#107c10',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#a5a5a5',
};

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** The xterm options that set colours. Several light ANSI colours are near
 *  2:1 on white (bright yellow, green, cyan), so light also asks xterm to
 *  darken text to 4.5:1 (WCAG AA), as VS Code does by default
 *  (terminal.integrated.minimumContrastRatio). Dark keeps its colours as
 *  they were. */
export function terminalColors(light: boolean): { theme: ITheme; minimumContrastRatio: number } {
  return light ? { theme: LIGHT, minimumContrastRatio: 4.5 } : { theme: DARK, minimumContrastRatio: 1 };
}

/** Whether the app is drawn light. Main sets prefers-color-scheme from the
 *  Theme setting, so this follows the setting as well as Windows. */
export function prefersLight(): boolean {
  return window.matchMedia?.(LIGHT_QUERY).matches ?? false;
}

/** Calls `listener` when the app switches between light and dark. Returns
 *  a function that stops listening. */
export function onColorSchemeChange(listener: (light: boolean) => void): () => void {
  const query = window.matchMedia?.(LIGHT_QUERY);
  if (!query?.addEventListener) return () => {};
  const handle = (e: MediaQueryListEvent) => listener(e.matches);
  query.addEventListener('change', handle);
  return () => query.removeEventListener('change', handle);
}
