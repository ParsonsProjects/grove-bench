<script>
  import { onMount } from 'svelte';
  import { initLandingAnalytics } from './lib/analytics.js';
  import ConsentBanner from './ConsentBanner.svelte';
  import Canopy from './canopy/Canopy.svelte';

  let showConsentBanner = $state(false);

  onMount(() => {
    const consent = initLandingAnalytics();
    if (consent === 'pending') {
      showConsentBanner = true;
    }
  });
</script>

<Canopy />

<ConsentBanner visible={showConsentBanner} ondismiss={() => showConsentBanner = false} />
