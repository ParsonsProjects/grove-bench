<script>
  /**
   * A pixel speech bubble with a tail at the bottom centre. `tone` picks the
   * colours: plain cream, `ask` amber (waiting for you), `done` green.
   *
   * @type {{ tone?: 'plain' | 'ask' | 'done' | 'dark', class?: string, children?: import('svelte').Snippet }}
   */
  let { tone = 'plain', class: cls = '', children } = $props();
</script>

<span class="bubble {tone} {cls}">{@render children?.()}</span>

<style>
  .bubble {
    --bg: var(--cream);
    --fg: var(--paper-ink);
    --edge: var(--bark);
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px 4px;
    font-family: var(--font-pixel);
    font-size: 13px;
    line-height: 1.2;
    white-space: nowrap;
    color: var(--fg);
    background: var(--bg);
    box-shadow:
      0 -2px 0 0 var(--edge),
      0 2px 0 0 var(--edge),
      -2px 0 0 0 var(--edge),
      2px 0 0 0 var(--edge);
  }
  .bubble::after {
    content: '';
    position: absolute;
    left: calc(50% - 4px);
    bottom: -8px;
    width: 8px;
    height: 6px;
    background: var(--bg);
    clip-path: polygon(0 0, 100% 0, 50% 100%);
    filter: drop-shadow(0 2px 0 var(--edge));
  }
  .ask {
    --bg: #ffd27a;
    --fg: #3a2306;
    font-size: 16px;
    font-weight: 700;
    animation: bob 1s steps(2) infinite;
  }
  .done {
    --bg: #bff0c4;
    --fg: #12361a;
  }
  .dark {
    --bg: #172340;
    --fg: #e3e7f1;
    --edge: #0b1224;
  }
  .bubble :global(b) {
    font-weight: 700;
  }
  .bubble :global(.read) {
    color: #2b4f9a;
  }
  .bubble :global(.edit) {
    color: #8a5a00;
  }
  .bubble :global(.write) {
    color: #1f6a2c;
  }
  .bubble :global(.bash) {
    color: #7d2a8a;
  }
  @keyframes bob {
    50% {
      transform: translateY(-2px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ask {
      animation: none;
    }
  }
</style>
