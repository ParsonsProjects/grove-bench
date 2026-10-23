<script>
  import { onMount } from 'svelte';
  import { initLandingAnalytics } from './lib/analytics.js';
  import ConsentBanner from './ConsentBanner.svelte';
  import Trail from './trail/Trail.svelte';

  let showConsentBanner = $state(false);

  onMount(() => {
    const consent = initLandingAnalytics();
    if (consent === 'pending') {
      showConsentBanner = true;
    }
  });
</script>

<Trail />

<ConsentBanner visible={showConsentBanner} ondismiss={() => showConsentBanner = false} />
