import { describe, it, expect } from 'vitest';
import { isGitHubPrerelease } from './release-check.mjs';

describe('isGitHubPrerelease', () => {
  it('publishes a full version as a full release', () => {
    expect(isGitHubPrerelease('1.0.0', [])).toBe(false);
    expect(isGitHubPrerelease('1.1.0', ['v1.0.0', 'v1.1.0-beta.1'])).toBe(false);
  });

  it('publishes pre-release versions as full releases until a full version is tagged', () => {
    expect(isGitHubPrerelease('0.0.0-alpha.8', ['v0.0.0-alpha.1', 'v0.0.0-alpha.7', 'v0.0.0-alpha.8'])).toBe(false);
  });

  it('publishes pre-release versions as pre-releases once a full version is tagged', () => {
    expect(isGitHubPrerelease('1.1.0-alpha.1', ['v0.0.0-alpha.7', 'v1.0.0', 'v1.1.0-alpha.1'])).toBe(true);
  });

  it('ignores tags that are not versions', () => {
    expect(isGitHubPrerelease('0.0.0-alpha.8', ['vnext', 'v1', 'v1.0'])).toBe(false);
  });
});
