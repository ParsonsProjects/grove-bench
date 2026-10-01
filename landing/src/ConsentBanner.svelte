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

<!-- A bar in the app's own look: dark, square, 1px edges. -->
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
    color: oklch(0.835 0 0);
    background: oklch(0.233 0 0 / 0.96);
    border-top: 1px solid oklch(0.26 0 0);
    backdrop-filter: blur(6px);
    font-family: 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace;
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
    color: oklch(0.72 0 0);
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
    border: 1px solid oklch(0.32 0 0);
  }
  .decline {
    color: oklch(0.72 0 0);
    background: transparent;
  }
  .decline:hover {
    color: oklch(0.9 0 0);
  }
  .accept {
    font-weight: 600;
    color: #fff;
    background: oklch(0.541 0.181 254.624);
    border-color: oklch(0.541 0.181 254.624);
  }
  .accept:hover {
    filter: brightness(1.1);
  }
  button:focus-visible {
    outline: 2px solid oklch(0.707 0.165 254.624);
    outline-offset: 2px;
  }
</style>
