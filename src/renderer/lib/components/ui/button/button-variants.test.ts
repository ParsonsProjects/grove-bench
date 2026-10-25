import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const RENDERER = path.resolve(__dirname, '../../../..');

/** The blocks where the agent waits on you: a permission, a question, an MCP
 *  form, a limit. */
const ANSWERS = ['PermissionBlock.svelte', 'QuestionBlock.svelte', 'ElicitationBlock.svelte', 'LimitBlock.svelte'];
/** The variant itself, and the kit page that draws every variant. */
const KIT = [path.join('lib', 'components', 'ui', 'button', 'button.svelte'), path.join('ui-kit', 'UiKit.svelte')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(svelte|ts)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

describe('outline-success', () => {
  // docs/ui-kit.md: the app's own actions use subtle-primary or default, or
  // the done-green answer and brand green sit side by side.
  it('only answers what the agent is waiting on', () => {
    const elsewhere = sourceFiles(RENDERER)
      .map((f) => path.relative(RENDERER, f))
      .filter((f) => !ANSWERS.includes(path.basename(f)) && !KIT.includes(f))
      .filter((f) => readFileSync(path.join(RENDERER, f), 'utf8').includes('outline-success'));
    expect(elsewhere).toEqual([]);
  });
});
