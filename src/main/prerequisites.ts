import type { PrerequisiteStatus } from '../shared/types.js';
import { gitVersion } from './git.js';
import { adapterRegistry } from './adapters/index.js';

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

export async function checkAllPrerequisites(): Promise<PrerequisiteStatus> {
  const adapter = adapterRegistry.getDefault();
  const [gitStatus, agentStatus] = await Promise.all([
    checkGit(),
    adapter.checkPrerequisites(),
  ]);
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
    authErrorMessage = adapter.authErrorMessage;
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
