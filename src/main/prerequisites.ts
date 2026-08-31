import type { PrerequisiteStatus } from '../shared/types.js';
import { gitVersion } from './git.js';
import { ghVersion, ghAuthenticated } from './gh.js';
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

export async function checkAllPrerequisites(): Promise<PrerequisiteStatus> {
  const adapters = adapterRegistry.list();
  const defaultId = adapterRegistry.getDefault().id;
  const [gitStatus, ghStatus, ...agentStatuses] = await Promise.all([
    checkGit(),
    checkGh(),
    ...adapters.map((a) => a.checkPrerequisites().catch((e): Awaited<ReturnType<typeof a.checkPrerequisites>> => ({
      available: false,
      errorMessage: e?.message ?? String(e),
    }))),
  ]);

  const agents: PrerequisiteStatus['agents'] = {};
  adapters.forEach((adapter, i) => {
    const status = agentStatuses[i];
    // Build error/auth message from adapter when not available or not authenticated
    let errorMessage: string | undefined;
    let authErrorMessage: string | undefined;
    if (!status.available) {
      errorMessage = status.errorMessage
        ?? (status.installInstructions
          ? `Agent not found. ${status.installInstructions}`
          : 'Agent CLI not found.');
    }
    if (status.available && !status.authenticated) {
      authErrorMessage = adapter.authErrorMessage;
    }
    agents[adapter.id] = {
      displayName: adapter.displayName,
      isDefault: adapter.id === defaultId,
      available: status.available,
      path: status.path,
      authenticated: status.authenticated,
      authMethod: status.authMethod,
      email: status.email,
      errorMessage,
      authErrorMessage,
    };
  });

  return {
    git: gitStatus,
    agents,
    gh: ghStatus,
  };
}
