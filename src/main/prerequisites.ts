import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrerequisiteStatus } from '../shared/types.js';
import { gitVersion } from './git.js';

const execFileAsync = promisify(execFile);

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

export async function checkAuth(): Promise<PrerequisiteStatus['auth']> {
  if (process.env.ANTHROPIC_API_KEY) {
    return { available: true, method: 'api-key' };
  }

  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1' ||
      process.env.CLAUDE_CODE_USE_VERTEX === '1' ||
      process.env.CLAUDE_CODE_USE_FOUNDRY === '1') {
    return { available: true, method: 'cloud-provider' };
  }

  // Check if Claude CLI is installed (user may have logged in via `claude login`)
  try {
    await execFileAsync('where.exe', ['claude']);
    return { available: true, method: 'claude-login' };
  } catch {
    return { available: false };
  }
}

export async function checkAllPrerequisites(): Promise<PrerequisiteStatus> {
  const [gitStatus, auth] = await Promise.all([
    checkGit(),
    checkAuth(),
  ]);
  return { git: gitStatus, auth };
}
