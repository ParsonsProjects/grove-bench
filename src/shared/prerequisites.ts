import type { PrerequisiteStatus } from './types.js';

/**
 * True when git is installed and new enough. Only git-backed features need it
 * (adding a project, worktrees, Changes); it never blocks the app from loading.
 */
export function gitReady(status: PrerequisiteStatus): boolean {
  return status.git.available && status.git.meetsMinimum !== false;
}

/**
 * True when an agent has credentials to start a conversation: a CLI sign-in,
 * credentials in the environment, or an API key saved in the app. Checked when
 * the user starts a conversation, never at app startup. A saved key the
 * provider has refused doesn't count, and since a saved key is used instead
 * of any sign-in, nothing else does either until it is replaced or removed.
 * An agent that runs its own installed program (every ACP agent) also needs
 * that program, key or not.
 */
export function agentReady(status: PrerequisiteStatus, adapterId: string): boolean {
  const agent = status.agents[adapterId];
  if (!agent) return false;
  if (agent.installRequired && !agent.available) return false;
  if (agent.apiKey?.saved) return !agent.apiKey.rejected;
  return agent.authenticated === true;
}
