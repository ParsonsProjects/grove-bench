<script>
  import './branches.css';
  import { prefersReducedMotion } from '../shared/motion.js';
  import { links, treeGreens } from '../shared/brand.js';
  import PixelTree from '../shared/PixelTree.svelte';
  import { trackLandingEvent } from '../../lib/analytics.js';
  import GitGraph from './GitGraph.svelte';
  import Hero from './Hero.svelte';
  import Commit from './Commit.svelte';
  import AgentCard from './AgentCard.svelte';
  import Isolation from './Isolation.svelte';
  import Rewind from './Rewind.svelte';
  import Memory from './Memory.svelte';
  import Permission from './Permission.svelte';
  import Merge from './Merge.svelte';
  import { agents } from './data.js';
  import { DownloadIcon, GithubIcon } from './icons.js';

  /** @type {HTMLElement | undefined} */
  let logEl = $state();
  /** @type {'pending' | 'allow' | 'always' | 'deny'} */
  let permission = $state('pending');
  let reached = $state(false);
  let vw = $state(1440);

  const reduced = $derived(prefersReducedMotion.current);

  const steps = [
    {
      hash: '1c9a7e4',
      title: 'Add a project',
      text: 'Click + Project and pick a folder that uses git.',
      ui: ['+ Project'],
    },
    {
      hash: 'e7f3b20',
      title: 'Start conversations',
      text: 'Click + Conversation, choose New branch, Existing branch or Direct, then describe the task.',
      ui: ['+ Conversation', 'New branch', 'Existing branch', 'Direct'],
    },
    {
      hash: '94d6c1a',
      title: 'Review and merge',
      text: 'Read the diffs, rewind if a turn went wrong, then merge the branch.',
      ui: ['Changes', 'Checkpoints', 'Terminal'],
    },
  ];

  const footerLinks = [
    { label: 'GitHub', href: links.github },
    { label: 'Releases', href: links.releases },
    { label: 'Contributing', href: links.contributing },
    { label: 'License', href: links.license },
    { label: 'Issues', href: links.issues },
  ];
</script>

<svelte:window bind:innerWidth={vw} />

{#snippet logo(size)}
  <svg width={size} height={Math.round((size * 24) / 21)} viewBox="0 0 21 24" fill="none" aria-hidden="true" style="image-rendering: pixelated">
    {#each treeGreens as p}
      <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
    {/each}
  </svg>
{/snippet}

<div class="bx-page">
  <a class="skip" href="#bx-main">Skip to content</a>

  <nav class="nav" aria-label="Main">
    <div class="bx-wrap nav-inner">
      <a href="#top" class="brand" aria-label="Grove Bench, back to top">
        {@render logo(16)}
        <span>Grove Bench</span>
      </a>
      <span class="nav-log" aria-hidden="true">git log --graph</span>
      <a
        href={links.github}
        target="_blank"
        rel="noopener"
        class="nav-gh"
        onclick={() => trackLandingEvent('github_click', { location: 'branches-nav' })}
      >
        {@html GithubIcon}
        GitHub
      </a>
    </div>
  </nav>

  <main id="bx-main" class="bx-log" bind:this={logEl}>
    <span id="top" class="top-anchor"></span>
    {#if logEl}
      <GitGraph container={logEl} {reduced} pending={permission === 'pending'} bind:reached />
    {/if}

    <Hero {reduced} />

    <!-- 2. Fork -->
    <section class="bx-section" aria-labelledby="h-fork">
      <div class="bx-wrap">
        <div class="bx-col">
          <Commit id="fork" hash="9fceb02" lane="main" headingId="h-fork">
            Every conversation gets its own worktree
            {#snippet sub()}
              Click <code>+ Conversation</code>. Grove Bench makes a branch, a worktree under
              <code>.grove-wt/</code> and a terminal, then the agent gets to work. Add more and they run side by side.
            {/snippet}
          </Commit>
          <div class="cards">
            {#each agents as agent, i (agent.lane)}
              <AgentCard {agent} {reduced} index={i} />
            {/each}
          </div>
        </div>
      </div>
    </section>

    <!-- 3. Isolation -->
    <section class="bx-section" aria-labelledby="h-iso">
      <div class="bx-wrap">
        <div class="bx-col">
          <Commit id="isolation" hash="3e7a1d9" lane="api" headingId="h-iso">
            Three agents. One file. No collisions.
            {#snippet sub()}
              Each agent edits its own copy of <code>src/routes/index.ts</code> in its own worktree. Nobody overwrites
              anybody. You decide what lands when you merge.
            {/snippet}
          </Commit>
          <Isolation {reduced} />
        </div>
      </div>
    </section>

    <!-- 4. Checkpoints -->
    <section class="bx-section" aria-labelledby="h-cp">
      <div class="bx-wrap">
        <div class="bx-col split">
          <div class="split-text">
            <Commit id="checkpoints" hash="8c4f0b2" lane="auth" headingId="h-cp">
              Every message is a checkpoint
              {#snippet sub()}
                Drag back through the turns. See what one turn changed, or everything since. <b>Rewind all</b> puts
                back the files and the conversation together.
              {/snippet}
            </Commit>
          </div>
          <div class="split-widget">
            <Rewind {reduced} />
          </div>
        </div>
      </div>
    </section>

    <!-- 5. Memory -->
    <section class="bx-section" data-section="memory" aria-labelledby="h-mem">
      <div class="bx-wrap">
        <div class="bx-col">
          <Commit id="memory" hash="2d9e6a5" lane="main" headingId="h-mem">
            Notes every conversation reads first
            {#snippet sub()}
              Project memory is plain markdown, kept per project. Agents read it when a conversation starts and write
              down what they learn. Auto-compaction keeps it inside its budget.
            {/snippet}
          </Commit>
          <Memory />
        </div>
      </div>
    </section>

    <!-- 6. Permission -->
    <section class="bx-section" aria-labelledby="h-perm">
      <div class="bx-wrap">
        <div class="bx-col split">
          <div class="split-text">
            <Commit id="permission" hash="6f1c3b8" lane="auth" headingId="h-perm">
              The agent asks. You decide.
              {#snippet sub()}
                When an agent wants to edit a file or run a command, its dot pulses amber and it waits for you. Try
                it. Pick a permission mode per conversation: Default, Plan or Accept Edits.
              {/snippet}
            </Commit>
          </div>
          <div class="split-widget">
            <Permission bind:status={permission} {reduced} />
          </div>
        </div>
      </div>
    </section>

    <!-- 7. Merge -->
    <section class="bx-section" aria-labelledby="h-merge">
      <div class="bx-wrap">
        <div class="bx-col">
          <Commit id="merge" hash="0a7d4e3" lane="main" headingId="h-merge">
            Review it, then bring it home
            {#snippet sub()}
              Check each diff in the Changes tab, unified or side by side, and revert single files. Then merge from
              the terminal, or open a PR with the GitHub CLI.
            {/snippet}
          </Commit>
          <Merge pending={permission === 'pending'} />
        </div>
      </div>
    </section>

    <!-- 8. How it works -->
    <section class="bx-section how" aria-labelledby="h-how">
      <div class="bx-wrap">
        <div class="bx-col">
          <Commit id="how" hash="5b2e8f1" lane="main" headingId="h-how">How it works</Commit>
          <ol class="steps">
            {#each steps as step, i}
              <li class="step">
                <div class="step-meta" data-anchor="step-{i}" data-lane="main" data-kind="row">
                  <code class="bx-hash">{step.hash}</code>
                  <span class="step-n">{i + 1}/3</span>
                </div>
                <div class="step-body">
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
                <div class="step-ui" aria-hidden="true">
                  {#each step.ui as label, j}
                    <span class="ui-chip" class:lead={j === 0}>{label}</span>
                  {/each}
                </div>
              </li>
            {/each}
          </ol>
        </div>
      </div>
    </section>

    <!-- 9. CTA -->
    <section class="bx-section cta" aria-labelledby="h-cta">
      <div class="bx-wrap">
        <div class="bx-col cta-grid">
          <div class="cta-text">
            <Commit id="cta" hash="ea5c9d0" lane="main" head headingId="h-cta">
              Try it on your next task
            </Commit>
            <div class="cta-actions">
              <a
                href={links.releases}
                target="_blank"
                rel="noopener"
                class="btn-primary"
                onclick={() => trackLandingEvent('download_click', { location: 'branches-cta' })}
              >
                {@html DownloadIcon}
                Download for Windows
              </a>
              <a
                href={links.github}
                target="_blank"
                rel="noopener"
                class="btn-secondary"
                onclick={() => trackLandingEvent('github_click', { location: 'branches-cta' })}
              >
                {@html GithubIcon}
                View source
              </a>
            </div>
            <p class="req">Windows 10+, needs git 2.17+ and Claude Code CLI. Free and open source (MIT).</p>
          </div>
          <div class="tree" data-anchor="ground" data-kind="ground">
            {#if reached}
              <PixelTree width={vw < 640 ? 105 : 189} grow label="Grove Bench pixel tree" />
            {:else}
              <PixelTree width={vw < 640 ? 105 : 189} opacity={0.14} />
            {/if}
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="bx-wrap foot-inner">
      <div class="foot-brand">
        {@render logo(12)}
        <span>Grove Bench</span>
        <span class="mit">Open source under MIT</span>
      </div>
      <ul class="foot-links">
        {#each footerLinks as l}
          <li>
            <a
              href={l.href}
              target="_blank"
              rel="noopener"
              onclick={() => trackLandingEvent('footer_click', { location: 'branches-footer', link: l.label })}
            >
              {l.label}
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </footer>
</div>

<style>
  .skip {
    position: absolute;
    left: 16px;
    top: -60px;
    z-index: 100;
    padding: 8px 12px;
    background: var(--color-primary);
    color: #fff;
    font-size: 14px;
  }
  .skip:focus {
    top: 8px;
  }

  .nav {
    position: sticky;
    top: 0;
    z-index: 50;
    border-bottom: 1px solid var(--color-border);
    background: oklch(0.233 0 0 / 0.82);
    backdrop-filter: blur(12px);
  }
  .nav-inner {
    height: 56px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 700;
    color: oklch(0.92 0 0);
  }
  .nav-log {
    display: none;
    font-size: 12px;
    color: oklch(0.5 0 0);
  }
  @media (min-width: 768px) {
    .nav-log {
      display: inline;
    }
  }
  .nav-gh {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    background: var(--color-primary);
    color: #fff;
    transition: filter 0.15s ease;
  }
  .nav-gh:hover {
    filter: brightness(1.15);
  }

  .top-anchor {
    position: absolute;
    top: 0;
  }

  .cards {
    margin-top: 40px;
    display: grid;
    gap: 20px;
  }

  .split {
    display: grid;
    gap: 36px;
  }
  @media (min-width: 1100px) {
    .split {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      gap: 56px;
      align-items: start;
    }
  }
  .split-widget {
    min-width: 0;
  }
  .split-text :global(.bx-sub b) {
    color: oklch(0.88 0 0);
    font-weight: 500;
  }

  .steps {
    list-style: none;
    margin-top: 36px;
    display: grid;
    gap: 0;
  }
  .step {
    display: grid;
    gap: 10px 24px;
    padding: 22px 0;
    border-top: 1px dashed oklch(0.3 0 0);
  }
  .step:last-child {
    border-bottom: 1px dashed oklch(0.3 0 0);
  }
  @media (min-width: 900px) {
    .step {
      grid-template-columns: 140px minmax(0, 1fr) minmax(0, 1fr);
      align-items: center;
    }
  }
  .step-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .step-n {
    color: oklch(0.6 0 0);
  }
  .step-body h3 {
    font-size: 18px;
    font-weight: 700;
    color: oklch(0.93 0 0);
  }
  .step-body p {
    margin-top: 4px;
    font-size: 15px;
    line-height: 1.6;
    color: oklch(0.68 0 0);
  }
  .step-ui {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ui-chip {
    padding: 4px 10px;
    font-size: 12px;
    color: oklch(0.72 0 0);
    background: var(--color-muted);
    border: 1px solid oklch(0.32 0 0);
  }
  .ui-chip.lead {
    color: oklch(0.9 0 0);
    background: oklch(0.541 0.181 254.624 / 0.14);
    border-color: oklch(0.541 0.181 254.624 / 0.4);
  }

  .cta {
    padding-top: 40px;
    padding-bottom: 88px;
  }
  .cta-grid {
    display: grid;
    gap: 40px;
    align-items: end;
  }
  @media (min-width: 900px) {
    .cta-grid {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 64px;
    }
  }
  @media (min-width: 900px) {
    .cta-text {
      padding-bottom: 56px;
    }
  }
  .cta-text :global(.bx-h2) {
    font-size: clamp(30px, 2.4vw + 18px, 52px);
  }
  .cta-actions {
    margin-top: 30px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .req {
    margin-top: 18px;
    font-size: 13px;
    line-height: 1.6;
    color: oklch(0.62 0 0);
    max-width: 52ch;
  }
  .tree {
    justify-self: start;
    line-height: 0;
    filter: drop-shadow(0 0 28px oklch(0.5 0.15 145 / 0.35));
  }
  @media (min-width: 900px) {
    .tree {
      justify-self: end;
      margin-right: 8%;
    }
  }

  .footer {
    border-top: 1px solid var(--color-border);
    background: var(--color-card);
  }
  .foot-inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px 32px;
    padding-block: 28px;
  }
  .foot-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: oklch(0.75 0 0);
  }
  .mit {
    color: oklch(0.55 0 0);
    margin-left: 6px;
  }
  .foot-links {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 22px;
  }
  .foot-links a {
    font-size: 13px;
    color: oklch(0.65 0 0);
    transition: color 0.15s ease;
  }
  .foot-links a:hover {
    color: oklch(0.92 0 0);
  }
</style>
