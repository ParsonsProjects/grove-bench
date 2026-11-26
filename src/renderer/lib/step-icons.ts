/**
 * Pixel icons for the kinds of step a turn takes (ThreadTurn's summary line
 * and folded line, TurnStep's rows), in place of words such as "3 files
 * read". Drawn on a 12 by 12 grid, one pixel to a CSS pixel at the 12px they
 * show at, like the tab bar's icons. Each is the art below: `#` is a filled
 * pixel. StepIcon draws them; the word stays in a tooltip and for screen
 * readers, so the icon never carries the meaning alone (BRAND.md, Pixel art).
 */
import type { ToolView } from '../../shared/tool-view.js';

export type StepIconKind = 'read' | 'search' | 'edit' | 'run' | 'think' | 'web' | 'tool' | 'asked';

const ART: Record<StepIconKind, readonly string[]> = {
  // A page with a folded corner and two lines of text.
  read: [
    '............',
    '..######....',
    '..#....##...',
    '..#....#.#..',
    '..#....####.',
    '..#.......#.',
    '..#.####..#.',
    '..#.......#.',
    '..#.#####.#.',
    '..#.......#.',
    '..#########.',
    '............',
  ],
  // A magnifying glass.
  search: [
    '............',
    '..####......',
    '.#....#.....',
    '#......#....',
    '#......#....',
    '#......#....',
    '#......#....',
    '.#....#.....',
    '..####.#....',
    '.......##...',
    '........##..',
    '.........##.',
  ],
  // A pencil, point down to the left.
  edit: [
    '............',
    '........##..',
    '.......#..#.',
    '......#..#..',
    '.....#..#...',
    '....#..#....',
    '...#..#.....',
    '..#..#......',
    '.#..#.......',
    '.#.#........',
    '.##.........',
    '............',
  ],
  // A prompt: >_
  run: [
    '............',
    '............',
    '............',
    '.##.........',
    '..##........',
    '...##.......',
    '....##......',
    '...##.......',
    '..##........',
    '.##..######.',
    '............',
    '............',
  ],
  // A thought bubble.
  think: [
    '............',
    '...######...',
    '..#......#..',
    '.#........#.',
    '.#........#.',
    '.#........#.',
    '..#......#..',
    '...######...',
    '............',
    '...##.......',
    '...##.......',
    '.#..........',
  ],
  // A globe: the web (a page fetched, a web search).
  web: [
    '............',
    '....####....',
    '..##.##.##..',
    '.#..#..#..#.',
    '.#..#..#..#.',
    '.##########.',
    '.#..#..#..#.',
    '.#..#..#..#.',
    '..##.##.##..',
    '....####....',
    '............',
    '............',
  ],
  // A plug: another tool (an MCP server's, say).
  tool: [
    '............',
    '...#....#...',
    '...#....#...',
    '..########..',
    '..#......#..',
    '..#......#..',
    '...#....#...',
    '....####....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '............',
  ],
  // A shield: a permission that was answered.
  asked: [
    '............',
    '.##########.',
    '.#........#.',
    '.#........#.',
    '.#........#.',
    '.#........#.',
    '..#......#..',
    '..#......#..',
    '...#....#...',
    '....#..#....',
    '.....##.....',
    '............',
  ],
};

/** The art's filled pixels as runs along each row, for <rect>s. */
export type PixelRun = { x: number; y: number; w: number };

const runsByKind = new Map<StepIconKind, PixelRun[]>();

export function stepIconRuns(kind: StepIconKind): PixelRun[] {
  const known = runsByKind.get(kind);
  if (known) return known;
  const runs: PixelRun[] = [];
  ART[kind].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '#') continue;
      const start = x;
      while (row[x + 1] === '#') x++;
      runs.push({ x: start, y, w: x - start + 1 });
    }
  });
  runsByKind.set(kind, runs);
  return runs;
}

/** Every icon's art, for its test: 12 rows of 12. */
export const STEP_ICON_ART: Readonly<Record<StepIconKind, readonly string[]>> = ART;

/** The icon for a tool call, by what it does. */
export function stepIconFor(view: ToolView): StepIconKind {
  switch (view.kind) {
    case 'read': return 'read';
    case 'search': return 'search';
    case 'edit': return 'edit';
    case 'shell': return 'run';
    case 'fetch':
    case 'web_search': return 'web';
    default: return 'tool';
  }
}
