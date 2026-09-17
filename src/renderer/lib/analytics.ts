import type { AppErrorReport } from '../../shared/types.js';

type PostHog = typeof import('posthog-js').default;

const API_KEY = import.meta.env.VITE_POSTHOG_API_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';

// posthog-js is loaded on demand: it is a sizeable dependency that nothing
// needs until the user has opted in, so keeping it out of the startup bundle
// shortens the renderer's time to first paint.
let posthog: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
let desiredEnabled = false;
let crashReportsEnabled = false;

function ensureInitialized(): Promise<PostHog | null> {
  if (posthog) return Promise.resolve(posthog);
  if (!API_KEY) return Promise.resolve(null);
  if (!loading) {
    loading = import('posthog-js')
      .then(({ default: ph }) => {
        ph.init(API_KEY, {
          api_host: HOST,
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          persistence: 'localStorage',
        });
        posthog = ph;
        // Apply whatever the user chose while the module was loading.
        if (desiredEnabled) ph.opt_in_capturing();
        else ph.opt_out_capturing();
        return ph;
      })
      .catch(() => null);
  }
  return loading;
}

/**
 * Enable or disable analytics. PostHog is loaded and initialized lazily —
 * nothing happens until the user consents.
 */
export function setAnalyticsEnabled(enabled: boolean): void {
  desiredEnabled = enabled;
  if (enabled) {
    void ensureInitialized();
  } else if (posthog) {
    posthog.opt_out_capturing();
  }
}

/** Crash reports ride on the analytics connection, so they need both this
 *  and setAnalyticsEnabled(true). */
export function setCrashReportsEnabled(enabled: boolean): void {
  crashReportsEnabled = enabled;
}

/** Whether a crash report would be sent right now. Exported for tests. */
export function crashReportingActive(): boolean {
  return desiredEnabled && crashReportsEnabled && posthog !== null;
}

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  if (!posthog) return;
  posthog.capture(event, properties);
}

/**
 * Send an uncaught error as a PostHog exception event. Only the message,
 * stack, source process and kind are sent — no session ids, repo paths, or
 * prompt content.
 */
export function reportCrash(report: AppErrorReport): void {
  if (!crashReportingActive() || !posthog) return;
  try {
    const err = new Error(report.message);
    err.name = report.kind;
    if (report.stack) err.stack = report.stack;
    posthog.captureException(err, { source: report.source, kind: report.kind });
  } catch { /* reporting is best-effort */ }
}

export function shutdownAnalytics(): void {
  if (!posthog) return;
  posthog.reset();
  posthog = null;
  loading = null;
}
