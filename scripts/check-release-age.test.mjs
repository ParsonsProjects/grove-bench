import { describe, it, expect, vi } from 'vitest';
import { parseNpmrc, matchesPattern, changedPackages, checkAges } from './check-release-age.mjs';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-09-28T12:00:00Z');
const REGISTRY = 'https://registry.npmjs.org/';

function entry(name, version, extra = {}) {
  return { version, resolved: `${REGISTRY}${name}/-/${name.split('/').pop()}-${version}.tgz`, ...extra };
}

function lock(packages) {
  return { lockfileVersion: 3, packages: { '': { name: 'app', version: '1.0.0' }, ...packages } };
}

describe('parseNpmrc', () => {
  it('reads min-release-age, excludes and registry, ignoring comments', () => {
    const config = parseNpmrc([
      '# comment',
      '; also a comment',
      'min-release-age = 7',
      'min-release-age-exclude[]=@myorg/*',
      'min-release-age-exclude[]="left-pad"',
      'min-release-age-exclude=single',
      'registry=https://registry.example.com',
      'engine-strict=true',
    ].join('\r\n'));
    expect(config).toEqual({
      minReleaseAge: 7,
      exclude: ['@myorg/*', 'left-pad', 'single'],
      registry: 'https://registry.example.com/',
    });
  });

  it('defaults to no age limit and the public registry', () => {
    expect(parseNpmrc('')).toEqual({ minReleaseAge: null, exclude: [], registry: REGISTRY });
  });
});

describe('matchesPattern', () => {
  it('matches exact names', () => {
    expect(matchesPattern('left-pad', 'left-pad')).toBe(true);
    expect(matchesPattern('left-pad-2', 'left-pad')).toBe(false);
  });

  it('lets * match within one path segment only', () => {
    expect(matchesPattern('@myorg/utils', '@myorg/*')).toBe(true);
    expect(matchesPattern('@other/utils', '@myorg/*')).toBe(false);
    expect(matchesPattern('@myorg/utils', '*')).toBe(false);
    expect(matchesPattern('@myorg/utils', '**')).toBe(true);
  });

  it('treats regex characters literally', () => {
    expect(matchesPattern('a.b', 'a.b')).toBe(true);
    expect(matchesPattern('axb', 'a.b')).toBe(false);
  });
});

describe('changedPackages', () => {
  it('returns added and re-versioned packages, not unchanged ones', () => {
    const base = lock({
      'node_modules/kept': entry('kept', '1.0.0'),
      'node_modules/bumped': entry('bumped', '1.0.0'),
    });
    const head = lock({
      'node_modules/kept': entry('kept', '1.0.0'),
      'node_modules/bumped': entry('bumped', '1.1.0'),
      'node_modules/added': entry('added', '2.0.0'),
    });
    expect(changedPackages(base, head)).toEqual([
      { name: 'bumped', version: '1.1.0' },
      { name: 'added', version: '2.0.0' },
    ]);
  });

  it('treats every entry as added when there is no base lockfile', () => {
    const head = lock({ 'node_modules/a': entry('a', '1.0.0') });
    expect(changedPackages(null, head)).toEqual([{ name: 'a', version: '1.0.0' }]);
  });

  it('uses the nested folder name and the alias target name', () => {
    const head = lock({
      'node_modules/parent/node_modules/@scope/child': entry('@scope/child', '3.0.0'),
      'node_modules/alias': entry('real-name', '1.0.0', { name: 'real-name' }),
    });
    expect(changedPackages(null, head)).toEqual([
      { name: '@scope/child', version: '3.0.0' },
      { name: 'real-name', version: '1.0.0' },
    ]);
  });

  it('skips links, bundled, git and non-registry entries', () => {
    const head = lock({
      'packages/local': { version: '1.0.0' },
      'node_modules/local': { resolved: 'packages/local', link: true },
      'node_modules/parent/node_modules/bundled': { version: '1.0.0', inBundle: true },
      'node_modules/from-git': { version: '1.0.0', resolved: 'git+ssh://git@github.com/o/r.git#abc' },
      'node_modules/from-url': { version: '1.0.0', resolved: 'https://example.com/pkg.tgz' },
    });
    expect(changedPackages(null, head)).toEqual([]);
  });

  it('lists a package once when several folders hold the same version', () => {
    const head = lock({
      'node_modules/a/node_modules/dup': entry('dup', '1.0.0'),
      'node_modules/b/node_modules/dup': entry('dup', '1.0.0'),
    });
    expect(changedPackages(null, head)).toEqual([{ name: 'dup', version: '1.0.0' }]);
  });
});

describe('checkAges', () => {
  const times = {
    'old@1.0.0': new Date(NOW - 30 * DAY_MS).toISOString(),
    'edge@1.0.0': new Date(NOW - 7 * DAY_MS).toISOString(),
    'fresh@1.0.0': new Date(NOW - 3 * DAY_MS).toISOString(),
  };
  const fetchTime = vi.fn(async (name, version) => times[`${name}@${version}`] ?? null);

  it('flags versions newer than the limit and allows ones exactly at it', async () => {
    const result = await checkAges(
      [{ name: 'old', version: '1.0.0' }, { name: 'edge', version: '1.0.0' }, { name: 'fresh', version: '1.0.0' }],
      { minReleaseAge: 7, now: NOW, fetchTime },
    );
    expect(result.tooNew).toEqual([{
      name: 'fresh',
      version: '1.0.0',
      published: NOW - 3 * DAY_MS,
      allowedFrom: NOW + 4 * DAY_MS,
    }]);
    expect(result.errors).toEqual([]);
    expect(result.checked).toBe(3);
  });

  it('skips excluded packages without fetching them', async () => {
    fetchTime.mockClear();
    const result = await checkAges([{ name: 'fresh', version: '1.0.0' }], {
      minReleaseAge: 7, exclude: ['fre*'], now: NOW, fetchTime,
    });
    expect(result).toEqual({ tooNew: [], errors: [], checked: 0, excluded: 1 });
    expect(fetchTime).not.toHaveBeenCalled();
  });

  it('reports missing publish times and fetch failures as errors', async () => {
    const result = await checkAges(
      [{ name: 'missing', version: '1.0.0' }, { name: 'broken', version: '1.0.0' }],
      {
        minReleaseAge: 7,
        now: NOW,
        fetchTime: async (name) => {
          if (name === 'broken') throw new Error('HTTP 503');
          return null;
        },
      },
    );
    expect(result.tooNew).toEqual([]);
    expect(result.errors).toEqual([
      { name: 'broken', version: '1.0.0', message: 'HTTP 503' },
      { name: 'missing', version: '1.0.0', message: 'the registry has no publish time for this version' },
    ]);
  });
});
