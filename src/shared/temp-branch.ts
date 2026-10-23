/** Placeholder branch for a conversation started without a branch name. It is
 *  renamed from the conversation's task after the first reply. */
export function tempBranchName(sessionId: string): string {
  return `grove/${sessionId}`;
}

/** Whether `branch` is a placeholder (from tempBranchName) that hasn't been
 *  renamed yet. Session ids are 8 hex characters. */
export function isTempBranch(branch: string): boolean {
  return /^grove\/[0-9a-f]{8}$/.test(branch);
}
