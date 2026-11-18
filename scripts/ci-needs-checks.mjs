/**
 * Whether CI's jobs have anything to check, run as each job's first step.
 *
 * Pull requests always start the jobs, so their checks report: one left
 * out by path filtering never starts, and the pull request waits on it.
 * A pull request that only changes what pushes skip (see ci.yml: the
 * landing site, top-level Markdown and top-level docs) ends the job early
 * instead, with every other step skipped. Pushes are filtered by ci.yml,
 * so they always check.
 *
 * Writes `checks=true|false` to $GITHUB_OUTPUT. Compares the checked-out
 * merge commit with its first parent (the base), so the checkout needs
 * fetch-depth 2. Anything it can't tell means check.
 *
 * Usage: node scripts/ci-needs-checks.mjs
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A path CI doesn't check: keep in step with ci.yml's paths-ignore. */
export function isUnchecked(file) {
  if (file.startsWith('landing/')) return true;
  // Top-level only: docs/help/*.md is bundled into the app.
  if (/^[^/]+\.md$/.test(file)) return true;
  if (/^docs\/[^/]+\.md$/.test(file)) return true;
  return false;
}

/** Whether a change to `files` needs the checks. No files (the list
 *  couldn't be read) means it does. */
export function needsChecks(files) {
  return files.length === 0 || files.some((file) => !isUnchecked(file));
}

function changedFiles() {
  // Both sides of a rename, so moving a file out of src/ counts as a change there.
  const out = execFileSync('git', ['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

function main() {
  let checks = true;
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    try {
      const files = changedFiles();
      checks = needsChecks(files);
      console.log(checks
        ? `${files.length} file${files.length === 1 ? '' : 's'} changed: running the checks.`
        : `Only ${files.join(', ')} changed, which CI doesn't check: skipping the rest of this job.`);
    } catch (err) {
      console.log(`Couldn't list the changed files, so running the checks: ${err.message}`);
    }
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `checks=${checks}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
