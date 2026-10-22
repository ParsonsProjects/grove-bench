/**
 * The version the Release workflow publishes next. Kept apart from
 * release-check.mjs so tests can import it without running the release guard.
 *
 * package.json on main holds the lowest version to release next, not the
 * released one: CI writes the picked version into package.json before it
 * builds the installer, so a release needs no version bump commit.
 */
import { SEMVER } from './release-type.mjs';

const NUMERIC = /^\d+$/;

// A version `npm version` writes back as given: no leading zeros and no build
// metadata (it turns 1.0.0-alpha.01 into 1.0.0-alpha.1, and drops +build.1).
// Anything else would tag the release with one version and build the
// installer as another.
const IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const RELEASABLE = new RegExp(`^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?$`);

function checkReleasable(version, what) {
  if (!RELEASABLE.test(version)) {
    throw new Error(`${what} "${version}" is not a valid version to release. Use 1.2.3 or 1.2.3-alpha.4, with no leading zeros or build metadata.`);
  }
}

function parse(version) {
  const match = SEMVER.exec(version);
  if (!match) return null;
  return {
    core: version.split(/[-+]/, 1)[0].split('.').map(Number),
    pre: match[1]?.split('.') ?? [],
  };
}

function compareIdentifiers(a, b) {
  if (NUMERIC.test(a) && NUMERIC.test(b)) return Number(a) - Number(b);
  if (NUMERIC.test(a)) return -1;
  if (NUMERIC.test(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Orders two versions by SemVer 2.0.0 precedence (https://semver.org/#spec-item-11):
 * negative when `a` comes first. Pre-release numbers compare numerically, so
 * alpha.10 comes after alpha.9. Build metadata is ignored.
 */
export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  }
  // A version without a pre-release part comes after one with it.
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const order = compareIdentifiers(x.pre[i], y.pre[i]);
    if (order !== 0) return order;
  }
  return x.pre.length - y.pre.length;
}

/** The highest version among `v`-prefixed tags, without the `v`, or null. */
export function highestVersion(tags) {
  return tags
    .filter((tag) => tag.startsWith('v') && SEMVER.test(tag.slice(1)))
    .map((tag) => tag.slice(1))
    .reduce((best, version) => (best === null || compareVersions(version, best) > 0 ? version : best), null);
}

/**
 * The next pre-release of a pre-release version: its last part plus one when
 * that is a number (0.1.0-alpha.3 to 0.1.0-alpha.4), else `.0` added
 * (0.1.0-beta to 0.1.0-beta.0).
 */
export function incrementPrerelease(version) {
  const { core, pre } = parse(version);
  const last = pre.at(-1);
  const next = NUMERIC.test(last) ? [...pre.slice(0, -1), String(Number(last) + 1)] : [...pre, '0'];
  return `${core.join('.')}-${next.join('.')}`;
}

/**
 * Picks the version to release, or why there is none:
 *
 * 1. `override` (asked for by hand) if it is higher than `last`.
 * 2. `base` (package.json) if it is higher than `last`, the highest released
 *    version. This is how a new series or a full version starts.
 * 3. Nothing when `bumpOnly` (a push to main changing package.json, which is
 *    usually a dependency update) or when nothing shipped has changed.
 * 4. `last` plus one if it is a pre-release. A full version is only released
 *    by a bump or by hand.
 *
 * @param {{ base: string, last: string | null, changed: boolean, bumpOnly?: boolean, override?: string }} options
 * @returns {{ version: string } | { skip: string }}
 */
export function nextVersion({ base, last, changed, bumpOnly = false, override }) {
  checkReleasable(base, 'package.json version');

  if (override) {
    const version = override.replace(/^v/, '');
    checkReleasable(version, 'Version');
    if (last !== null && compareVersions(version, last) <= 0) {
      throw new Error(`${version} is not higher than the last release, ${last}.`);
    }
    return { version };
  }

  if (last === null || compareVersions(base, last) > 0) return { version: base };
  if (bumpOnly) return { skip: `package.json (${base}) is not higher than the last release, ${last}.` };
  if (!changed) return { skip: `Nothing shipped has changed since ${last}.` };
  if (parse(last).pre.length === 0) {
    return { skip: `The last release, ${last}, is a full version. Bump package.json to release the next one.` };
  }
  return { version: incrementPrerelease(last) };
}
