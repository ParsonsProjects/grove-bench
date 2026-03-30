import posthog from 'posthog-js';

const API_KEY = import.meta.env.VITE_POSTHOG_API_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';

let initialized = false;

function ensureInitialized(): boolean {
  if (initialized) return true;
  if (!API_KEY) return false;

  posthog.init(API_KEY, {
    api_host: HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    persistence: 'localStorage',
  });

  initialized = true;
  return true;
}

/**
 * Enable or disable analytics. When enabling for the first time,
 * PostHog is initialized lazily — no init happens until the user consents.
 */
export function setAnalyticsEnabled(enabled: boolean): void {
  if (enabled) {
    if (ensureInitialized()) {
      posthog.opt_in_capturing();
    }
  } else if (initialized) {
    posthog.opt_out_capturing();
  }
}

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

export function shutdownAnalytics(): void {
  if (!initialized) return;
  posthog.reset();
  initialized = false;
}
