<script>
  import { statusColors } from '../shared/brand.js';

  /** @type {{ status: 'working' | 'permission' | 'ready' | 'stopped' | 'error', size?: number, label?: boolean }} */
  let { status, size = 8, label = false } = $props();

  const names = {
    working: 'Working',
    permission: 'Waiting for permission',
    ready: 'Ready',
    stopped: 'Stopped',
    error: 'Error',
  };
</script>

<span
  class="dot"
  class:pulse={status === 'working' || status === 'permission'}
  style="--c: {statusColors[status]}; width: {size}px; height: {size}px"
  aria-hidden="true"
></span>
{#if label}<span class="sr-only">{names[status]}</span>{/if}

<style>
  .dot {
    display: inline-block;
    flex-shrink: 0;
    background: var(--c);
    transition: background-color 0.3s ease;
  }
  .pulse {
    animation: dot-pulse 1.4s ease-in-out infinite;
  }
  @keyframes dot-pulse {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 0 0 color-mix(in oklch, var(--c) 55%, transparent);
    }
    50% {
      opacity: 0.45;
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--c) 0%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }
</style>
