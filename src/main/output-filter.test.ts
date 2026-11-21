import { describe, it, expect } from 'vitest';
import { estimateTokens, outputKinds, shortenCommandOutput } from './output-filter.js';

const times = (n: number, line: (i: number) => string) => Array.from({ length: n }, (_, i) => line(i)).join('\n');

/** Shortened stdout, failing the test if the output was left alone. */
function shorten(command: string, stdout: string, stderr = ''): string {
  const result = shortenCommandOutput(command, stdout, stderr);
  expect(result, 'expected the output to be shortened').not.toBeNull();
  return result!.stdout;
}

describe('outputKinds', () => {
  it.each([
    ['npx vitest run', ['test']],
    ['npm test', ['test']],
    ['npm run test:main -- --run', ['test']],
    ['CI=1 pnpm test', ['test']],
    ['python -m pytest -v', ['test']],
    ['uv run pytest', ['test']],
    ['cargo test --offline', ['test']],
    ['go test ./...', ['test']],
    ['C:\\dev\\app\\node_modules\\.bin\\jest.cmd', ['test']],
    ['npx tsc --noEmit', ['lint']],
    ['npm run lint', ['lint']],
    ['pnpm typecheck', ['lint']],
    ['git status', ['git-status']],
    ['git -C ../other --no-pager log -3', ['git-diff', 'git-log']],
    ['git show HEAD~1', ['git-diff', 'git-log']],
    ['git diff HEAD~1', ['git-diff']],
    ['git push -u origin main', ['git-remote']],
    ['npm ci', ['install']],
    ['yarn', ['install']],
    ['pip install -r requirements.txt', ['install']],
    ['npx vite build', ['build']],
    ['npm run build', ['build']],
    ['cargo build --release', ['build']],
    ['npm install && npm test', ['test', 'install']],
    ['cd app && npm test', ['test']],
    ['rm -rf dist && npm run build', ['build']],
    ['npm test;', ['test']],
    ['npm run type-check', ['lint']],
    ['npm run build:latest', ['build']],
  ])('%s', (command, kinds) => {
    expect(outputKinds(command)).toEqual(kinds);
  });

  it.each([
    'cat package.json',
    'ls -la',
    'git commit -m "Fix it"',
    'npm start',
    'npm test 2>&1 | tail -20',
    'git log | head',
    'npm test |& tee out.txt',
    // Not tests or lint, though their names have those letters in them.
    'npm run inspect',
    'npm run healthcheck',
    // A file's contents.
    'git show HEAD:docs/upgrade.patch',
  ])('knows no rules for %s', (command) => {
    expect(outputKinds(command)).toEqual([]);
  });

  it.each([
    'npx vitest run; echo EXIT=$?',
    'npm test || true',
    'npm test 2>&1 || echo failed',
    'npm run lint\necho done',
  ])('leaves %s alone, as it can succeed though the tests or lint failed', (command) => {
    expect(outputKinds(command)).toEqual([]);
  });

  it.each([
    // Output of a command it knows nothing of.
    'npm test && echo done',
    'npm run build && cat dist/report.txt',
    // A diff, which must stay exact, with output other rules are for.
    'npm install && git diff',
    'npm test && git log -p -3',
    'git status && git diff',
  ])('leaves the chain %s alone', (command) => {
    expect(outputKinds(command)).toEqual([]);
  });

  it('reads 2>&1 as no pipe', () => {
    expect(outputKinds('npm test 2>&1')).toEqual(['test']);
  });
});

describe('shortenCommandOutput', () => {
  it('leaves output alone for a command it has no rules for', () => {
    expect(shortenCommandOutput('cat notes.txt', times(100, (i) => `test_a.py::test_${i} PASSED`), '')).toBeNull();
  });

  it('leaves short output alone', () => {
    expect(shortenCommandOutput('pytest -v', times(5, (i) => `test_a.py::test_${i} PASSED`), '')).toBeNull();
  });

  it('leaves output alone when the rules save too little', () => {
    const stdout = times(60, (i) => `FAIL-ish line ${i} that no rule knows about, long enough to count`);
    expect(shortenCommandOutput('npm test', `${stdout}\n✓ one passing test`, '')).toBeNull();
  });

  it('never makes output longer', () => {
    const stdout = times(200, (i) => `test tests::t${i} ... ok`);
    const result = shortenCommandOutput('cargo test', stdout, '')!;
    expect(result.stdout.length).toBeLessThan(stdout.length);
  });

  it('names the kinds of output it shortened', () => {
    const stdout = `${times(30, (i) => `npm warn deprecated pkg${i}@1.0.0: no longer supported, use something else`)}\n${times(40, (i) => `test tests::t${i} ... ok`)}`;
    expect(shortenCommandOutput('npm ci && cargo test', stdout, '')?.families).toEqual(['test', 'install']);
  });

  it('counts what the caller will add against the savings', () => {
    // 1,000 characters, of which the rules save 500.
    const stdout = `${times(10, (i) => `test tests::t${i} ... ok${' '.repeat(26)}`)}\n${'x'.repeat(499)}`;
    expect(shortenCommandOutput('cargo test', stdout, '')).not.toBeNull();
    expect(shortenCommandOutput('cargo test', stdout, '', 200)).toBeNull();
  });

  it.each([
    ['vitest', 'npx vitest run', ' FAIL  src/a.test.ts > adds\nAssertionError: expected 1 to be 2'],
    ['jest', 'npx jest', 'FAIL src/a.test.ts\n  ● adds'],
    ['pytest', 'pytest', '=================================== FAILURES ===================================\n1 failed, 64 passed in 0.10s'],
    ['cargo', 'cargo test', 'test result: FAILED. 29 passed; 1 failed'],
    ['go', 'go test ./...', '--- FAIL: TestThing (0.00s)'],
  ])('leaves %s output that shows a failure alone, whatever the exit status', (_name, command, failure) => {
    const passing = times(60, (i) => `test tests::t${i} ... ok\n✓ src/thing${i}.test.ts (3 tests) 5ms`);
    expect(shortenCommandOutput(command, `${passing}\n${failure}`, '')).toBeNull();
  });

  it('leaves lint output with errors alone', () => {
    const problems = times(40, (i) => `  ${i + 1}:5  error  'a${i}' is not defined  no-undef`);
    expect(shortenCommandOutput('npm run lint', `/app/a.js\n${problems}\n\n✖ 40 problems (40 errors, 0 warnings)`, '')).toBeNull();
  });

  describe('tests', () => {
    it('hides pytest -v PASSED lines and its header, keeping the summary', () => {
      const stdout = [
        '============================= test session starts ==============================',
        'platform linux -- Python 3.13.18, pytest-9.1.1, pluggy-1.6.0 -- /usr/local/bin/python3.13',
        'rootdir: /home/dev/app',
        'plugins: anyio-4.15.1',
        'collecting ... collected 65 items',
        '',
        times(65, (i) => `test_a.py::test_${i} PASSED${' '.repeat(40)}[${String(Math.round((i + 1) / 65 * 100)).padStart(3)}%]`),
        '',
        '============================== 65 passed in 0.04s ==============================',
      ].join('\n');
      expect(shorten('pytest -v', stdout)).toBe([
        '============================= test session starts ==============================',
        'collecting ... collected 65 items',
        '',
        '[hidden: 65 lines about passing tests]',
        '',
        '============================== 65 passed in 0.04s ==============================',
      ].join('\n'));
    });

    it('hides pytest progress dots, but not a line with a failure', () => {
      const stdout = [
        `test_a.py ${'.'.repeat(40)}${' '.repeat(20)}[ 61%]`,
        `test_b.py ${'.'.repeat(25)}${' '.repeat(20)}[100%]`,
        times(20, (i) => `test_c${i}.py ${'.'.repeat(20)}${' '.repeat(10)}[100%]`),
        `test_d.py ..F..${' '.repeat(20)}[100%]`,
      ].join('\n');
      const out = shorten('pytest', stdout);
      expect(out).toContain('[hidden: 22 lines about passing tests]');
      expect(out).toContain('test_d.py ..F..');
    });

    it('hides cargo test ok lines and compile progress', () => {
      const stdout = [
        '   Compiling rs v0.1.0 (/home/dev/rs)',
        '    Finished `test` profile [unoptimized + debuginfo] target(s) in 1.96s',
        '     Running unittests src/lib.rs (target/debug/deps/rs-ffdf3d4f8e2db1ed)',
        '',
        'running 30 tests',
        times(30, (i) => `test tests::t${i} ... ok`),
        '',
        'test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
      ].join('\n');
      expect(shorten('cargo test', stdout)).toBe([
        '[hidden: 1 line of cargo progress]',
        '    Finished `test` profile [unoptimized + debuginfo] target(s) in 1.96s',
        '     Running unittests src/lib.rs (target/debug/deps/rs-ffdf3d4f8e2db1ed)',
        '',
        'running 30 tests',
        '[hidden: 30 lines about passing tests]',
        '',
        'test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
      ].join('\n'));
    });

    it('hides go test -v RUN and PASS lines', () => {
      const stdout = `${times(30, (i) => `=== RUN   TestThing${i}\n--- PASS: TestThing${i} (0.00s)`)}\nPASS\nok  \texample.com/x\t0.003s`;
      expect(shorten('go test -v ./...', stdout)).toBe('[hidden: 30 lines about passing tests]\nPASS\nok  \texample.com/x\t0.003s');
    });

    it('hides jest PASS lines and verbose passes', () => {
      const stdout = [
        times(20, (i) => `PASS src/feature${i}.test.ts (5.1 s)\n  feature ${i}\n    ✓ works (3 ms)\n    ✓ still works (1 ms)`),
        '',
        'Test Suites: 20 passed, 20 total',
        'Tests:       40 passed, 40 total',
      ].join('\n');
      const out = shorten('npx jest --verbose', stdout);
      expect(out).toContain('[hidden: 60 lines about passing tests]');
      expect(out).toContain('Test Suites: 20 passed, 20 total');
      expect(out).toContain('  feature 7');
    });

    it("hides vitest's console blocks", () => {
      const stdout = [
        ' RUN  v4.1.12 /home/dev/app',
        '',
        times(12, (i) => `stdout | src/thing${i}.test.ts > thing > logs\nloading fixture ${i} from disk with a long path\nfixture ${i} ready\n`),
        ' Test Files  12 passed (12)',
        '      Tests  220 passed (220)',
      ].join('\n');
      const out = shorten('npx vitest run', stdout);
      expect(out).toBe([
        ' RUN  v4.1.12 /home/dev/app',
        '',
        '[hidden: 12 blocks of console output from tests]',
        '',
        ' Test Files  12 passed (12)',
        '      Tests  220 passed (220)',
      ].join('\n'));
    });
  });

  describe('type check and lint', () => {
    it("keeps ESLint's first three problems in each file and counts the rest by rule", () => {
      const stdout = [
        '',
        '/home/dev/app/a.js',
        times(12, (i) => `  ${String(i + 1).padStart(2)}:5  warning  'a${i}' is assigned a value but never used  no-unused-vars`),
        '',
        '/home/dev/app/b.js',
        "  1:5   warning  'unusedB' is assigned a value but never used  no-unused-vars",
        "  2:14  warning  Expected '===' and instead saw '=='           eqeqeq",
        '',
        '✖ 14 problems (0 errors, 14 warnings)',
      ].join('\n');
      expect(shorten('npx eslint .', stdout)).toBe([
        '/home/dev/app/a.js',
        "   1:5  warning  'a0' is assigned a value but never used  no-unused-vars",
        "   2:5  warning  'a1' is assigned a value but never used  no-unused-vars",
        "   3:5  warning  'a2' is assigned a value but never used  no-unused-vars",
        '  [hidden: 9 more problems in this file: no-unused-vars ×9]',
        '',
        '/home/dev/app/b.js',
        "  1:5   warning  'unusedB' is assigned a value but never used  no-unused-vars",
        "  2:14  warning  Expected '===' and instead saw '=='           eqeqeq",
        '',
        '✖ 14 problems (0 errors, 14 warnings)',
      ].join('\n'));
    });
  });

  describe('git', () => {
    it("drops git status's hints", () => {
      const stdout = [
        'On branch main',
        "Your branch is up to date with 'origin/main'.",
        '',
        'Changes not staged for commit:',
        '  (use "git add <file>..." to update what will be committed)',
        '  (use "git restore <file>..." to discard changes in working directory)',
        times(30, (i) => `\tmodified:   src/renderer/components/settings/Component${i}.svelte`),
        '',
        'Untracked files:',
        '  (use "git add <file>..." to include in what will be committed)',
        '\tnotes.txt',
      ].join('\n');
      const out = shortenCommandOutput('git status', stdout, '')?.stdout;
      // 30 modified files and three hints: the hints alone save too little.
      expect(out).toBeUndefined();
      const many = `${stdout}\n${times(12, () => '  (use "git restore --staged <file>..." to unstage)')}`;
      expect(shorten('git status', many)).not.toContain('(use "git');
    });

    it('puts each git log header on one line, with the whole hash and without the email', () => {
      const commit = (i: number) => [
        `commit ${String(i).repeat(40).slice(0, 40)}${i === 0 ? ' (HEAD -> main, origin/main)' : ''}`,
        ...(i === 1 ? ['Merge: 1a2b3c4 5d6e7f8'] : []),
        'Author: Ada Lovelace <ada@example.com>',
        `Date:   Thu Nov ${String(10 + i)} 11:23:26 2026 +0000`,
        '',
        `    Change number ${i}`,
        '    ',
        '    A longer body that says why.',
        '',
      ].join('\n');
      const stdout = times(8, commit);
      const out = shorten('git log -8', stdout);
      expect(out.split('\n').slice(0, 5)).toEqual([
        `${'0'.repeat(40)} (HEAD -> main, origin/main) 2026-11-10 Ada Lovelace`,
        '    Change number 0',
        '    ',
        '    A longer body that says why.',
        '',
      ]);
      expect(out).toContain(`${'1'.repeat(40)} 2026-11-11 Ada Lovelace (merge of 1a2b3c4 5d6e7f8)`);
      expect(out).not.toContain('ada@example.com');
    });

    it("keeps the commit after a lock file's changes in git log -p", () => {
      const stdout = [
        `commit ${'a'.repeat(40)}`,
        'Author: Ada Lovelace <ada@example.com>',
        'Date:   Thu Nov 19 11:23:26 2026 +0000',
        '',
        '    Bump the dependencies',
        '',
        'diff --git a/package-lock.json b/package-lock.json',
        '--- a/package-lock.json',
        '+++ b/package-lock.json',
        '@@ -1,1 +1,40 @@',
        times(40, (i) => `+    "node_modules/pkg${i}": { "version": "1.1.${i}" },`),
        '',
        `commit ${'b'.repeat(40)}`,
        'Author: Ada Lovelace <ada@example.com>',
        'Date:   Wed Nov 18 11:23:26 2026 +0000',
        '',
        '    Fix the parser',
        '',
        'diff --git a/src/a.ts b/src/a.ts',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ].join('\n');
      expect(shorten('git log -p -2', stdout).split('\n')).toEqual([
        `${'a'.repeat(40)} 2026-11-19 Ada Lovelace`,
        '    Bump the dependencies',
        '',
        'diff --git a/package-lock.json b/package-lock.json',
        '[hidden: changes to this lock file, +40 -0 lines]',
        '',
        `${'b'.repeat(40)} 2026-11-18 Ada Lovelace`,
        '    Fix the parser',
        '',
        'diff --git a/src/a.ts b/src/a.ts',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ]);
    });

    it('shows the changes to a lock file the command names', () => {
      const stdout = [
        'diff --git a/package-lock.json b/package-lock.json',
        '@@ -1,40 +1,40 @@',
        times(40, (i) => `-    "node_modules/pkg${i}": { "version": "1.0.${i}" },\n+    "node_modules/pkg${i}": { "version": "1.1.${i}" },`),
      ].join('\n');
      expect(shortenCommandOutput('git diff -- package-lock.json', stdout, '')).toBeNull();
      expect(shorten('git diff', stdout)).toContain('[hidden: changes to this lock file, +40 -40 lines]');
    });

    it('hides lock file changes and index lines, keeping the rest of a diff exactly', () => {
      const stdout = [
        'diff --git a/package-lock.json b/package-lock.json',
        'index 1a2b3c4..5d6e7f8 100644',
        '--- a/package-lock.json',
        '+++ b/package-lock.json',
        '@@ -1,40 +1,40 @@',
        times(40, (i) => `-    "node_modules/pkg${i}": { "version": "1.0.${i}" },\n+    "node_modules/pkg${i}": { "version": "1.1.${i}" },`),
        'diff --git a/src/a.ts b/src/a.ts',
        'index 1111111..2222222 100644',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,4 +1,4 @@',
        ' const a = 1;  ',
        ' ',
        ' ',
        '-const b = 2;\r',
        '+const b = 3;\r',
      ].join('\n');
      expect(shorten('git diff', stdout)).toBe([
        'diff --git a/package-lock.json b/package-lock.json',
        '[hidden: changes to this lock file, +40 -40 lines]',
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,4 +1,4 @@',
        ' const a = 1;  ',
        ' ',
        ' ',
        '-const b = 2;\r',
        '+const b = 3;\r',
      ].join('\n'));
    });

    it('drops transfer progress from git push, keeping what the remote says', () => {
      const stderr = [
        'Enumerating objects: 5, done.',
        'Counting objects: 100% (5/5), done.',
        'Delta compression using up to 8 threads',
        'Compressing objects: 100% (3/3), done.',
        'Writing objects: 100% (3/3), 1.20 KiB | 1.20 MiB/s, done.',
        'Total 3 (delta 2), reused 0 (delta 0), pack-reused 0',
        'remote: Resolving deltas: 100% (2/2), completed with 2 local objects.',
        'remote: ',
        times(10, (i) => `remote: Counting objects: ${i * 10}% (${i}/10)`),
        "remote: Create a pull request for 'feature' on GitHub by visiting:",
        'remote:      https://github.com/example/app/pull/new/feature',
        'To github.com:example/app.git',
        ' * [new branch]      feature -> feature',
      ].join('\n');
      const result = shortenCommandOutput('git push -u origin feature', '', stderr)!;
      expect(result.stderr).toBe([
        "remote: Create a pull request for 'feature' on GitHub by visiting:",
        'remote:      https://github.com/example/app/pull/new/feature',
        'To github.com:example/app.git',
        ' * [new branch]      feature -> feature',
      ].join('\n'));
    });
  });

  describe('installs', () => {
    it('puts npm deprecation warnings in one line and drops the funding note', () => {
      const stdout = [
        'npm warn deprecated rimraf@2.6.3: Rimraf versions prior to v4 are no longer supported',
        'npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.',
        'npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update.',
        "npm warn deprecated lodash.isequal@4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.",
        'npm warn deprecated boolean@3.2.0: Package no longer supported. Contact Support at https://www.npmjs.com/support for more info.',
        '',
        'added 690 packages, and audited 691 packages in 35s',
        '',
        '87 packages are looking for funding',
        '  run `npm fund` for details',
        '',
        'found 0 vulnerabilities',
        'npm notice New major version of npm available! 10.9.9 -> 11.21.3',
      ].join('\n');
      expect(shorten('npm install', stdout)).toBe([
        '[deprecation warnings for 5 packages: rimraf@2.6.3, inflight@1.0.6, glob@7.2.3, lodash.isequal@4.5.0, boolean@3.2.0]',
        '',
        'added 690 packages, and audited 691 packages in 35s',
        '',
        'found 0 vulnerabilities',
      ].join('\n'));
    });

    it("keeps pnpm's last progress line only", () => {
      const stdout = `${times(40, (i) => `Progress: resolved ${i * 10}, reused ${i * 9}, downloaded ${i}, added ${i * 8}`)}\nPackages: +390\n${'+'.repeat(60)}\nDone in 4.2s`;
      expect(shorten('pnpm install', stdout)).toBe('Progress: resolved 390, reused 351, downloaded 39, added 312\nPackages: +390\nDone in 4.2s');
    });

    it("hides pip's download and resolve lines", () => {
      const stdout = `${times(30, (i) => `Requirement already satisfied: package${i}>=1.0 in /usr/local/lib/python3.13/site-packages`)}\nSuccessfully installed thing-1.0`;
      expect(shorten('pip install thing', stdout)).toBe('[hidden: 30 lines of download and resolve progress]\nSuccessfully installed thing-1.0');
    });

    it('keeps what a progress bar ended on', () => {
      const stdout = `${times(40, (i) => `Requirement already satisfied: package${i}>=1.0 in /usr/local/lib/python3.13/site-packages`)}\nInstalling\r[#    ] 20%\r[#####] 100%\nDone`;
      expect(shorten('pip install thing', stdout)).toContain('[#####] 100%\nDone');
    });
  });

  describe('builds', () => {
    it("keeps Vite's five largest files, its warnings and its result", () => {
      const sizes = [1.0, 5.06, 7.5, 8.06, 8.21, 9.0, 9.55, 12.02, 12.11, 13.35, 130.64, 144.95, 148.72, 336.97, 1071.72];
      const stdout = [
        'vite v6.4.4 building for production...',
        'transforming...',
        '✓ 1256 modules transformed.',
        'rendering chunks...',
        'computing gzip size...',
        ...sizes.map((s, i) => `../../out/renderer/assets/chunk-number-${i}-AbCdEf12.js${' '.repeat(40)}${s.toLocaleString('en-US', { minimumFractionDigits: 2 })} kB │ gzip:  ${(s / 3).toFixed(2)} kB`),
        '',
        '(!) Some chunks are larger than 700 kB after minification. Consider:',
        '- Using dynamic import() to code-split the application',
        '✓ built in 12.89s',
      ].join('\n');
      const out = shorten('npx vite build', stdout).split('\n');
      expect(out.slice(0, 3)).toEqual([
        'vite v6.4.4 building for production...',
        '✓ 1256 modules transformed.',
        '[hidden: 10 smaller output files]',
      ]);
      expect(out.slice(3, 8).map((l) => /chunk-number-(\d+)/.exec(l)?.[1])).toEqual(['10', '11', '12', '13', '14']);
      expect(out.slice(8)).toEqual([
        '',
        '(!) Some chunks are larger than 700 kB after minification. Consider:',
        '- Using dynamic import() to code-split the application',
        '✓ built in 12.89s',
      ]);
    });
  });

  it('says a line repeated many times once, with a count', () => {
    const stdout = `${times(60, () => 'npm warn config production Use `--omit=dev` instead.')}\nadded 1 package in 1s`;
    expect(shorten('npm install', stdout)).toBe('npm warn config production Use `--omit=dev` instead.\n[the line above 59 more times]\nadded 1 package in 1s');
  });
});

describe('long runs of spaces', () => {
  // Patterns that backtrack would take seconds here, in the main process.
  it.each([
    ['npm run build', `x${' '.repeat(30_000)}y kB`],
    ['npx eslint .', `  1:1  warning  x${' '.repeat(30_000)}y z`],
    ['git log', `Author: x${' '.repeat(30_000)}y`],
  ])('are quick to read in %s output', (command, line) => {
    const started = performance.now();
    shortenCommandOutput(command, `${line}\n${'a'.repeat(2000)}`, '');
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('estimateTokens', () => {
  it('counts four characters a token', () => {
    expect(estimateTokens(4000)).toBe(1000);
    expect(estimateTokens(-5)).toBe(0);
  });
});
