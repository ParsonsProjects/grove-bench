import { describe, it, expect } from 'vitest';
import { isGitHubPrerelease } from './release-type.mjs';

describe('isGitHubPrerelease', () => {
  it('publishes a full version as a full release', () => {
    expect(isGitHubPrerelease('1.0.0', [])).toBe(false);
    expect(isGitHubPrerelease('1.1.0', ['v1.0.0'])).toBe(false);
  });

  it('publishes pre-release versions as full releases until a full version is released', () => {
    // alpha.1 and alpha.2 went out as full releases
    expect(isGitHubPrerelease('0.0.0-alpha.8', ['v0.0.0-alpha.1', 'v0.0.0-alpha.2', 'v0.0.0-alpha.7'])).toBe(false);
  });

  it('publishes pre-release versions as pre-releases once a full version is released', () => {
    expect(isGitHubPrerelease('1.1.0-alpha.1', ['v0.0.0-alpha.7', 'v1.0.0'])).toBe(true);
  });

  it('ignores tags that are not versions', () => {
    expect(isGitHubPrerelease('0.0.0-alpha.8', ['vnext', 'v1', 'v1.0'])).toBe(false);
  });
});
