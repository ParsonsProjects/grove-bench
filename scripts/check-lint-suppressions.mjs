/**
 * Guard for eslint-suppressions.json, run by CI's lint job.
 *
 * The file lists the ESLint errors the code had when ESLint was added, so
 * only new ones fail. ESLint itself lets the list grow (`--suppress-all`
 * adds every error it finds), and never checks the entries of a file that is
 * gone, so a file made later at that path would inherit them. This fails if:
 * - an entry names a file that doesn't exist, or
 * - given a base ref, a rule has more errors listed than in the base. The
 *   totals are per rule, not per file, so moving a renamed file's entry to
 *   its new path passes.
 *
 * Usage: node scripts/check-lint-suppressions.mjs [base-ref]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'eslint-suppressions.json';

/** Errors listed for each rule, across all files. */
export function ruleTotals(suppressions) {
  const totals = {};
  for (const rules of Object.values(suppressions)) {
    for (const [rule, { count }] of Object.entries(rules)) totals[rule] = (totals[rule] ?? 0) + count;
  }
  return totals;
}

/** Rules with more errors listed in `head` than in `base`, as { rule, base, head }. */
export function grownRules(base, head) {
  const baseTotals = ruleTotals(base);
  return Object.entries(ruleTotals(head))
    .filter(([rule, count]) => count > (baseTotals[rule] ?? 0))
    .map(([rule, count]) => ({ rule, base: baseTotals[rule] ?? 0, head: count }))
    .sort((a, b) => a.rule.localeCompare(b.rule));
}

/** Listed files that `exists` says are gone. */
export function missingFiles(suppressions, exists) {
  return Object.keys(suppressions).filter((file) => !exists(file)).sort();
}

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

function gitShow(ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function main() {
  const [baseRef] = process.argv.slice(2);
  const filePath = path.join(ROOT, FILE);
  if (!fs.existsSync(filePath)) {
    console.log(`${FILE}: none, nothing to check.`);
    return;
  }
  const head = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let failed = false;

  for (const file of missingFiles(head, (file) => fs.existsSync(path.join(ROOT, file)))) {
    failed = true;
    console.log(
      `::error file=${FILE}::${file} is listed but doesn't exist. If it was renamed, ` +
      `move its entry to the new path; if it was deleted, delete its entry.`,
    );
  }

  if (baseRef) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    } catch {
      fail(`Base ref "${baseRef}" not found. Fetch it first.`);
    }
    const baseText = gitShow(baseRef, FILE);
    if (baseText === null) {
      console.log(`${FILE}: not in ${baseRef}, so there is nothing to compare.`);
    } else {
      for (const { rule, base, head: count } of grownRules(JSON.parse(baseText), head)) {
        failed = true;
        console.log(
          `::error file=${FILE}::${rule}: ${count} error${count === 1 ? '' : 's'} listed, ${base} in ${baseRef}. ` +
          `Fix the new errors (or disable the rule on that line, saying why) instead of adding them to the list.`,
        );
      }
    }
  }

  const total = Object.values(ruleTotals(head)).reduce((sum, n) => sum + n, 0);
  console.log(`${FILE}: ${total} errors listed in ${Object.keys(head).length} files.`);
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    fail(err.stack ?? String(err));
  }
}
