<script>
  import { slide } from 'svelte/transition';
  import { prefersReducedMotion } from '../shared/motion.js';

  /** @type {{ m: any, pane: import('./sim.svelte.js').Pane, sim: import('./sim.svelte.js').Sim }} */
  let { m, pane, sim } = $props();

  const ms = (/** @type {number} */ n) => (prefersReducedMotion.current ? 0 : n);
  const typing = $derived(m.kind === 'say' && m.shown < m.text.length);

  function toggle() {
    m.open = !m.open;
    m.touched = true;
  }
</script>

{#if m.kind === 'user'}
  <div class="user">
    <span class="gt" aria-hidden="true">&gt;</span>
    <p>{m.text}</p>
  </div>
{:else if m.kind === 'say'}
  <p class="say">
    {m.text.slice(0, Math.floor(m.shown))}{#if typing}<span class="caret" aria-hidden="true"></span>{/if}
  </p>
{:else if m.kind === 'read'}
  <div class="tool">
    <span class="name">Read</span>
    <span class="path">{m.file}</span>
    {#if m.pending}
      <span class="busy" aria-label="running"></span>
    {:else}
      <span class="meta">{m.lines} lines</span>
    {/if}
  </div>
{:else if m.kind === 'edit'}
  <div class="tool edit">
    <button class="edit-head" aria-expanded={m.open} onclick={toggle} title={m.open ? 'Hide diff' : 'Show diff'}>
      <span class="name primary">{m.isNew ? '+ new' : 'edit'}</span>
      <span class="path">{m.file}</span>
      {#if m.pending}
        <span class="busy" aria-label="running"></span>
      {:else}
        <span class="counts"><span class="plus">+{m.add}</span>{#if m.del}<span class="minus">-{m.del}</span>{/if}</span>
      {/if}
      <svg class="chev" class:open={m.open} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2h2v2h2v2H5v2H3z" fill="currentColor" /></svg>
    </button>
    {#if m.open}
      <div class="diff" transition:slide={{ duration: ms(260) }}>
        {#each m.diff as [sign, text], i (i)}
          <div class="dl" class:a={sign === '+'} class:d={sign === '-'}><span class="sign" aria-hidden="true">{sign}</span>{text}</div>
        {/each}
      </div>
    {/if}
  </div>
{:else if m.kind === 'bash'}
  <div class="tool bash">
    <div class="bash-head">
      <span class="dollar" aria-hidden="true">$</span>
      <code>{m.cmd}</code>
      {#if m.pending}
        <span class="busy" aria-label="running"></span>
      {:else}
        <span class="meta">done</span>
      {/if}
    </div>
    {#if m.out.length}
      <div class="out">
        {#each m.out as line, i (i)}
          <div class="ol" class:ok={line.ok}>
            {#if line.ok}<span class="tick" aria-hidden="true">✓</span>{/if}{line.text}
          </div>
        {/each}
        {#if m.summary}
          <div class="summary">{m.summary}</div>
        {/if}
      </div>
    {/if}
  </div>
{:else if m.kind === 'perm'}
  {#if !m.decided}
    <div class="perm" role="group" aria-label="Permission required: {m.tool} {m.target}">
      <p class="perm-title">Permission required</p>
      <p class="perm-target"><span class="name">{m.tool}</span> <span class="path">{m.target}</span></p>
      {#if m.diff}
        <div class="diff boxed">
          {#each m.diff as [sign, text], i (i)}
            <div class="dl" class:a={sign === '+'} class:d={sign === '-'}><span class="sign" aria-hidden="true">{sign}</span>{text}</div>
          {/each}
        </div>
      {:else}
        <div class="diff boxed"><div class="dl"><span class="sign dollar" aria-hidden="true">$</span>{m.target}</div></div>
      {/if}
      <div class="perm-btns">
        <button class="pb allow" onclick={() => sim.decide(pane, 'allow')}>Allow</button>
        <button class="pb" onclick={() => sim.decide(pane, 'deny')}>Deny</button>
        <button class="pb ghost" onclick={() => sim.decide(pane, 'always')}>Always allow</button>
      </div>
      {#if sim.autoplay && pane.perm}
        <div class="countdown">
          <div class="track"><div class="fill" style="transform: scaleX({pane.perm.left / pane.perm.total})"></div></div>
          <span>Autoplay allows in {Math.ceil(pane.perm.left / 1000)}s</span>
        </div>
      {/if}
    </div>
  {:else}
    <div class="perm-done" class:denied={m.decided === 'deny'}>
      <span class="verdict">{m.decided === 'deny' ? 'Denied' : m.always ? 'Always allowed' : 'Allowed'}</span>
      <span class="name">{m.tool}</span>
      <span class="path">{m.target}</span>
      {#if m.auto}<span class="meta">autoplay</span>{/if}
    </div>
  {/if}
{/if}

<style>
  p {
    margin: 0;
  }
  .user {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.625rem;
    background: color-mix(in oklch, var(--color-primary) 9%, transparent);
    border-left: 2px solid var(--color-primary);
    color: var(--color-foreground);
    font-size: 12px;
    line-height: 1.5;
  }
  .gt {
    color: var(--color-primary);
  }
  .say {
    font-size: 12px;
    line-height: 1.55;
    color: oklch(0.8 0 0);
    padding: 0 0.125rem;
  }
  .caret {
    display: inline-block;
    width: 0.5em;
    height: 1.05em;
    margin-left: 1px;
    vertical-align: -0.15em;
    background: var(--color-primary);
    animation: blink 0.9s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .tool {
    border-left: 3px solid var(--color-border);
    padding: 0.125rem 0 0.125rem 0.625rem;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .tool.edit,
  .tool.bash {
    display: block;
  }
  .tool.edit {
    border-left-color: var(--color-primary);
  }
  .name {
    font-weight: 700;
    color: var(--color-muted-foreground);
    flex-shrink: 0;
  }
  .name.primary {
    color: oklch(0.66 0.16 254.6);
  }
  .path {
    color: oklch(0.78 0 0);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .meta {
    color: var(--color-muted-foreground);
    font-size: 11px;
    flex-shrink: 0;
  }
  .busy {
    width: 8px;
    height: 8px;
    background: var(--color-primary);
    flex-shrink: 0;
    animation: busy 0.8s ease-in-out infinite;
  }
  @keyframes busy {
    50% {
      opacity: 0.3;
    }
  }
  .edit-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .edit-head:hover .path {
    color: var(--color-foreground);
  }
  .counts {
    display: flex;
    gap: 0.375rem;
    font-size: 11px;
    flex-shrink: 0;
  }
  .plus {
    color: #4ade80;
  }
  .minus {
    color: #f87171;
  }
  .chev {
    color: var(--color-muted-foreground);
    flex-shrink: 0;
    transition: transform 0.2s ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .diff {
    margin-top: 0.375rem;
    font-size: 11px;
    line-height: 1.6;
  }
  .diff.boxed {
    border: 1px solid var(--color-border);
    background: var(--color-background);
    margin: 0.375rem 0 0.5rem;
  }
  .dl {
    padding: 0 0.5rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: oklch(0.7 0 0);
  }
  .dl.a {
    background: color-mix(in oklch, #22c55e 13%, transparent);
    color: #86efac;
  }
  .dl.d {
    background: color-mix(in oklch, #ef4444 13%, transparent);
    color: #fca5a5;
  }
  .sign {
    display: inline-block;
    width: 1.25em;
    opacity: 0.8;
  }
  .dollar {
    color: #22d3ee;
    font-weight: 700;
  }
  .bash-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .bash-head code {
    font: inherit;
    color: var(--color-foreground);
    flex: 1;
    min-width: 0;
  }
  .out {
    margin-top: 0.25rem;
    font-size: 11px;
    line-height: 1.65;
    color: var(--color-muted-foreground);
  }
  .ol.ok {
    color: oklch(0.78 0 0);
  }
  .tick {
    color: #4ade80;
    margin-right: 0.5em;
    display: inline-block;
    animation: tick-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  @keyframes tick-in {
    from {
      transform: scale(0);
    }
  }
  .summary {
    color: #4ade80;
    font-weight: 700;
    margin-top: 0.125rem;
  }

  .perm {
    border-left: 3px solid #f59e0b;
    background: color-mix(in oklch, #f59e0b 7%, transparent);
    padding: 0.5rem 0.625rem 0.625rem;
    font-size: 12px;
  }
  .perm-title {
    color: #f59e0b;
    font-weight: 700;
  }
  .perm-target {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.125rem;
    min-width: 0;
  }
  .perm-target .name {
    color: var(--color-foreground);
  }
  .perm-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .pb {
    font: inherit;
    font-size: 11px;
    padding: 0.3rem 0.625rem;
    background: var(--color-muted);
    color: var(--color-foreground);
    border: 1px solid var(--color-border);
    cursor: pointer;
    transition:
      filter 0.15s ease,
      transform 0.15s ease;
  }
  .pb:hover {
    filter: brightness(1.25);
  }
  .pb:active {
    transform: translateY(1px);
  }
  .pb.allow {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
    font-weight: 700;
  }
  .pb.ghost {
    background: transparent;
    color: var(--color-muted-foreground);
  }
  .countdown {
    margin-top: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 11px;
    color: color-mix(in oklch, #f59e0b 80%, white);
  }
  .countdown .track {
    width: 56px;
    height: 3px;
    background: color-mix(in oklch, #f59e0b 20%, transparent);
    flex-shrink: 0;
  }
  .countdown .fill {
    height: 100%;
    background: #f59e0b;
    transform-origin: left;
  }
  .perm-done {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 12px;
    border-left: 3px solid #4ade80;
    padding: 0.125rem 0 0.125rem 0.625rem;
    min-width: 0;
  }
  .perm-done .verdict {
    color: #4ade80;
    font-weight: 700;
    flex-shrink: 0;
  }
  .perm-done.denied {
    border-left-color: #f87171;
  }
  .perm-done.denied .verdict {
    color: #f87171;
  }

  @media (prefers-reduced-motion: reduce) {
    .caret,
    .busy,
    .tick {
      animation: none;
    }
    .chev {
      transition: none;
    }
  }
</style>
