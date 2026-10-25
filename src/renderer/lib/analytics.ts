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
          // Opting out deletes the anonymous IDs PostHog stored, not just
          // the sending.
          opt_out_persistence_by_default: true,
          // The app uses no feature flags, and reset() would ask PostHog for
          // the new ID's flags just after an opt-out.
          advanced_disable_feature_flags: true,
        });
        posthog = ph;
        // Someone who opted out earlier starts as someone new. Versions before
        // this one kept their IDs stored, and init has just read them back.
        if (ph.has_opted_out_capturing()) ph.reset(true);
        // Apply whatever the user chose while the module was loading.
        if (desiredEnabled) ph.opt_in_capturing();
        else optOutAndForget(ph);
        return ph;
      })
      .catch(() => null);
  }
  return loading;
}

/** Stop sending, and give this install new anonymous IDs (true resets the
 *  device ID too), so usage after an opt-in again isn't linked to usage
 *  before. reset() goes first: it also clears the stored opt-out. */
function optOutAndForget(ph: PostHog): void {
  ph.reset(true);
  ph.opt_out_capturing();
}

/**
 * Enable or disable analytics. PostHog is loaded and initialized lazily —
 * nothing happens until the user consents.
 */
export function setAnalyticsEnabled(enabled: boolean): void {
  desiredEnabled = enabled;
  if (!posthog) {
    if (enabled) void ensureInitialized();
  } else if (enabled) {
    // Only when turned back on after an opt-out this session: settings
    // changes call this again, and each opt-in sends an event.
    if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
  } else if (!posthog.has_opted_out_capturing()) {
    optOutAndForget(posthog);
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
