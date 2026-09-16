import type { PrerequisiteStatus } from './types.js';

/**
 * True when the core prerequisites (git and an authenticated agent CLI) are
 * met. The GitHub CLI is deliberately excluded: it only gates PR features and
 * must never hold the app behind the startup overlay.
 */
export function prerequisitesSatisfied(status: PrerequisiteStatus): boolean {
  if (!status.git.available || status.git.meetsMinimum === false) return false;
  if (!status.agent.available || status.agent.authenticated !== true) return false;
  return true;
}
