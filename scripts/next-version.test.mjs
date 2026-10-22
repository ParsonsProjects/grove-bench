import { describe, it, expect } from 'vitest';
import { compareVersions, highestVersion, incrementPrerelease, nextVersion } from './next-version.mjs';

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.0.9')).toBeGreaterThan(0);
    expect(compareVersions('0.0.10', '0.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('puts a pre-release before its full version', () => {
    expect(compareVersions('1.0.0-alpha.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-alpha.1')).toBeGreaterThan(0);
  });

  it('compares pre-release numbers as numbers', () => {
    expect(compareVersions('0.0.0-alpha.10', '0.0.0-alpha.9')).toBeGreaterThan(0);
  });

  it('follows the SemVer 2.0.0 example order', () => {
    const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
    for (let i = 1; i < ordered.length; i++) {
      expect(compareVersions(ordered[i - 1], ordered[i]), `${ordered[i - 1]} < ${ordered[i]}`).toBeLessThan(0);
    }
  });

  it('ignores build metadata', () => {
    expect(compareVersions('1.0.0+build.2', '1.0.0+build.1')).toBe(0);
  });
});

describe('highestVersion', () => {
  it('takes the highest v-prefixed version tag', () => {
    expect(highestVersion(['v0.0.0-alpha.9', 'v0.0.0-alpha.10', 'v0.0.0-alpha.2'])).toBe('0.0.0-alpha.10');
  });

  it('ignores tags that are not versions', () => {
    expect(highestVersion(['vnext', 'v1', '2.0.0', 'v0.0.0-alpha.1'])).toBe('0.0.0-alpha.1');
  });

  it('is null with no version tags', () => {
    expect(highestVersion([])).toBeNull();
  });
});

describe('incrementPrerelease', () => {
  it('adds one to the last number', () => {
    expect(incrementPrerelease('0.0.0-alpha.2')).toBe('0.0.0-alpha.3');
    expect(incrementPrerelease('0.0.0-alpha.9')).toBe('0.0.0-alpha.10');
  });

  it('adds .0 when the last part is not a number', () => {
    expect(incrementPrerelease('0.1.0-beta')).toBe('0.1.0-beta.0');
  });

  it('drops build metadata', () => {
    expect(incrementPrerelease('0.1.0-alpha.1+abc')).toBe('0.1.0-alpha.2');
  });
});

describe('nextVersion', () => {
  it('releases package.json when it is higher than the last release', () => {
    expect(nextVersion({ base: '0.0.0-alpha.8', last: '0.0.0-alpha.7', changed: false })).toEqual({ version: '0.0.0-alpha.8' });
    expect(nextVersion({ base: '1.0.0', last: '0.0.0-alpha.12', changed: true })).toEqual({ version: '1.0.0' });
  });

  it('releases package.json when nothing has been released', () => {
    expect(nextVersion({ base: '0.0.0-alpha.1', last: null, changed: true })).toEqual({ version: '0.0.0-alpha.1' });
  });

  it('releases a package.json bump from a push to main', () => {
    expect(nextVersion({ base: '0.1.0-alpha.1', last: '0.0.0-alpha.9', changed: true, bumpOnly: true })).toEqual({ version: '0.1.0-alpha.1' });
  });

  it('skips a push to main that does not bump past the last release', () => {
    expect(nextVersion({ base: '0.0.0-alpha.8', last: '0.0.0-alpha.9', changed: true, bumpOnly: true })).toHaveProperty('skip');
  });

  it('skips when nothing shipped has changed', () => {
    expect(nextVersion({ base: '0.0.0-alpha.8', last: '0.0.0-alpha.9', changed: false })).toHaveProperty('skip');
  });

  it('releases the next pre-release after a pre-release', () => {
    expect(nextVersion({ base: '0.0.0-alpha.8', last: '0.0.0-alpha.8', changed: true })).toEqual({ version: '0.0.0-alpha.9' });
    expect(nextVersion({ base: '0.0.0-alpha.8', last: '0.0.0-alpha.9', changed: true })).toEqual({ version: '0.0.0-alpha.10' });
  });

  it('skips after a full version, which only a bump or a hand-picked version follows', () => {
    expect(nextVersion({ base: '1.0.0', last: '1.0.0', changed: true })).toHaveProperty('skip');
  });

  it('releases a version asked for by hand when it is higher than the last release', () => {
    expect(nextVersion({ base: '0.0.0-alpha.8', last: '0.0.0-alpha.9', changed: false, override: '1.0.0' })).toEqual({ version: '1.0.0' });
    expect(nextVersion({ base: '0.0.0-alpha.8', last: '0.0.0-alpha.9', changed: false, override: 'v0.0.0-alpha.10' })).toEqual({ version: '0.0.0-alpha.10' });
  });

  it('refuses a version asked for by hand that is not higher than the last release', () => {
    expect(() => nextVersion({ base: '0.0.0-alpha.8', last: '0.0.0-alpha.9', changed: true, override: '0.0.0-alpha.9' })).toThrow(/not higher/);
  });

  it('refuses versions that are not semver', () => {
    expect(() => nextVersion({ base: '0.0.0-alpha.8', last: null, changed: true, override: 'patch' })).toThrow(/not a valid semver/);
    expect(() => nextVersion({ base: 'next', last: null, changed: true })).toThrow(/not a valid semver/);
  });
});
