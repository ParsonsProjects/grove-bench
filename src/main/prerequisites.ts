import type { AgentPrerequisiteStatus, PrerequisiteStatus } from '../shared/types.js';
import { gitVersion } from './git.js';
import { ghVersion, ghAuthenticated } from './gh.js';
import { adapterRegistry } from './adapters/index.js';
import type { AdapterPrerequisiteStatus, AgentAdapter } from './adapters/types.js';
import { canStoreApiKey, hasApiKey } from './credentials.js';

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
 * Git and agent status. Nothing here blocks the app: git only gates git-backed
 * features and agent credentials are asked for when a conversation starts.
 * Deliberately excludes the GitHub CLI, whose auth check hits the network and
 * is slower than the rest.
 */
export async function checkCorePrerequisites(): Promise<PrerequisiteStatus> {
  const [git, agents] = await Promise.all([checkGit(), checkAgents()]);
  return { git, agents };
}

export async function checkAllPrerequisites(): Promise<PrerequisiteStatus> {
  const [git, agents, gh] = await Promise.all([checkGit(), checkAgents(), checkGh()]);
  return { git, agents, gh };
}

/** Every registered agent, checked in parallel. One agent failing its check
 *  (a crashed CLI, a bug in an adapter) doesn't hide the others. */
export async function checkAgents(): Promise<Record<string, AgentPrerequisiteStatus>> {
  const entries = await Promise.all(adapterRegistry.list().map(async (adapter) => {
    let raw: AdapterPrerequisiteStatus;
    try {
      raw = await adapter.checkPrerequisites();
    } catch (err) {
      raw = { available: false, errorMessage: `${adapter.displayName} check failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    return [adapter.id, buildAgentStatus(raw, adapter)] as const;
  }));
  return Object.fromEntries(entries);
}

/** What the renderer needs to offer API key entry for `adapter`, without the
 *  key itself. Undefined when the adapter takes no API key. */
export function apiKeyState(adapter: AgentAdapter): AgentPrerequisiteStatus['apiKey'] {
  if (!adapter.apiKey) return undefined;
  return {
    label: adapter.apiKey.label,
    helpUrl: adapter.apiKey.helpUrl,
    ...(adapter.apiKey.billingNote ? { billingNote: adapter.apiKey.billingNote } : {}),
    saved: hasApiKey(adapter.id),
    canStore: canStoreApiKey(),
  };
}

function buildAgentStatus(agentStatus: AdapterPrerequisiteStatus, adapter: AgentAdapter): AgentPrerequisiteStatus {
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
    available: agentStatus.available,
    path: agentStatus.path,
    authenticated: agentStatus.authenticated,
    authMethod: agentStatus.authMethod,
    email: agentStatus.email,
    errorMessage,
    authErrorMessage,
    apiKey: apiKeyState(adapter),
    ...(adapter.cliSignIn ? { cliSignIn: { ...adapter.cliSignIn } } : {}),
  };
}
