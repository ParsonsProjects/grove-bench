const API_KEY = import.meta.env.VITE_POSTHOG_API_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';
const CONSENT_KEY = 'grove_analytics_consent';

const CONFIG = {
  api_host: HOST,
  autocapture: false,
  capture_pageview: true,
  persistence: 'localStorage',
  // Skips the high-entropy client hint for the phone's hardware model.
  disableDeviceModel: true,
};

/**
 * posthog-js, set up, or null if it failed to load. Stays unset until the
 * visitor accepts, so nobody downloads it before then.
 * @type {Promise<import('posthog-js').PostHog | null> | undefined}
 */
let loading;

function load() {
  loading ??= import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(API_KEY, CONFIG);
      return posthog;
    })
    .catch(() => null);
  return loading;
}

/**
 * Initialize landing page analytics.
 * Returns the current consent state: 'accepted', 'declined', or 'pending'.
 */
export function initLandingAnalytics() {
  const consent = localStorage.getItem(CONSENT_KEY);

  if (API_KEY && consent === 'accepted') load();

  return consent || 'pending';
}

export function acceptAnalytics() {
  localStorage.setItem(CONSENT_KEY, 'accepted');
  if (!API_KEY) return;

  // Opting in also captures the initial pageview, since capture_pageview is on.
  load().then((posthog) => posthog?.opt_in_capturing());
}

export function declineAnalytics() {
  localStorage.setItem(CONSENT_KEY, 'declined');
  loading?.then((posthog) => posthog?.opt_out_capturing());
}

export function trackLandingEvent(event, properties) {
  loading?.then((posthog) => posthog?.capture(event, properties));
}
