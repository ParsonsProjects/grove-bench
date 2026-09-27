<script>
  import Commit from '../Commit.svelte';
  import { hashes } from '../data.js';

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
      text: 'Click + Conversation for each task. Choose New branch, Existing branch or Direct, then describe the task.',
      ui: ['+ Conversation', 'New branch', 'Existing branch', 'Direct'],
    },
    {
      hash: '94d6c1a',
      title: 'Review and ship',
      text: 'Read the diffs, rewind a turn if needed, then open a PR from the app or merge the branch your usual way.',
      ui: ['Changes', 'Checkpoints', 'Create PR'],
    },
  ];
</script>

<section class="lg-section how" aria-labelledby="h-how">
  <div class="lg-wrap">
    <div class="lg-col">
      <Commit id="how" hash={hashes.how} title="How it works" headingId="h-how" />
      <ol class="steps">
        {#each steps as step, i}
          <li class="step">
            <div class="meta" data-anchor="step-{i}" data-lanes="main" data-kind="row">
              <code class="lg-hash">{step.hash}</code>
              <span class="n">{i + 1}/3</span>
            </div>
            <div class="body">
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
            <div class="ui" aria-hidden="true">
              {#each step.ui as label, j}
                <span class="chip" class:lead={j === 0}>{label}</span>
              {/each}
            </div>
          </li>
        {/each}
      </ol>
    </div>
  </div>
</section>

<style>
  .how {
    padding-bottom: 24px;
  }
  .steps {
    list-style: none;
    margin-top: 28px;
  }
  .step {
    display: grid;
    gap: 10px 24px;
    padding: 20px 0;
    border-top: 1px dashed oklch(0.32 0 0);
  }
  .step:last-child {
    border-bottom: 1px dashed oklch(0.32 0 0);
  }
  @media (min-width: 900px) {
    .step {
      grid-template-columns: 120px minmax(0, 1fr) minmax(0, 0.9fr);
      align-items: center;
    }
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .n {
    color: oklch(0.62 0 0);
  }
  h3 {
    font-size: 18px;
    font-weight: 700;
    color: oklch(0.93 0 0);
  }
  p {
    margin-top: 4px;
    font-size: 15px;
    line-height: 1.6;
    color: oklch(0.7 0 0);
  }
  .ui {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    padding: 4px 10px;
    font-size: 12px;
    color: oklch(0.75 0 0);
    background: var(--color-muted);
    border: 1px solid oklch(0.34 0 0);
  }
  .chip.lead {
    color: oklch(0.92 0 0);
    background: oklch(0.541 0.181 254.624 / 0.16);
    border-color: oklch(0.541 0.181 254.624 / 0.45);
  }
</style>
