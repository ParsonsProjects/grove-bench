<script>
  import { onMount } from 'svelte';
  import { initLandingAnalytics } from './lib/analytics.js';
  import ConsentBanner from './ConsentBanner.svelte';
  // The Canopy design (prototype F) is the landing page. The other
  // prototypes stay under src/prototypes for comparison.
  import Canopy from './prototypes/canopy/Canopy.svelte';

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
