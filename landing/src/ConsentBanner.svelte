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

{#if visible}
  <div class="fixed bottom-0 left-0 right-0 z-[100] border-t border-border bg-card/95 backdrop-blur-sm">
    <div class="max-w-5xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
      <p class="text-xs text-muted-foreground text-center sm:text-left">
        We use analytics to understand how visitors find Grove Bench. No personal data is collected.
      </p>
      <div class="flex items-center gap-2 shrink-0">
        <button
          onclick={handleDecline}
          class="px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          Decline
        </button>
        <button
          onclick={handleAccept}
          class="px-3 py-1.5 text-xs bg-primary text-primary-foreground font-medium hover:brightness-110 transition-all cursor-pointer"
        >
          Accept
        </button>
      </div>
    </div>
  </div>
{/if}
