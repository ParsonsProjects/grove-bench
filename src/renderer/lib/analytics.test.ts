import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import posthog from 'posthog-js';

// Runs the real posthog-js against a local server: what opting out leaves
// behind and sends depends on PostHog's own storage and requests.
let requests: string[] = [];
const server = http.createServer((req, res) => {
  requests.push(`${req.method} ${req.url?.split('?')[0]}`);
  res.setHeader('access-control-allow-origin', '*');
  res.end('{}');
});

const KEY = 'phc_test';
const STORED = `ph_${KEY}_posthog`;
let analytics: typeof import('./analytics.js');

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  vi.stubEnv('VITE_POSTHOG_API_KEY', KEY);
  vi.stubEnv('VITE_POSTHOG_HOST', `http://127.0.0.1:${port}`);
  analytics = await import('./analytics.js');
  analytics.setCrashReportsEnabled(true);
});

afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  requests = [];
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns analytics on and waits until PostHog is loaded and sending. */
async function optIn(): Promise<void> {
  analytics.setAnalyticsEnabled(true);
  await vi.waitFor(() => expect(analytics.crashReportingActive()).toBe(true));
  await vi.waitFor(() => expect(posthog.has_opted_in_capturing()).toBe(true));
}

describe('analytics opt-out', () => {
  it('deletes the anonymous IDs PostHog stored', async () => {
    await optIn();
    expect(localStorage.getItem(STORED)).toContain(posthog.get_distinct_id());

    analytics.setAnalyticsEnabled(false);

    expect(localStorage.getItem(STORED)).toBeNull();
  });

  it('sends nothing once the user has opted out', async () => {
    await optIn();
    // Let what was captured while opted in go out first.
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    await wait(500);
    requests = [];

    analytics.setAnalyticsEnabled(false);
    analytics.trackEvent('after_opt_out');
    await wait(500);

    expect(requests).toEqual([]);
  });

  it('starts as someone new when the user opts in again', async () => {
    await optIn();
    const before = { id: posthog.get_distinct_id(), device: posthog.get_property('$device_id') as string };

    analytics.setAnalyticsEnabled(false);
    await optIn();

    expect(posthog.get_distinct_id()).not.toBe(before.id);
    expect(posthog.get_property('$device_id')).not.toBe(before.device);
    expect(localStorage.getItem(STORED)).toContain(posthog.get_distinct_id());
  });
});
