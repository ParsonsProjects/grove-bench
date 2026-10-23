<script>
  import { acceptAnalytics, declineAnalytics } from './lib/analytics.js';

  let { visible = false, ondismiss } = $props();

  function handleAccept() {
    acceptAnalytics();
    ondismiss();
  }

  function handleDecline() {
    declineAnalytics();
    ondismiss();
  }
</script>

<!-- A bar in the app's own look (its dark theme): dark, square, 1px edges,
     a brand green button. -->
{#if visible}
  <div class="consent" role="region" aria-label="Analytics consent">
    <div class="in">
      <p>We use analytics to understand how visitors find Grove Bench. No personal data is collected.</p>
      <div class="btns">
        <button type="button" class="decline" onclick={handleDecline}>Decline</button>
        <button type="button" class="accept" onclick={handleAccept}>Accept</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .consent {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    color: var(--night-foreground);
    background: color-mix(in srgb, var(--night-card) 96%, transparent);
    border-top: 1px solid var(--night-border);
    backdrop-filter: blur(6px);
    font-family: var(--font-mono);
  }
  .in {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
    max-width: 1120px;
    margin: 0 auto;
    padding: 14px 20px;
  }
  p {
    flex: 1 1 320px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--night-muted-foreground);
  }
  .btns {
    display: flex;
    gap: 8px;
  }
  button {
    min-height: 34px;
    padding: 6px 14px;
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
    border: 1px solid var(--night-input);
  }
  .decline {
    color: var(--night-muted-foreground);
    background: transparent;
  }
  .decline:hover {
    color: var(--night-bright);
  }
  .accept {
    font-weight: 600;
    color: var(--canopy);
    background: var(--leaf);
    border-color: var(--leaf);
  }
  .accept:hover {
    filter: brightness(1.1);
  }
  button:focus-visible {
    outline: 2px solid var(--leaf);
    outline-offset: 2px;
  }
</style>
