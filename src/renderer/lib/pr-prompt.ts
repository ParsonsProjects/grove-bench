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
