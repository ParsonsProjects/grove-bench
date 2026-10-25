import { it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import posthog from 'posthog-js';

// Someone who opted out under a version that kept their IDs. In its own
// file, as posthog-js's default instance can be set up once per file.
const server = http.createServer((_req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.end('{}');
});

const KEY = 'phc_test';
let host = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  host = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  vi.stubEnv('VITE_POSTHOG_API_KEY', KEY);
  vi.stubEnv('VITE_POSTHOG_HOST', host);
});

afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

it('gives someone who opted out under an older version new IDs when they opt in again', async () => {
  // What the older version left: it opted out without forgetting.
  const old = posthog.init(KEY, { api_host: host, autocapture: false, persistence: 'localStorage' }, 'older-version');
  old.opt_in_capturing();
  const before = { id: old.get_distinct_id(), device: old.get_property('$device_id') as string };
  old.opt_out_capturing();
  expect(localStorage.getItem(`ph_${KEY}_posthog`)).toContain(before.id);

  const analytics = await import('./analytics.js');
  analytics.setCrashReportsEnabled(true);
  analytics.setAnalyticsEnabled(true);
  await vi.waitFor(() => expect(analytics.crashReportingActive()).toBe(true));

  expect(posthog.has_opted_in_capturing()).toBe(true);
  expect(posthog.get_distinct_id()).not.toBe(before.id);
  expect(posthog.get_property('$device_id')).not.toBe(before.device);
  expect(localStorage.getItem(`ph_${KEY}_posthog`)).not.toContain(before.id);
});
