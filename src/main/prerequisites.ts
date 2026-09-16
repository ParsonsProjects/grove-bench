import type { PrerequisiteStatus } from '../shared/types.js';
import { gitVersion } from './git.js';
import { ghVersion, ghAuthenticated } from './gh.js';
import { adapterRegistry } from './adapters/index.js';
import type { AdapterPrerequisiteStatus } from './adapters/types.js';

const MIN_GIT_MAJOR = 2;
const MIN_GIT_MINOR = 17;

export async function checkGit(): Promise<PrerequisiteStatus['git']> {
  const info = await gitVersion();
  if (!info) {
    return { available: false };
  }
  const meetsMinimum =
    info.major > MIN_GIT_MAJOR ||
    (info.major === MIN_GIT_MAJOR && info.minor >= MIN_GIT_MINOR);
  return {
    available: true,
    version: info.version,
    meetsMinimum,
  };
}

/** GitHub CLI detection — optional; only gates PR automation in the UI. */
export async function checkGh(): Promise<NonNullable<PrerequisiteStatus['gh']>> {
  const version = await ghVersion();
  if (!version) {
    return { available: false };
  }
  return {
    available: true,
    version,
    authenticated: await ghAuthenticated(),
  };
}

/**
 * Everything the app needs before it can run: git plus an authenticated agent
 * CLI. Deliberately excludes the GitHub CLI, whose auth check hits the network
 * and must not delay the startup gate.
 */
export async function checkCorePrerequisites(): Promise<PrerequisiteStatus> {
  const adapter = adapterRegistry.getDefault();
  const [gitStatus, agentStatus] = await Promise.all([
    checkGit(),
    adapter.checkPrerequisites(),
  ]);
  return buildStatus(gitStatus, agentStatus, adapter.authErrorMessage);
}

export async function checkAllPrerequisites(): Promise<PrerequisiteStatus> {
  const adapter = adapterRegistry.getDefault();
  const [gitStatus, agentStatus, ghStatus] = await Promise.all([
    checkGit(),
    adapter.checkPrerequisites(),
    checkGh(),
  ]);
  return { ...buildStatus(gitStatus, agentStatus, adapter.authErrorMessage), gh: ghStatus };
}

function buildStatus(
  gitStatus: PrerequisiteStatus['git'],
  agentStatus: AdapterPrerequisiteStatus,
  adapterAuthErrorMessage: string,
): PrerequisiteStatus {
  // Build error/auth message from adapter when not available or not authenticated
  let errorMessage: string | undefined;
  let authErrorMessage: string | undefined;
  if (!agentStatus.available) {
    errorMessage = agentStatus.errorMessage
      ?? (agentStatus.installInstructions
        ? `Agent not found. ${agentStatus.installInstructions}`
        : 'Agent CLI not found.');
  }
  if (agentStatus.available && !agentStatus.authenticated) {
    authErrorMessage = adapterAuthErrorMessage;
  }

  return {
    git: gitStatus,
    agent: {
      available: agentStatus.available,
      path: agentStatus.path,
      authenticated: agentStatus.authenticated,
      authMethod: agentStatus.authMethod,
      email: agentStatus.email,
      errorMessage,
      authErrorMessage,
    },
  };
}
