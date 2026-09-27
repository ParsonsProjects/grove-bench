<script>
  import { prefersReducedMotion } from '../../shared/motion.js';
  import { timeline } from '../timeline.js';

  const H = 24; // row height in px
  const H_WRAP = 40; // side by side on narrow screens: two wrapped lines per row

  /** @type {{ k: ' ' | '-' | '+', o?: number, n?: number, t: string }[]} */
  const LINES = [
    { k: ' ', o: 12, n: 12, t: 'function requireAuth(req, res, next) {' },
    { k: '-', o: 13, t: '  const token = req.headers.token' },
    { k: '+', n: 13, t: "  const auth = req.get('authorization')" },
    { k: '+', n: 14, t: '  const token = auth?.slice(7)' },
    { k: ' ', o: 14, n: 15, t: '  if (!token) return res.sendStatus(401)' },
    { k: '-', o: 15, t: '  req.user = jwt.decode(token)' },
    { k: '+', n: 16, t: '  req.user = jwt.verify(token, KEY)' },
    { k: ' ', o: 16, n: 17, t: '  next()' },
  ];

  // Every visible line in both layouts. Context lines exist twice: the left
  // copy shows in unified view, the right copy slides out for side by side.
  const items = (() => {
    /** @type {{ key: string, k: string, side: 'L' | 'R', num: number, t: string, u: number, s: number, ghost: boolean, i: number }[]} */
    const out = [];
    let row = 0;
    let i = 0;
    while (i < LINES.length) {
      const line = LINES[i];
      if (line.k === ' ') {
        out.push({ key: `c${i}L`, k: ' ', side: 'L', num: line.o ?? 0, t: line.t, u: i, s: row, ghost: false, i });
        out.push({ key: `c${i}R`, k: ' ', side: 'R', num: line.n ?? 0, t: line.t, u: i, s: row, ghost: true, i });
        row++;
        i++;
        continue;
      }
      // A block of removals followed by additions pairs up row by row.
      let dels = 0;
      let adds = 0;
      while (i < LINES.length && LINES[i].k === '-') {
        const l = LINES[i];
        out.push({ key: `d${i}`, k: '-', side: 'L', num: l.o ?? 0, t: l.t, u: i, s: row + dels, ghost: false, i });
        dels++;
        i++;
      }
      while (i < LINES.length && LINES[i].k === '+') {
        const l = LINES[i];
        out.push({ key: `a${i}`, k: '+', side: 'R', num: l.n ?? 0, t: l.t, u: i, s: row + adds, ghost: false, i });
        adds++;
        i++;
      }
      row += Math.max(dels, adds);
    }
    return { list: out, splitRows: row };
  })();

  let split = $state(false);
  let auto = $state(true);
  let diffWidth = $state(600);

  const narrow = $derived(diffWidth < 600);
  const rowH = $derived(split && narrow ? H_WRAP : H);
  const height = $derived((split ? items.splitRows : LINES.length) * rowH);

  /** @param {typeof items.list[number]} it */
  function place(it) {
    const top = (split ? it.s : it.u) * rowH;
    const left = split && it.side === 'R' ? '50%' : '0%';
    const width = split ? '50%' : '100%';
    const opacity = !split && it.ghost ? 0 : 1;
    return `top: ${top}px; height: ${rowH}px; left: ${left}; width: ${width}; opacity: ${opacity}; transition-delay: ${it.i * 28}ms`;
  }

  /** @param {boolean} value */
  function choose(value) {
    auto = false;
    split = value;
  }

  /** @type {HTMLDivElement | undefined} */
  let root = $state();

  $effect(() => {
    if (!root || !auto || prefersReducedMotion.current) return;
    return timeline(root, [{ wait: 3400, run: () => (split = !split) }]);
  });
</script>

<div class="changes" bind:this={root}>
  <div class="head">
    <span class="badge" aria-hidden="true">M</span>
    <span class="file">src/middleware/auth.ts</span>
    <span class="plus">+3</span><span class="minus">-2</span>
    <div class="toggle" role="group" aria-label="Diff layout">
      <button aria-pressed={!split} class:on={!split} onclick={() => choose(false)}>Unified</button>
      <button aria-pressed={split} class:on={split} onclick={() => choose(true)}>Side by side</button>
    </div>
  </div>
  <div
    class="diff"
    class:split
    class:wrap={split && narrow}
    bind:clientWidth={diffWidth}
    style="height: {height}px"
    role="img"
    aria-label="Diff of src/middleware/auth.ts in {split ? 'side by side' : 'unified'} view: 3 lines added, 2 removed"
  >
    <span class="divider" aria-hidden="true"></span>
    {#each items.list as it (it.key)}
      <div class="row" class:a={it.k === '+'} class:d={it.k === '-'} style={place(it)} aria-hidden="true">
        <span class="num">{it.num}</span>
        <span class="sg">{it.k}</span>
        <span class="tx">{it.t}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .changes {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    height: 100%;
    font-size: 12px;
  }
  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem 0.625rem;
  }
  .badge {
    color: #f59e0b;
    font-weight: 700;
    font-size: 11px;
  }
  .file {
    color: var(--color-foreground);
  }
  .plus {
    color: #4ade80;
    font-size: 11px;
  }
  .minus {
    color: #f87171;
    font-size: 11px;
  }
  .toggle {
    margin-left: auto;
    display: flex;
    border: 1px solid var(--color-border);
  }
  .toggle button {
    font: inherit;
    font-size: 11px;
    padding: 0.3rem 0.625rem;
    color: var(--color-muted-foreground);
    background: none;
    border: 0;
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      color 0.2s ease;
  }
  .toggle button.on {
    background: var(--color-muted);
    color: var(--color-foreground);
  }
  .diff {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--color-border);
    background: var(--color-background);
    box-sizing: content-box;
    transition: height 0.6s cubic-bezier(0.65, 0, 0.35, 1);
  }
  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    background: var(--color-border);
    opacity: 0;
    transition: opacity 0.4s ease;
  }
  .split .divider {
    opacity: 1;
  }
  .row {
    position: absolute;
    display: flex;
    align-items: center;
    font-size: 11px;
    color: oklch(0.72 0 0);
    white-space: pre;
    overflow: hidden;
    transition-property: top, left, width, height, opacity;
    transition-duration: 0.6s;
    transition-timing-function: cubic-bezier(0.65, 0, 0.35, 1);
  }
  .row.a {
    background: color-mix(in oklch, #22c55e 13%, var(--color-background));
    color: #86efac;
  }
  .row.d {
    background: color-mix(in oklch, #ef4444 13%, var(--color-background));
    color: #fca5a5;
  }
  .num {
    flex-shrink: 0;
    width: 3.2em;
    padding-right: 0.6em;
    text-align: right;
    color: oklch(0.45 0 0);
  }
  .sg {
    flex-shrink: 0;
    width: 1.4em;
    opacity: 0.8;
  }
  .tx {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .wrap .row {
    align-items: flex-start;
    padding-top: 3px;
    line-height: 17px;
  }
  .wrap .num {
    display: none;
  }
  .wrap .sg {
    padding-left: 0.4em;
  }
  .wrap .tx {
    white-space: pre-wrap;
    word-break: break-all;
  }
  @media (prefers-reduced-motion: reduce) {
    .row,
    .diff,
    .divider {
      transition: none;
    }
  }
</style>
