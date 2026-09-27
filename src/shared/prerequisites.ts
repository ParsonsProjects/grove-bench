import type { PrerequisiteStatus } from './types.js';

/**
 * True when git is installed and new enough. Only git-backed features need it
 * (adding a project, worktrees, Changes); it never blocks the app from loading.
 */
export function gitReady(status: PrerequisiteStatus): boolean {
  return status.git.available && status.git.meetsMinimum !== false;
}

/**
 * True when the agent has credentials to start a conversation: a CLI sign-in,
 * credentials in the environment, or an API key saved in the app. Checked when
 * the user starts a conversation, never at app startup.
 */
export function agentReady(status: PrerequisiteStatus): boolean {
  return status.agent.authenticated === true || status.agent.apiKey?.saved === true;
}
