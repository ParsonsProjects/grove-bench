<script>
  /**
   * RPG style dialogue box. Text is typed out a character at a time (or shown
   * at once with `instant`), then a blinking arrow invites you to continue.
   * Backticks in `text` mark code, e.g. "in `.grove-wt/<id>`".
   *
   * @type {{
   *   speaker?: string,
   *   tag?: string,
   *   status?: 'working' | 'permission' | 'ready' | null,
   *   text?: string,
   *   meta?: { label: string, value: string }[],
   *   choices?: { label: string, value: string, hint?: string }[],
   *   instant?: boolean,
   *   mode?: 'story' | 'agent',
   *   nextLabel?: string,
   *   onnext?: () => void,
   *   onchoose?: (value: string) => void,
   *   onclose?: () => void,
   *   id?: string,
   * }}
   */
  let {
    speaker = '',
    tag = '',
    status = null,
    text = '',
    meta = [],
    choices = [],
    instant = false,
    mode = 'story',
    nextLabel = 'Continue',
    onnext,
    onchoose,
    onclose,
    id = 'dialogue',
  } = $props();

  let shown = $state(0);
  let root = $state();
  let choiceEls = $state([]);
  let choiceFocus = $state(0);

  const CPS = 58;

  $effect(() => {
    const full = text;
    if (instant) {
      shown = full.length;
      return;
    }
    shown = 0;
    const start = performance.now();
    let raf = 0;
    const tick = (now) => {
      shown = Math.min(full.length, Math.floor(((now - start) / 1000) * CPS));
      if (shown < full.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  const done = $derived(shown >= text.length);
  const plain = $derived(text.replaceAll('`', ''));

  // Split into plain and code segments, then into typed and not yet typed.
  const segments = $derived.by(() => {
    const parts = text.split('`');
    let used = 0;
    // Backticks count as characters in `shown`; that only nudges timing.
    return parts.map((t, i) => {
      const start = used;
      used += t.length + 1;
      const typed = Math.max(0, Math.min(t.length, shown - start));
      return { code: i % 2 === 1, typed: t.slice(0, typed), rest: t.slice(typed) };
    });
  });

  export function skip() {
    shown = text.length;
  }

  export function focus() {
    root?.focus();
  }

  export function focusChoice(i = 0) {
    choiceEls[i]?.focus();
  }

  function onkeydown(e) {
    if (e.key === 'Escape' && onclose) {
      e.preventDefault();
      onclose();
      return;
    }
    if (e.target !== root) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!done) skip();
      else if (choices.length) focusChoice(0);
      else onnext?.();
    }
  }

  function onChoiceKey(e, i) {
    const n = choices.length;
    if (['ArrowDown', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      focusChoice((i + 1) % n);
    } else if (['ArrowUp', 'ArrowLeft'].includes(e.key)) {
      e.preventDefault();
      focusChoice((i - 1 + n) % n);
    }
  }

  function onBoxClick(e) {
    if (e.target.closest('button')) return;
    if (!done) skip();
  }

  const statusWord = { working: 'Working', permission: 'Waiting for you', ready: 'Ready' };
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={root}
  class="dlg"
  class:agent={mode === 'agent'}
  role={mode === 'agent' ? 'dialog' : 'region'}
  aria-labelledby="{id}-name"
  aria-describedby="{id}-text"
  tabindex="-1"
  {onkeydown}
  onclick={onBoxClick}
>
  <div class="nameplate" id="{id}-name">
    {#if status}
      <span class="dot {status}" aria-hidden="true"></span>
    {/if}
    <span class="name">{speaker}</span>
    {#if tag}<span class="tag">{tag}</span>{/if}
    {#if status}<span class="sr-only">, {statusWord[status]}</span>{/if}
  </div>

  {#if onclose}
    <button class="close" type="button" onclick={onclose} aria-label="Close conversation details">
      <svg viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges">
        <path fill="currentColor" d="M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM3 3h1v1H3zM4 4h1v1H4zM5 5h1v1H5zM6 6h1v1H6zM6 0h1v1H6zM5 1h1v1H5zM4 2h1v1H4zM2 4h1v1H2zM1 5h1v1H1zM0 6h1v1H0z" />
      </svg>
    </button>
  {/if}

  <div class="body">
    {#if meta.length}
      <dl class="meta">
        {#each meta as m}
          <div class="meta-row">
            <dt>{m.label}</dt>
            <dd>{m.value}</dd>
          </div>
        {/each}
      </dl>
    {/if}

    <div class="main">
      <p class="text" aria-hidden="true">
        {#each segments as s}
          {#if s.code}<code><span>{s.typed}</span><span class="ghost">{s.rest}</span></code>{:else}<span>{s.typed}</span><span class="ghost">{s.rest}</span>{/if}
        {/each}
      </p>
      <p class="sr-only" id="{id}-text" aria-live={mode === 'story' ? 'polite' : undefined}>{plain}</p>

      {#if choices.length}
        <div class="choices" class:ready={done} role="group" aria-label="Choose">
          {#each choices as c, i}
            <button
              type="button"
              class="choice"
              bind:this={choiceEls[i]}
              onclick={() => onchoose?.(c.value)}
              onkeydown={(e) => onChoiceKey(e, i)}
              onfocus={() => (choiceFocus = i)}
              onmouseenter={() => (choiceFocus = i)}
              class:current={choiceFocus === i}
            >
              <span class="cursor" aria-hidden="true">
                <svg viewBox="0 0 4 7" width="8" height="14" shape-rendering="crispEdges"><path fill="currentColor" d="M0 0h1v7H0zM1 1h1v5H1zM2 2h1v3H2zM3 3h1v1H3z" /></svg>
              </span>
              {c.label}
              {#if c.hint}<span class="hint">{c.hint}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if done && onnext && !choices.length}
    <button class="next" type="button" onclick={onnext} aria-label={nextLabel}>
      <svg viewBox="0 0 7 4" width="17" height="10" aria-hidden="true" shape-rendering="crispEdges">
        <path fill="currentColor" d="M0 0h7v1H0zM1 1h5v1H1zM2 2h3v1H2zM3 3h1v1H3z" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .dlg {
    --ink: #0b1224;
    --edge: #d9dff0;
    --face: #13203f;
    position: relative;
    min-height: var(--dlg-h, 150px);
    padding: calc(var(--px) * 5) calc(var(--px) * 6) calc(var(--px) * 4);
    color: #eef1f8;
    background:
      linear-gradient(180deg, #1a2b55 0%, var(--face) 55%, #0f1a36 100%);
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    box-shadow:
      /* inner light frame */
      inset 0 0 0 var(--px) var(--edge),
      inset 0 0 0 calc(var(--px) * 2) var(--ink),
      /* chunky outer frame with notched corners */
      0 calc(var(--px) * -1) 0 0 var(--ink),
      0 var(--px) 0 0 var(--ink),
      calc(var(--px) * -1) 0 0 0 var(--ink),
      var(--px) 0 0 0 var(--ink),
      /* drop shadow */
      0 calc(var(--px) * 3) 0 0 rgb(0 0 0 / 0.35);
    outline: none;
    cursor: default;
  }
  .dlg:focus-visible {
    box-shadow:
      inset 0 0 0 var(--px) #ffffff,
      inset 0 0 0 calc(var(--px) * 2) var(--ink),
      0 calc(var(--px) * -1) 0 0 var(--color-primary),
      0 var(--px) 0 0 var(--color-primary),
      calc(var(--px) * -1) 0 0 0 var(--color-primary),
      var(--px) 0 0 0 var(--color-primary),
      0 calc(var(--px) * 3) 0 0 rgb(0 0 0 / 0.35);
  }

  .nameplate {
    position: absolute;
    left: calc(var(--px) * 4);
    top: 0;
    transform: translateY(-62%);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 64px);
    padding: 3px 12px 4px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink);
    background: #e9e1cf;
    box-shadow:
      0 calc(var(--px) * -1) 0 0 var(--ink),
      0 var(--px) 0 0 var(--ink),
      calc(var(--px) * -1) 0 0 0 var(--ink),
      var(--px) 0 0 0 var(--ink);
    white-space: nowrap;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag {
    font-weight: 400;
    font-size: 13px;
    color: #4a4f60;
  }
  .dot {
    width: 9px;
    height: 9px;
    flex: none;
    box-shadow: 0 0 0 2px var(--ink);
  }
  .dot.working {
    background: var(--color-primary);
    animation: dot-pulse 1.5s steps(4) infinite;
  }
  .dot.permission {
    background: #f59e0b;
    animation: dot-pulse 1s steps(4) infinite;
  }
  .dot.ready {
    background: #22c55e;
  }
  @keyframes dot-pulse {
    50% {
      opacity: 0.45;
    }
  }

  .close {
    position: absolute;
    right: calc(var(--px) * 3);
    top: calc(var(--px) * 3);
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    color: #c9d2e8;
  }
  .close:hover {
    color: #ffffff;
  }
  .close:focus-visible,
  .next:focus-visible,
  .choice:focus-visible {
    outline: 2px dashed #ffe7a8;
    outline-offset: 2px;
  }

  .body {
    display: flex;
    gap: 20px;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .text {
    font-size: var(--dlg-font, 18px);
    line-height: 1.45;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }
  .ghost {
    color: transparent;
  }
  code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.86em;
    color: #ffe7a8;
    background: rgb(0 0 0 / 0.25);
    padding: 0 4px;
  }

  .meta {
    order: 2;
    flex: none;
    width: 212px;
    display: grid;
    align-content: start;
    gap: 6px;
    padding-left: 18px;
    border-left: var(--px) solid rgb(217 223 240 / 0.18);
    font-size: 14px;
  }
  .meta-row {
    display: grid;
    gap: 1px;
  }
  .meta dt {
    color: #93a0c0;
    font-size: 13px;
  }
  .meta dd {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    color: #eef1f8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    opacity: 0.35;
    transition: opacity 0.2s steps(3);
  }
  .choices.ready {
    opacity: 1;
  }
  .choice {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 4px 12px 4px 6px;
    font-size: 17px;
    font-weight: 600;
    color: #eef1f8;
    background: rgb(255 255 255 / 0.04);
  }
  .choice .cursor {
    color: #ffe7a8;
    visibility: hidden;
  }
  .choice.current .cursor {
    visibility: visible;
    animation: nudge 0.7s steps(2) infinite;
  }
  .choice.current {
    background: rgb(255 255 255 / 0.1);
  }
  .hint {
    font-weight: 400;
    font-size: 13px;
    color: #93a0c0;
  }
  @keyframes nudge {
    50% {
      transform: translateX(3px);
    }
  }

  .next {
    position: absolute;
    right: calc(var(--px) * 4);
    bottom: calc(var(--px) * 3);
    display: grid;
    place-items: center;
    width: 40px;
    height: 32px;
    color: #ffe7a8;
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      transform: translateY(3px);
      opacity: 0.55;
    }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 639px) {
    .dlg {
      padding: calc(var(--px) * 7) 14px 12px;
    }
    .body {
      flex-direction: column;
      gap: 8px;
    }
    .meta {
      order: 0;
      width: auto;
      padding: 0 0 8px;
      border-left: 0;
      border-bottom: var(--px) solid rgb(217 223 240 / 0.18);
      display: flex;
      flex-wrap: wrap;
      gap: 2px 14px;
    }
    .meta-row {
      display: flex;
      gap: 6px;
      align-items: baseline;
    }
    .choice {
      font-size: 16px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot,
    .choice.current .cursor,
    .next {
      animation: none;
    }
  }
</style>
