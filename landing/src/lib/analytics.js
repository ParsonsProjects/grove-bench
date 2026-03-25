import posthog from 'posthog-js';

const API_KEY = import.meta.env.VITE_POSTHOG_API_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';
const CONSENT_KEY = 'grove_analytics_consent';

let initialized = false;

/**
 * Initialize landing page analytics.
 * Returns the current consent state: 'accepted', 'declined', or 'pending'.
 */
export function initLandingAnalytics() {
  const consent = localStorage.getItem(CONSENT_KEY);

  if (!API_KEY) return consent || 'pending';

  if (consent === 'accepted') {
    posthog.init(API_KEY, {
      api_host: HOST,
      autocapture: false,
      capture_pageview: true,
      persistence: 'localStorage',
    });
    initialized = true;
  }

  return consent || 'pending';
}

export function acceptAnalytics() {
  localStorage.setItem(CONSENT_KEY, 'accepted');
  if (!API_KEY) return;

  if (!initialized) {
    posthog.init(API_KEY, {
      api_host: HOST,
      autocapture: false,
      capture_pageview: true,
      persistence: 'localStorage',
    });
    initialized = true;
  }
  posthog.opt_in_capturing();
  posthog.capture('$pageview');
}

export function declineAnalytics() {
  localStorage.setItem(CONSENT_KEY, 'declined');
  if (initialized) {
    posthog.opt_out_capturing();
  }
}

export function trackLandingEvent(event, properties) {
  if (!initialized) return;
  posthog.capture(event, properties);
}
