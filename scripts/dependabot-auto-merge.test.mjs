import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { TOOLING, OWN_CHECK, appPackages, changedEntries, checksState, decide, expectedChecks, isTooling } from './dependabot-auto-merge.mjs';

const patch = 'version-update:semver-patch';

/** A root lockfile: the app uses `marked`, which uses `shared`; vitest (tooling)
 *  uses `shared` too and its own nested copy of `tinyspy`. */
function lock({ vitest = '4.0.0', shared = '1.0.0', tinyspy = '2.0.0' } = {}) {
  return {
    packages: {
      '': { devDependencies: { marked: '^15.0.0', vitest: '^4.0.0' } },
      'node_modules/marked': { version: '15.0.0', dependencies: { shared: '^1.0.0' } },
      'node_modules/shared': { version: shared },
      'node_modules/vitest': { version: vitest, dependencies: { shared: '^1.0.0', tinyspy: '^2.0.0' } },
      'node_modules/vitest/node_modules/tinyspy': { version: tinyspy },
    },
  };
}

describe('isTooling', () => {
  it('takes test, lint and type packages, not what the app bundles or the build uses', () => {
    for (const name of ['vitest', '@vitest/coverage-v8', 'eslint', 'eslint-plugin-svelte', '@eslint/js', 'typescript-eslint', 'typescript', 'knip', 'svelte-check', 'jsdom', '@testing-library/svelte', '@types/node']) {
      expect(isTooling(name), name).toBe(true);
    }
    for (const name of ['svelte', 'vite', 'electron', 'electron-builder', 'marked', 'zod', '@modelcontextprotocol/sdk', 'tailwindcss', '@xterm/xterm']) {
      expect(isTooling(name), name).toBe(false);
    }
  });

  it('matches the tooling group in dependabot.yml', () => {
    const yml = fs.readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8');
    const group = yml.slice(yml.indexOf('      tooling:'), yml.indexOf('      app:'));
    const patterns = [...group.matchAll(/^\s+- '([^']+)'$/gm)].map((m) => m[1]);
    expect(patterns).toEqual(TOOLING);
  });
});

describe('appPackages', () => {
  it("follows the app's packages through nested and hoisted copies, leaving tooling-only ones out", () => {
    const used = appPackages(lock());
    expect([...used].sort()).toEqual(['node_modules/marked', 'node_modules/shared']);
  });
});

describe('changedEntries', () => {
  it('lists entries added, removed or moved to another version', () => {
    const base = lock();
    const head = lock({ vitest: '4.0.1' });
    delete head.packages['node_modules/vitest/node_modules/tinyspy'];
    head.packages['node_modules/vitest/node_modules/new'] = { version: '1.0.0' };
    expect(changedEntries(base, head).sort()).toEqual([
      'node_modules/vitest',
      'node_modules/vitest/node_modules/new',
      'node_modules/vitest/node_modules/tinyspy',
    ]);
  });
});

describe('decide', () => {
  const root = (over = {}) => decide({
    updateType: patch,
    maintainerChanges: false,
    dependencyNames: ['vitest'],
    files: ['package.json', 'package-lock.json'],
    baseLock: lock(),
    headLock: lock({ vitest: '4.0.1', tinyspy: '2.0.1' }),
    ...over,
  });

  it('merges a tooling update that changes nothing the app uses', () => {
    expect(root()).toMatchObject({ merge: true });
  });

  it("holds a tooling update that also moves a package the app uses", () => {
    expect(root({ headLock: lock({ vitest: '4.0.1', shared: '1.0.1' }) })).toEqual({
      merge: false,
      reason: "the lockfile also changes shared, which the app's packages use",
    });
  });

  it('holds an update to a package in the app or the build', () => {
    expect(root({ dependencyNames: ['vitest', 'svelte'] })).toMatchObject({ merge: false, reason: 'it updates svelte, which is in the app or the build' });
    expect(root({ dependencyNames: ['electron-builder'] })).toMatchObject({ merge: false });
  });

  it('holds majors, unknown update types and maintainer changes', () => {
    expect(root({ updateType: 'version-update:semver-major' })).toMatchObject({ merge: false });
    expect(root({ updateType: '' })).toMatchObject({ merge: false });
    expect(root({ maintainerChanges: true })).toMatchObject({ merge: false, reason: 'the pull request says a maintainer changed' });
  });

  it('merges any patch or minor update to the landing page or acp-spike', () => {
    for (const folder of ['landing', 'scripts/acp-spike']) {
      expect(decide({ updateType: 'version-update:semver-minor', maintainerChanges: false, dependencyNames: ['vite'], files: [`${folder}/package.json`, `${folder}/package-lock.json`] })).toMatchObject({ merge: true });
    }
  });

  it('merges an actions update that only changes `uses:` lines', () => {
    const workflowDiff = [
      'diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml',
      '--- a/.github/workflows/ci.yml',
      '+++ b/.github/workflows/ci.yml',
      '@@ -22 +22 @@ jobs:',
      '-      - uses: actions/checkout@aaaa # v7.0.1',
      '+      - uses: actions/checkout@bbbb # v7.0.2',
      '@@ -60 +60 @@',
      '-        uses: actions/upload-artifact@cccc # v7.0.2',
      '+        uses: actions/upload-artifact@dddd # v7.1.0',
    ].join('\n');
    expect(decide({ updateType: patch, maintainerChanges: false, dependencyNames: ['actions/checkout'], files: ['.github/workflows/ci.yml'], workflowDiff })).toMatchObject({ merge: true });
  });

  it('holds a workflow change other than `uses:`, and any other file', () => {
    const workflowDiff = '--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n@@ -1 +1 @@\n-    run: npm ci\n+    run: npm ci && curl x\n';
    expect(decide({ updateType: patch, maintainerChanges: false, dependencyNames: ['actions/checkout'], files: ['.github/workflows/ci.yml'], workflowDiff })).toMatchObject({ merge: false });
    expect(decide({ updateType: patch, maintainerChanges: false, dependencyNames: ['vite'], files: ['landing/package.json', 'landing/vite.config.js'] })).toMatchObject({ merge: false, reason: 'it changes landing/vite.config.js' });
    expect(decide({ updateType: patch, maintainerChanges: false, dependencyNames: [], files: [] })).toMatchObject({ merge: false });
  });
});

describe('expectedChecks', () => {
  it('asks for the checks the changed files start', () => {
    expect(expectedChecks(['package.json', 'package-lock.json'])).toEqual(expect.arrayContaining(['test', 'lint', 'Check package ages', 'Audit app', 'Build installer']));
    const landing = expectedChecks(['landing/package-lock.json']);
    expect(landing).toEqual(expect.arrayContaining(['Build landing page', 'Check package ages']));
    expect(landing).not.toContain('Build installer');
    expect(expectedChecks(['.github/workflows/ci.yml'])).toEqual(['test', 'lint', 'Analyze (javascript-typescript)', 'Analyze (actions)']);
  });
});

describe('checksState', () => {
  const done = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion });

  it('passes once every check has finished well and the expected ones are there', () => {
    const runs = [done('test'), done('lint'), done('deploy', 'skipped'), { name: OWN_CHECK, status: 'in_progress', conclusion: null }];
    expect(checksState(runs, ['test', 'lint'])).toBe('passed');
  });

  it('waits for checks still running, or expected ones not started yet', () => {
    expect(checksState([done('test'), { name: 'lint', status: 'queued', conclusion: null }], ['test', 'lint'])).toBe('waiting');
    expect(checksState([done('test')], ['test', 'Build installer'])).toBe('waiting');
  });

  it('fails on any check that failed, even one not expected', () => {
    expect(checksState([done('test'), done('Label PR size', 'failure')], ['test'])).toBe('failed: Label PR size (failure)');
    expect(checksState([done('test', 'cancelled')], ['test'])).toBe('failed: test (cancelled)');
  });
});
