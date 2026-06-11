/**
 * Diff view types shared between DiffView.svelte and plain .ts modules
 * (e.g. diff-highlight). Defined here rather than in DiffView.svelte's module
 * script because `tsc --noEmit` resolves `*.svelte` to an ambient module with
 * only a default export, so named type imports from a .svelte file fail.
 */

export interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'header';
  text: string;
  lineNum?: number;
}

export interface SideBySideRow {
  type: 'context' | 'change' | 'hunk';
  left?: { lineNum?: number; text: string };
  right?: { lineNum?: number; text: string };
  hunkText?: string;
}
