import type { PrReviewComment } from '../../shared/types.js';

/** The turn sent to the session's agent when the user clicks Create PR. */
export function buildCreatePrPrompt(branch: string, baseBranch: string): string {
  return [
    `Create a pull request for this branch (${branch}) targeting ${baseBranch}.`,
    '- If there are uncommitted changes, review them and commit with a well-written message.',
    '- Push the branch to origin with upstream tracking.',
    "- Create the PR with `gh pr create`, writing a concise title and a description that summarizes all of the branch's changes.",
    '- If a PR already exists for this branch, just push and share its URL.',
  ].join('\n');
}

/** The turn sent to fix failing CI checks on the branch's PR. */
export function buildFixCiPrompt(prNumber: number, branch: string, failingChecks: string[]): string {
  const checks = failingChecks.length > 0 ? ` Failing checks: ${failingChecks.join(', ')}.` : '';
  return [
    `CI is failing on PR #${prNumber} for this branch (${branch}).${checks}`,
    '- Inspect the failures with `gh pr checks` and `gh run view --log-failed` to read the failing logs.',
    '- Diagnose and fix the code (or workflow) causing each failure.',
    '- Run the relevant tests locally to confirm, then commit and push the fix.',
    '- If a failure is unrelated to this branch (flaky or broken on the base branch), say so instead of forcing a fix.',
  ].join('\n');
}

const MAX_COMMENTS_IN_PROMPT = 30;
const MAX_COMMENT_CHARS = 500;

/** The turn sent to address review feedback on the branch's PR. */
export function buildAddressReviewsPrompt(prNumber: number, branch: string, comments: PrReviewComment[]): string {
  const shown = comments.slice(0, MAX_COMMENTS_IN_PROMPT);
  const bullets = shown.map((c) => {
    const where = c.path ? `${c.path}${c.line ? `:${c.line}` : ''} — ` : '';
    const body = c.body.length > MAX_COMMENT_CHARS ? `${c.body.slice(0, MAX_COMMENT_CHARS)}…` : c.body;
    return `- ${where}${c.author}: ${body.replace(/\s*\n\s*/g, ' ')}`;
  });
  const omitted = comments.length - shown.length;
  return [
    `Address the review feedback on PR #${prNumber} for this branch (${branch}):`,
    ...bullets,
    ...(omitted > 0 ? [`(${omitted} more comments — fetch the rest with \`gh api repos/{owner}/{repo}/pulls/${prNumber}/comments\`.)`] : []),
    '',
    '- Make the code changes each comment calls for; if you disagree with one, explain why instead of changing the code.',
    '- Commit and push, then summarize what you changed for each comment.',
  ].join('\n');
}
